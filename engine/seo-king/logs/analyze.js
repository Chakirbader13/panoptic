// Panoptic SEO KING - agregation des logs serveur.
//
// Contrainte: le fichier peut peser des gigaoctets et l'instance a 2 Go. On n'accumule
// donc que des compteurs, jamais de lignes, et chaque structure a un plafond explicite.
// Quand un plafond est atteint on le DIT (truncated) plutot que de laisser croire a une
// couverture complete.

import { identify } from "./bots.js";
import { urlTemplate } from "../pagefacts.js";

const MAX_PATHS = 50_000;      // au-dela, on continue de compter l'existant sans ajouter
const ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|woff2?|ttf|eot|mp4|webm|mp3|map|json|xml|txt)$/i;

export function createAggregator() {
  const byBot = {};          // botId -> compteurs
  const byPath = new Map();  // chemin -> { hits, bots:Set, statuses:Map, last }
  const byTemplate = new Map();
  let pathsTruncated = false;
  const totals = { entries: 0, botEntries: 0, humanEntries: 0, bytes: 0 };

  function bucket(botId, label, kind) {
    return byBot[botId] || (byBot[botId] = {
      id: botId, label, kind,
      hits: 0, bytes: 0,
      ips: new Map(),
      statuses: new Map(),
      paths: new Set(),          // plafonne plus bas
      params: 0, assets: 0, errors: 0, redirects: 0, notFound: 0, serverErrors: 0,
      first: null, last: null,
    });
  }

  return {
    add(e) {
      totals.entries++;
      totals.bytes += e.bytes || 0;
      const bot = identify(e.ua);
      if (!bot) { totals.humanEntries++; return; }
      totals.botEntries++;

      const b = bucket(bot.id, bot.label, bot.kind);
      b.hits++;
      b.bytes += e.bytes || 0;
      if (e.ip) b.ips.set(e.ip, (b.ips.get(e.ip) || 0) + 1);
      b.statuses.set(e.status, (b.statuses.get(e.status) || 0) + 1);
      if (e.time) {
        if (b.first == null || e.time < b.first) b.first = e.time;
        if (b.last == null || e.time > b.last) b.last = e.time;
      }
      // Un chemin a parametres est precisement ce qu'un crawler poli ignore et ou
      // Googlebot peut brûler l'essentiel de son budget.
      if (e.fullPath && e.fullPath.includes("?")) b.params++;
      if (ASSET_RE.test(e.path)) b.assets++;
      if (e.status >= 500) { b.serverErrors++; b.errors++; }
      else if (e.status === 404) { b.notFound++; b.errors++; }
      else if (e.status >= 400) b.errors++;
      else if (e.status >= 300) b.redirects++;

      if (b.paths.size < 5000) b.paths.add(e.path);

      // Les assets ne disent rien de l'exploration des pages: on ne les indexe pas.
      if (ASSET_RE.test(e.path)) return;

      let p = byPath.get(e.path);
      if (!p) {
        if (byPath.size >= MAX_PATHS) { pathsTruncated = true; }
        else { p = { hits: 0, bots: new Set(), statuses: new Map(), last: null }; byPath.set(e.path, p); }
      }
      if (p) {
        p.hits++;
        p.bots.add(bot.id);
        p.statuses.set(e.status, (p.statuses.get(e.status) || 0) + 1);
        if (e.time && (p.last == null || e.time > p.last)) p.last = e.time;
      }

      const t = urlTemplate("http://x" + e.path);
      const tp = byTemplate.get(t) || byTemplate.set(t, { hits: 0, errors: 0, bots: new Set() }).get(t);
      tp.hits++;
      tp.bots.add(bot.id);
      if (e.status >= 400) tp.errors++;
    },

    result() {
      return { byBot, byPath, byTemplate, totals, pathsTruncated };
    },
  };
}

/**
 * Croise les logs avec ce que l'audit sait du site.
 * @param agg   resultat de createAggregator().result()
 * @param graph graphe d'evidence (pages crawlees, sitemap, maillage)
 */
export function crossReference(agg, graph, sitemapUrls = []) {
  const known = new Set();          // chemins connus du crawl
  const inSitemap = new Set();
  const linked = new Set();         // chemins qui recoivent au moins un lien interne
  for (const n of graph.list()) {
    const p = pathOf(n.url);
    if (!p) continue;
    if (n.crawled) known.add(p);
    if (n.inSitemap) inSitemap.add(p);
    if ((n.inLinks || []).length > 0) linked.add(p);
  }
  for (const u of sitemapUrls) { const p = pathOf(u); if (p) inSitemap.add(p); }

  const searchBots = new Set(Object.values(agg.byBot).filter((b) => b.kind === "search").map((b) => b.id));
  const crawledByEngine = [];
  for (const [path, data] of agg.byPath) {
    if (![...data.bots].some((b) => searchBots.has(b))) continue;
    crawledByEngine.push({ path, ...data });
  }
  crawledByEngine.sort((a, b) => b.hits - a.hits);

  // ORPHELINES ACTIVES: un moteur y revient alors que ni le sitemap ni le maillage
  // ne les declarent. Typiquement d'anciennes URL jamais redirigees. Ni le crawl ni
  // la Search Console ne les font apparaitre aussi nettement.
  const activeOrphans = crawledByEngine
    .filter((p) => !inSitemap.has(p.path) && !linked.has(p.path) && !known.has(p.path))
    .slice(0, 30);

  // Pages declarees au sitemap qu'aucun moteur n'est venu chercher.
  const neverCrawled = [...inSitemap].filter((p) => {
    const d = agg.byPath.get(p);
    return !d || ![...d.bots].some((b) => searchBots.has(b));
  }).slice(0, 30);

  // Budget d'exploration: part des visites de moteur qui ne servent a rien.
  const engineTotals = Object.values(agg.byBot).filter((b) => b.kind === "search")
    .reduce((s, b) => ({
      hits: s.hits + b.hits, params: s.params + b.params, assets: s.assets + b.assets,
      errors: s.errors + b.errors, redirects: s.redirects + b.redirects,
      notFound: s.notFound + b.notFound, serverErrors: s.serverErrors + b.serverErrors,
    }), { hits: 0, params: 0, assets: 0, errors: 0, redirects: 0, notFound: 0, serverErrors: 0 });

  const wasted = engineTotals.params + engineTotals.errors + engineTotals.redirects;
  const wasteRatio = engineTotals.hits ? Math.round((wasted / engineTotals.hits) * 100) : 0;

  // Gabarits qui absorbent le budget: c'est la que se voit une explosion de facettes.
  const topTemplates = [...agg.byTemplate.entries()]
    .map(([template, d]) => ({ template, ...d, bots: [...d.bots] }))
    .sort((a, b) => b.hits - a.hits).slice(0, 12);

  return {
    activeOrphans, neverCrawled, engineTotals, wasteRatio, topTemplates,
    crawledCount: crawledByEngine.length,
    sitemapCount: inSitemap.size,
    coverage: inSitemap.size ? Math.round(((inSitemap.size - neverCrawled.length) / inSitemap.size) * 100) : null,
  };
}

function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch { return null; }
}

export function topStatuses(map, limit = 4) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s, n]) => `${s}: ${n}`);
}
