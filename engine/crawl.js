// Panoptic - crawler interne budgete (BFS, concurrence, plafond temps + pages).
// Reutilisable par plusieurs agents. Extrait par page les faits SEO utiles et les liens
// internes. Ne telecharge pas les assets (filtre par extension).
//
// Passage a l'echelle (1000+ pages), trois mecanismes:
//   1. ORDRE: les URLs declarees au sitemap passent avant la decouverte par liens.
//      C'est la liste que le proprietaire juge importante, autant la traiter d'abord.
//   2. ECRETAGE PAR GABARIT: sur une boutique, 800 fiches produit partagent la meme
//      structure. En crawler 800 coute du temps et de la memoire pour un seul et meme
//      diagnostic. On plafonne le nombre de pages par gabarit d'URL.
//   3. RESPIRATION: sans parseur DOM, l'extraction est une serie de regex synchrones
//      sur de grandes chaines. A forte concurrence, c'est l'event loop qui sature avant
//      la memoire, et les fetch en vol expirent. On rend la main entre chaque lot.
import { httpGet, originOf } from "./agents/shared.js";
import { urlTemplate } from "./seo-king/pagefacts.js";

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

// Rend la main a la boucle d'evenements pour laisser les I/O respirer.
const breathe = () => new Promise((r) => setImmediate(r));

// auth: { cookie?, bearer?, headers? } propage a chaque requete (scan authentifie).
// keepHtml: retient le HTML complet de chaque page (agents multi-pages a11y/content).
// onPage(url, html, status): appele des qu'une page est recuperee. Permet a l'appelant
//   d'extraire ses faits et de LIBERER le HTML immediatement (mode grande echelle).
// priorityUrls: URLs traitees en premier (typiquement celles du sitemap).
// templateCap: nombre maximal de pages par gabarit d'URL (0 = pas de plafond).
export async function crawl(target, {
  seedUrl, seedHtml, seedHeaders, maxPages = 12, budgetMs = 16000, concurrency = 5,
  auth, keepHtml = false, onPage = null, priorityUrls = null, templateCap = 0,
} = {}) {
  const origin = originOf(target);
  const start = performance.now();
  const seed = seedUrl || origin + "/";
  const visited = new Map();          // url -> facts
  const linkTargets = new Set();      // tous les liens internes vus
  const seen = new Set([seed]);
  const templateCount = new Map();    // gabarit -> nombre de pages deja crawlees
  const skippedByTemplate = new Map();
  let queue = [seed];
  const withHtml = (f, html) => (keepHtml ? { ...f, html } : f);

  const templateAllows = (url) => {
    if (!templateCap) return true;
    const t = urlTemplate(url);
    if ((templateCount.get(t) || 0) >= templateCap) {
      skippedByTemplate.set(t, (skippedByTemplate.get(t) || 0) + 1);
      return false;
    }
    return true;
  };
  const countTemplate = (url) => {
    if (!templateCap) return;
    const t = urlTemplate(url);
    templateCount.set(t, (templateCount.get(t) || 0) + 1);
  };

  const enqueue = (url) => {
    if (seen.has(url)) return;
    seen.add(url);
    queue.push(url);
  };

  // Amorce avec le HTML deja recupere par la recon (evite un fetch).
  if (seedHtml != null) {
    visited.set(seed, withHtml(facts(seed, seedHeaders?.status || 200, seedHeaders, seedHtml), seedHtml));
    countTemplate(seed);
    if (onPage) onPage(seed, seedHtml, seedHeaders?.status || 200);
    for (const l of extractLinks(seedHtml, seed, origin)) { linkTargets.add(l); enqueue(l); }
    queue = queue.filter((u) => u !== seed);
  }

  // Les URLs du sitemap passent devant: c'est la liste que le proprietaire declare
  // importante. Sur un gros site, l'ordre de traitement decide de ce qu'on voit.
  if (priorityUrls?.length) {
    const front = [];
    for (const u of priorityUrls) {
      const n = normalize(u, seed, origin);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      front.push(n);
    }
    queue = [...front, ...queue];
  }

  while (queue.length && visited.size < maxPages && performance.now() - start < budgetMs) {
    const batch = [];
    while (batch.length < concurrency && queue.length) {
      const url = queue.shift();
      if (!templateAllows(url)) continue;
      batch.push(url);
    }
    if (!batch.length) continue;

    const results = await Promise.all(batch.map(async (url) => {
      const r = await httpGet(url, { timeout: 6000, ...auth });
      return { url, r };
    }));

    for (const { url, r } of results) {
      if (r.error) { visited.set(url, { url, status: 0, title: null, desc: null, h1: 0, canonical: null, noindex: false, words: 0, error: r.error }); continue; }
      const html = r.body || "";
      visited.set(url, withHtml(facts(url, r.status, r, html), html));
      countTemplate(url);
      if (onPage) onPage(url, html, r.status);
      if (visited.size >= maxPages) break;
      for (const l of extractLinks(html, url, origin)) { linkTargets.add(l); enqueue(l); }
    }
    // Laisse les I/O et le ramasse-miettes respirer avant le lot suivant.
    await breathe();
  }

  return {
    origin,
    pages: [...visited.values()],
    linkTargets: [...linkTargets],
    truncated: queue.length > 0 || visited.size >= maxPages,
    templates: templateCap ? {
      distinct: templateCount.size,
      capped: [...skippedByTemplate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ template: t, skipped: n })),
      totalSkipped: [...skippedByTemplate.values()].reduce((a, b) => a + b, 0),
    } : null,
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
    await breathe();
  }
  return out;
}
