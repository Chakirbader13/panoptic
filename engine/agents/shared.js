// Panoptic - fondation partagee par tous les agents.
// Fabrique de findings au format canonique, helpers HTTP/HTML/DNS sans dependance,
// et utilitaires communs (hash deterministe, extraction de balises).

// Risque business indicatif (euros) par severite. Heuristique assumee, pas une mesure.
export const RISK_EUR = { critical: 15000, high: 6000, medium: 1500, low: 300, info: 0 };

// Hash court deterministe (pas de Date/random, pour des ids stables).
export function fid(prefix, s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

// Fabrique un finding canonique. Chaque agent l'utilise pour parler la meme langue.
export function makeFinding(agentId, family, raw) {
  const loc = raw.location || (raw.url ? { url: raw.url } : { file: raw.file, line: raw.line });
  const kind = raw.evidenceType || (raw.file ? "code" : "prod");
  return {
    id: fid(raw.prefix || agentId.slice(0, 3).toUpperCase(), `${raw.rule}:${loc.file || loc.url || "g"}:${loc.line || 0}`),
    agent: agentId,
    family,
    rule: raw.rule,
    cwe: raw.cwe,
    title: raw.title,
    severity: raw.severity,
    evidence: {
      type: kind,
      proof: raw.proof,
      reproducible: raw.reproducible !== false,
      artifact: raw.artifact,
    },
    location: loc,
    business: {
      kind: raw.gain_eur ? "gain" : "risk",
      risk_eur: raw.gain_eur ? 0 : (raw.risk_eur ?? RISK_EUR[raw.severity] ?? 0),
      gain_eur: raw.gain_eur ?? 0,
      impact: raw.impact || raw.title,
    },
    fix: { summary: raw.fix, opens_pr: false },
    effort: raw.effort ?? 0.3,
    check: raw.check || { verdict: "confirmed", votes: 3, refuters: 0, reason: raw.reason || "Observe directement." },
  };
}

// --- HTTP -------------------------------------------------------------------------
export async function httpGet(url, { timeout = 9000, redirect = "follow", method = "GET" } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method, redirect, signal: ctrl.signal,
      headers: { "user-agent": "PanopticAudit/1.0 (+https://panoptic-audit.netlify.app)" },
    });
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    let body = "";
    const ct = headers["content-type"] || "";
    if (/text|html|json|xml|javascript|css/.test(ct) || !ct) body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, url: res.url || url, headers, setCookie, body, redirected: res.redirected };
  } catch (e) {
    return { error: e.message, url };
  } finally {
    clearTimeout(to);
  }
}

// Existence/statut d'une ressource sans telecharger le corps entier.
export async function httpHead(url, opts = {}) {
  const r = await httpGet(url, { ...opts, method: "GET" });
  return r.error ? r : { ok: r.ok, status: r.status, headers: r.headers, url: r.url, bodySample: (r.body || "").slice(0, 4000) };
}

// --- HTML (extraction sans parseur lourd) -----------------------------------------
export function tag(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = re.exec(html);
  return m ? m[1].trim() : null;
}
export function tagAll(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1].trim());
  return out;
}
export function attr(openTag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(openTag);
  return m ? m[1] : null;
}
// Renvoie tous les elements ouvrants d'un type (ex: "meta", "a", "img") avec leurs attributs bruts.
export function elements(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return (html.match(re) || []);
}
export function meta(html, key) {
  // key = name="description" ou property="og:title" etc.
  const metas = elements(html, "meta");
  for (const m of metas) {
    if (new RegExp(key, "i").test(m)) return attr(m, "content");
  }
  return null;
}
export function countTag(html, name) {
  return (html.match(new RegExp(`<${name}\\b`, "gi")) || []).length;
}
// Texte visible approx (sans scripts/styles/balises) pour lisibilite et langue.
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- DNS (via resolveur DoH Cloudflare, sans dependance) --------------------------
export async function dnsQuery(name, type) {
  const r = await httpGet(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { timeout: 6000 });
  if (r.error) return { error: r.error };
  try {
    const j = JSON.parse(r.body);
    return { answers: (j.Answer || []).map((a) => a.data) };
  } catch {
    return { error: "reponse DNS illisible" };
  }
}

export function hostOf(url) {
  try { return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).host; } catch { return url; }
}
export function originOf(url) {
  try { return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).origin; } catch { return url; }
}
