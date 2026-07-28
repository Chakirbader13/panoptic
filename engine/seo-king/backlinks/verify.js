// Panoptic SEO KING - verification de backlinks declares.
//
// Panoptic ne construit pas d'index de liens: c'est hors de portee sans crawler le web
// entier, et pretendre le contraire produirait de l'estimation, exactement ce que ce
// produit refuse. En revanche il sait faire une chose que les index font mal: VERIFIER.
//
// L'utilisateur fournit une liste de liens entrants (export CSV de la Search Console,
// d'Ahrefs, de Majestic, de n'importe quel outil). Le moteur va lire chaque page source
// et constate: le lien existe-t-il encore, vers quelle URL exactement, avec quelle
// ancre, en dofollow ou non, et la page source est-elle seulement indexable.
//
// Un index de liens dit "vous aviez 400 liens il y a trois semaines". Cette lane dit
// "sur les 40 verifies aujourd'hui, 6 ont disparu et 4 sont en nofollow".
//
// PIEGE CENTRAL: un pare-feu applicatif (Cloudflare et consorts) bloque volontiers un
// crawler inconnu. Confondre "je suis bloque" avec "le lien a disparu" produirait des
// faux negatifs en masse, sur les sites les mieux proteges, donc souvent les plus
// interessants. Tout statut de blocage donne "invérifiable", jamais "perdu".

import { httpGet } from "../../agents/shared.js";

const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 409, 418, 429, 503]);
const CHALLENGE_RE = /(cf-browser-verification|challenge-platform|just a moment|attention required|checking your browser|ddos-guard|please enable (cookies|javascript)|access denied|are you a robot)/i;

/**
 * Verifie un lot de liens entrants declares.
 * @param links [{ source, target?, anchor?, type? }]
 * @param opts  { targetHost, cap, concurrency, timeout }
 */
export async function verifyBacklinks(links, { targetHost, cap = 40, concurrency = 4, timeout = 12000 } = {}) {
  const host = String(targetHost || "").replace(/^www\./, "").toLowerCase();
  const list = dedupe(links).slice(0, cap);
  const results = await mapLimit(list, concurrency, async (l) => verifyOne(l, host, timeout));

  const by = (state) => results.filter((r) => r.state === state);
  const verified = by("verified");
  const nofollowed = verified.filter((r) => r.nofollow);
  return {
    state: results.length ? "observed" : "not_measured",
    sample: { declared: links.length, checked: results.length, capped: links.length > cap },
    results,
    counts: {
      verified: verified.length,
      dofollow: verified.length - nofollowed.length,
      nofollow: nofollowed.length,
      lost: by("lost").length,
      sourceGone: by("source-gone").length,
      sourceNoindex: verified.filter((r) => r.sourceNoindex).length,
      unverifiable: by("unverifiable").length,
    },
  };
}

async function verifyOne(link, host, timeout) {
  const base = { source: link.source, declaredTarget: link.target || null, declaredAnchor: link.anchor || null };
  let res;
  try {
    res = await httpGet(link.source, { timeout, redirect: "follow" });
  } catch (e) {
    return { ...base, state: "unverifiable", reason: String(e.message || e).slice(0, 120) };
  }
  if (res.error) return { ...base, state: "unverifiable", reason: res.error };

  // Blocage: on ne conclut RIEN sur le lien. C'est la difference entre un rapport
  // utilisable et un rapport qui annonce la perte de tous les liens de qualite.
  if (BLOCKED_STATUSES.has(res.status)) {
    return { ...base, state: "unverifiable", status: res.status, reason: `page source protegee (HTTP ${res.status})` };
  }
  const body = res.body || "";
  if (CHALLENGE_RE.test(body.slice(0, 4000))) {
    return { ...base, state: "unverifiable", status: res.status, reason: "page d'interstitiel anti-robot" };
  }
  if (res.status === 404 || res.status === 410) {
    return { ...base, state: "source-gone", status: res.status, reason: `page source supprimee (HTTP ${res.status})` };
  }
  if (res.status >= 400) {
    return { ...base, state: "unverifiable", status: res.status, reason: `HTTP ${res.status}` };
  }

  // Le lien pointe-t-il encore chez nous ?
  const found = findLink(body, host, res.url || link.source);
  if (!found) {
    return { ...base, state: "lost", status: res.status, reason: "aucun lien vers le domaine dans la page source" };
  }

  const sourceNoindex = /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(body);
  return {
    ...base,
    state: "verified",
    status: res.status,
    finalUrl: res.url !== link.source ? res.url : undefined,
    target: found.href,
    anchor: found.anchor,
    rel: found.rel || null,
    nofollow: /(^|\s)(nofollow|ugc|sponsored)(\s|$)/i.test(found.rel || ""),
    sourceNoindex,
  };
}

// Cherche un lien vers le domaine cible dans le HTML de la page source.
function findLink(html, host, baseUrl) {
  const re = /<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const open = `<a${m[1]}>`;
    const href = attr(open, "href");
    if (!href) continue;
    let abs;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    const h = abs.host.replace(/^www\./, "").toLowerCase();
    if (h !== host) continue;
    const anchor = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { href: abs.href, anchor: anchor.slice(0, 120), rel: (attr(open, "rel") || "").toLowerCase() };
  }
  return null;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : null;
}

function dedupe(links) {
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (!l?.source) continue;
    const k = String(l.source).replace(/#.*$/, "").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}
