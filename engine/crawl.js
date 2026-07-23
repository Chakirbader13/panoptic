// Panoptic - crawler interne budgete (BFS, concurrence, plafond temps + pages).
// Reutilisable par plusieurs agents. Extrait par page les faits SEO utiles et les liens
// internes. Ne telecharge pas les assets (filtre par extension).
import { httpGet, originOf } from "./agents/shared.js";

const ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|woff2?|ttf|eot|mp4|webm|mp3|map)(\?|$)/i;

function normalize(href, base, origin) {
  try {
    const u = new URL(href, base);
    if (u.origin !== origin) return null;
    if (!/^https?:/.test(u.protocol)) return null;
    if (ASSET_RE.test(u.pathname)) return null;
    u.hash = "";
    let p = u.pathname.replace(/\/+$/, "") || "/";
    return origin + p + (u.search || "");
  } catch { return null; }
}

function extractLinks(html, base, origin) {
  const out = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) { const n = normalize(m[1], base, origin); if (n) out.add(n); }
  return [...out];
}

function facts(url, status, headers, html) {
  const title = (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]?.trim() || null;
  const desc = (/<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html)
    || /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i.exec(html) || [])[1]?.trim() || null;
  const h1 = (html.match(/<h1\b/gi) || []).length;
  const canonical = (/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i.exec(html) || [])[1] || null;
  const noindex = /<meta\b[^>]*name\s*=\s*["']robots["'][^>]*noindex/i.test(html);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = (text.match(/\S+/g) || []).length;
  return { url, status, title, desc, h1, canonical, noindex, words };
}

// auth: { cookie?, bearer?, headers? } propage a chaque requete (scan authentifie).
// keepHtml: retient le HTML complet de chaque page (pour les agents multi-pages a11y/content).
export async function crawl(target, { seedUrl, seedHtml, seedHeaders, maxPages = 12, budgetMs = 16000, concurrency = 5, auth, keepHtml = false } = {}) {
  const origin = originOf(target);
  const start = performance.now();
  const seed = seedUrl || origin + "/";
  const visited = new Map();          // url -> facts
  const linkTargets = new Set();      // tous les liens internes vus
  const seen = new Set([seed]);
  let queue = [seed];
  const withHtml = (f, html) => (keepHtml ? { ...f, html } : f);

  // Amorce avec le HTML deja recupere par la recon (evite un fetch).
  if (seedHtml != null) {
    visited.set(seed, withHtml(facts(seed, seedHeaders?.status || 200, seedHeaders, seedHtml), seedHtml));
    for (const l of extractLinks(seedHtml, seed, origin)) { linkTargets.add(l); if (!seen.has(l)) { seen.add(l); queue.push(l); } }
    queue = queue.filter((u) => u !== seed);
  }

  while (queue.length && visited.size < maxPages && performance.now() - start < budgetMs) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(batch.map(async (url) => {
      const r = await httpGet(url, { timeout: 6000, ...auth });
      return { url, r };
    }));
    for (const { url, r } of results) {
      if (r.error) { visited.set(url, { url, status: 0, title: null, desc: null, h1: 0, canonical: null, noindex: false, words: 0, error: r.error }); continue; }
      const html = r.body || "";
      visited.set(url, withHtml(facts(url, r.status, r, html), html));
      if (visited.size >= maxPages) break;
      for (const l of extractLinks(html, url, origin)) {
        linkTargets.add(l);
        if (!seen.has(l)) { seen.add(l); queue.push(l); }
      }
    }
  }

  return {
    origin,
    pages: [...visited.values()],
    linkTargets: [...linkTargets],
    truncated: queue.length > 0 || visited.size >= maxPages,
    stats: { crawled: visited.size, discovered: linkTargets.size, ms: Math.round(performance.now() - start) },
  };
}

// Verifie le statut HTTP d'un ensemble de liens (plafonne pour tenir le budget).
export async function checkLinks(urls, { cap = 25, concurrency = 6, timeout = 6000 } = {}) {
  const list = urls.slice(0, cap);
  const out = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const res = await Promise.all(batch.map(async (url) => {
      const r = await httpGet(url, { timeout });
      return { url, status: r.error ? 0 : r.status, error: r.error };
    }));
    out.push(...res);
  }
  return out;
}
