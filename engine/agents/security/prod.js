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
  { path: "/.git/config", severity: "high", title: "Depot .git expose", must: /\[core\]|repositoryformatversion/ },
  { path: "/.aws/credentials", severity: "critical", title: "Identifiants AWS exposes", must: /aws_access_key_id/i },
  { path: "/config.json", severity: "medium", title: "Fichier de config JSON expose", must: /[{]/ },
  { path: "/.env.local", severity: "critical", title: "Fichier .env.local expose", must: /[A-Z_]+=/ },
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
