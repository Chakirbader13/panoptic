// Panoptic - Agent securite: scan de la production (DAST passif).
// Requetes HTTP reelles: en-tetes de securite, cookies, TLS, divulgation de version,
// fichiers sensibles exposes. Read-only, non destructif. Retourne des findings bruts.

const HEADER_RULES = [
  { id: "missing-csp", header: "content-security-policy", severity: "high", effort: 0.5,
    title: "En-tete Content-Security-Policy absent",
    fix: "Definir une CSP restrictive (default-src 'self') pour bloquer XSS et injections." },
  { id: "missing-hsts", header: "strict-transport-security", httpsOnly: true, severity: "medium", effort: 0.1,
    title: "En-tete Strict-Transport-Security (HSTS) absent",
    fix: "Ajouter Strict-Transport-Security: max-age=31536000; includeSubDomains." },
  { id: "missing-xcto", header: "x-content-type-options", severity: "low", effort: 0.1,
    title: "En-tete X-Content-Type-Options absent",
    fix: "Ajouter X-Content-Type-Options: nosniff." },
  { id: "missing-frame", header: "x-frame-options", altHeader: "content-security-policy", altContains: "frame-ancestors", severity: "medium", effort: 0.1,
    title: "Protection anti-clickjacking absente (X-Frame-Options / frame-ancestors)",
    fix: "Ajouter X-Frame-Options: DENY ou frame-ancestors 'none' dans la CSP." },
  { id: "missing-referrer", header: "referrer-policy", severity: "info", effort: 0.1,
    title: "En-tete Referrer-Policy absent",
    fix: "Ajouter Referrer-Policy: strict-origin-when-cross-origin." },
  { id: "missing-permissions-policy", header: "permissions-policy", severity: "info", effort: 0.2,
    title: "En-tete Permissions-Policy absent",
    fix: "Restreindre les API sensibles (camera, microphone, geolocation) via Permissions-Policy." },
];

// Directives CSP dangereuses (analysees seulement si la CSP est presente).
const CSP_WEAK = [
  { re: /'unsafe-inline'/, id: "csp-unsafe-inline", severity: "medium", what: "'unsafe-inline'",
    why: "autorise les scripts/styles inline, annulant l'essentiel de la protection XSS" },
  { re: /'unsafe-eval'/, id: "csp-unsafe-eval", severity: "medium", what: "'unsafe-eval'",
    why: "autorise eval(), vecteur d'injection de code" },
  { re: /(script-src[^;]*\*(?!\.)|default-src[^;]*\s\*(?:\s|;|$))/, id: "csp-wildcard", severity: "medium", what: "source * (joker)",
    why: "autorise le chargement de scripts depuis n'importe quelle origine" },
];

const DISCLOSURE_HEADERS = [
  { id: "server-version", header: "server", severity: "low", effort: 0.1,
    title: "Divulgation de version serveur",
    re: /\d/, fix: "Masquer la version dans l'en-tete Server." },
  { id: "powered-by", header: "x-powered-by", severity: "low", effort: 0.1,
    title: "Divulgation de technologie (X-Powered-By)",
    re: /.+/, fix: "Supprimer l'en-tete X-Powered-By." },
];

const EXPOSED_PATHS = [
  { path: "/.env", severity: "critical", title: "Fichier .env expose publiquement", must: /[A-Z_]+=/ },
  { path: "/.env.local", severity: "critical", title: "Fichier .env.local expose", must: /[A-Z_]+=/ },
  { path: "/.env.production", severity: "critical", title: "Fichier .env.production expose", must: /[A-Z_]+=/ },
  { path: "/.git/config", severity: "high", title: "Depot .git expose", must: /\[core\]|repositoryformatversion/ },
  { path: "/.git/HEAD", severity: "high", title: "Depot .git expose (HEAD)", must: /ref:\s*refs\// },
  { path: "/.aws/credentials", severity: "critical", title: "Identifiants AWS exposes", must: /aws_access_key_id/i },
  { path: "/config.json", severity: "medium", title: "Fichier de config JSON expose", must: /[{]/ },
  { path: "/.DS_Store", severity: "low", title: "Fichier .DS_Store expose (structure de dossiers)", must: /Bud1|\x00\x00\x00/ },
  { path: "/backup.sql", severity: "high", title: "Dump SQL de sauvegarde expose", must: /(CREATE TABLE|INSERT INTO|DROP TABLE)/i },
  { path: "/server-status", severity: "medium", title: "Apache server-status expose", must: /Apache Server Status|Server uptime/i },
];

async function fetchSafe(url, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "PanopticAudit/1.0 (+security-scan)" }, ...opts });
    return res;
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(to);
  }
}

// Retourne { findings, reachable, info }
export async function scanProd(rawUrl) {
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const isHttps = url.startsWith("https://");
  const findings = [];
  const res = await fetchSafe(url);
  if (res.error) return { findings, reachable: false, info: { error: res.error, url } };

  const H = {};
  res.headers.forEach((v, k) => { H[k.toLowerCase()] = v; });
  const homeBody = (await res.text().catch(() => "")) || "";

  // 1. En-tetes de securite manquants
  for (const r of HEADER_RULES) {
    if (r.httpsOnly && !isHttps) continue;
    let present = Boolean(H[r.header]);
    if (!present && r.altHeader && r.altContains) {
      present = (H[r.altHeader] || "").toLowerCase().includes(r.altContains);
    }
    if (!present) findings.push(mk(r, url, `En-tete "${r.header}" absent de la reponse ${res.status}.`));
  }

  // 2. Divulgation d'information
  for (const r of DISCLOSURE_HEADERS) {
    const val = H[r.header];
    if (val && r.re.test(val)) {
      findings.push(mk(r, url, `${r.header}: ${val}`));
    }
  }

  // 3. Cookies sans attributs de securite
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : (H["set-cookie"] ? [H["set-cookie"]] : []);
  for (const c of setCookie) {
    const name = c.split("=")[0];
    const low = c.toLowerCase();
    const miss = [];
    if (isHttps && !low.includes("secure")) miss.push("Secure");
    if (!low.includes("httponly")) miss.push("HttpOnly");
    if (!low.includes("samesite")) miss.push("SameSite");
    if (miss.length) {
      findings.push({
        ruleId: "insecure-cookie", cwe: "CWE-614", kind: "prod", severity: "medium", effort: 0.2,
        title: `Cookie "${name}" sans ${miss.join(" / ")}`,
        fix: "Ajouter les attributs Secure, HttpOnly et SameSite aux cookies de session.",
        url, proof: c.slice(0, 120), confidence: "high",
      });
    }
  }

  // 4. Absence de TLS
  if (!isHttps) {
    findings.push({
      ruleId: "no-tls", cwe: "CWE-319", kind: "prod", severity: "high", effort: 0.3,
      title: "Site servi en HTTP clair (pas de TLS)",
      fix: "Forcer HTTPS et rediriger tout le trafic HTTP en 301.",
      url, proof: `Reponse ${res.status} sur ${url}`, confidence: "high",
    });
  }

  // 4b. Faiblesses de la CSP (analysee seulement si presente: preuve directe dans l'en-tete)
  const csp = H["content-security-policy"] || "";
  if (csp) {
    for (const w of CSP_WEAK) {
      if (w.re.test(csp)) findings.push({
        ruleId: w.id, cwe: "CWE-693", kind: "prod", severity: w.severity, effort: 0.4,
        title: `CSP affaiblie par ${w.what}`,
        fix: `Retirer ${w.what} de la CSP: ${w.why}.`,
        url, proof: `CSP contient ${w.what}.`, confidence: "high",
      });
    }
  }

  // 4c. HSTS present mais faible (max-age court ou sans includeSubDomains)
  const hsts = H["strict-transport-security"];
  if (isHttps && hsts) {
    const maxAge = Number((/max-age=(\d+)/i.exec(hsts) || [])[1] || 0);
    if (maxAge > 0 && maxAge < 15768000) findings.push({
      ruleId: "hsts-short-maxage", cwe: "CWE-319", kind: "prod", severity: "low", effort: 0.1,
      title: `HSTS max-age trop court (${Math.round(maxAge / 86400)} j)`,
      fix: "Porter max-age a au moins 15768000 (6 mois), idealement 31536000 (1 an).",
      url, proof: hsts.slice(0, 120), confidence: "high",
    });
    else if (!/includesubdomains/i.test(hsts)) findings.push({
      ruleId: "hsts-no-subdomains", cwe: "CWE-319", kind: "prod", severity: "info", effort: 0.1,
      title: "HSTS sans includeSubDomains",
      fix: "Ajouter includeSubDomains pour couvrir tous les sous-domaines.",
      url, proof: hsts.slice(0, 120), confidence: "medium",
    });
  }

  // 4d. CORS reflechi (une requete GET avec un Origin sonde: reflexion = preuve directe)
  const probeOrigin = "https://panoptic-cors-probe.example";
  const cors = await fetchSafe(url, { headers: { origin: probeOrigin } });
  if (!cors.error) {
    const acao = cors.headers.get("access-control-allow-origin");
    const acac = (cors.headers.get("access-control-allow-credentials") || "").toLowerCase() === "true";
    if (acao === probeOrigin || (acao === "*" && acac)) findings.push({
      ruleId: "cors-reflected-origin", cwe: "CWE-942", kind: "prod",
      severity: acac ? "high" : "medium", effort: 0.3,
      title: acac ? "CORS reflechi avec credentials (fuite de donnees possible)" : "CORS reflechit toute origine",
      fix: "Verifier l'Origin contre une liste blanche; ne jamais reflechir + Allow-Credentials.",
      url, proof: `ACAO: ${acao}${acac ? ", Allow-Credentials: true" : ""}`, confidence: "high",
    });
  }

  // 4e. Contenu mixte: sous-ressources chargees en HTTP clair sur une page HTTPS
  if (isHttps && homeBody) {
    const mixed = homeBody.match(/<(?:script|img|iframe|link|source|video|audio)\b[^>]*\b(?:src|href)=["']http:\/\/[^"']+/gi) || [];
    if (mixed.length) findings.push({
      ruleId: "mixed-content", cwe: "CWE-311", kind: "prod", severity: "medium", effort: 0.3,
      title: `${mixed.length} sous-ressource(s) chargee(s) en HTTP clair (contenu mixte)`,
      fix: "Servir toutes les ressources en HTTPS (scripts, images, styles, iframes).",
      url, proof: mixed[0].slice(0, 120), confidence: "high",
    });
  }

  // 5. Fichiers sensibles exposes (probing leger, GET seulement)
  const base = new URL(url).origin;
  for (const p of EXPOSED_PATHS) {
    const r = await fetchSafe(base + p.path);
    if (r.error || !r.ok) continue;
    const body = (await r.text().catch(() => "")).slice(0, 4000);
    if (p.must.test(body)) {
      findings.push({
        ruleId: `exposed${p.path.replace(/[^a-z]/gi, "-")}`, cwe: "CWE-538", kind: "prod",
        severity: p.severity, effort: 0.3, title: p.title,
        fix: "Bloquer l'acces public a ce fichier au niveau du serveur / CDN.",
        url: base + p.path, proof: `HTTP 200, contenu sensible detecte (${body.length} o).`, confidence: "high",
      });
    }
  }

  return {
    findings, reachable: true,
    info: { url, status: res.status, server: H["server"] || null, headersSeen: Object.keys(H).length },
  };
}

function mk(rule, url, proof) {
  return {
    ruleId: rule.id, cwe: rule.cwe || "CWE-693", kind: "prod",
    severity: rule.severity, effort: rule.effort, title: rule.title,
    fix: rule.fix, url, proof, confidence: "high",
  };
}
