// Panoptic SEO KING - deuxieme etage de reconnaissance, mutualise et budgete.
//
// Regle du produit: UN SEUL crawl. La recon de couche 1 recupere l'accueil et les
// pages. Certaines verifications SEO demandent pourtant des requetes que la couche 1
// ne fait pas: chaines de redirection, statut reel des URLs du sitemap, reciprocite
// hreflang, comportement 404. Les laisser a chaque lane, c'est marteler le site et
// exploser le budget (deux lanes qui demandent la meme URL = deux requetes).
//
// Ici: une file unique par origine, concurrence basse, plafond de requetes, budget
// temps global, cache par URL. Les agents seo et geo tournent en parallele et
// partagent le MEME resultat via une promesse memoisee sur le scope.
//
// Honnetete d'observation: chaque bloc porte son etat. "observed" = mesure,
// "sampled" = mesure sur un echantillon, "not_checked" = budget epuise ou source
// absente. Une lane n'a JAMAIS le droit de transformer un not_checked en anomalie.

import { httpGet } from "../agents/shared.js";
import { parseRobots } from "./robots.js";
import { isSitemapIndex, parseUrlset, parseSitemapIndex } from "./xml.js";

const DEFAULTS = {
  maxRequests: 45,
  budgetMs: 15000,
  concurrency: 4,
  timeout: 7000,
  maxSitemapUrls: 60,     // echantillon de statut
  maxSitemapFiles: 5,     // recursion dans un index
  maxAlternates: 12,
};

// File budgetee: refuse proprement quand le plafond est atteint, ne jette jamais.
class Budget {
  constructor(opts) {
    this.opts = opts;
    this.used = 0;
    this.start = performance.now();
    this.cache = new Map();
    this.exhaustedBy = null;
  }
  get elapsed() { return performance.now() - this.start; }
  get exhausted() {
    if (this.used >= this.opts.maxRequests) { this.exhaustedBy = this.exhaustedBy || "plafond de requetes"; return true; }
    if (this.elapsed > this.opts.budgetMs) { this.exhaustedBy = this.exhaustedBy || "budget temps"; return true; }
    return false;
  }
  async fetch(url, options = {}) {
    const key = `${options.redirect || "follow"}:${url}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.exhausted) return { skipped: true, reason: this.exhaustedBy, url };
    this.used++;
    const p = httpGet(url, { timeout: this.opts.timeout, ...options });
    this.cache.set(key, p);
    return p;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}

// Suit une chaine de redirection pas a pas (redirect: manual) pour la rendre visible.
// Une chaine de 3 sauts coute du budget de crawl et dilue le signal a chaque saut.
async function followChain(budget, url, max = 5) {
  const chain = [];
  let current = url;
  for (let i = 0; i < max; i++) {
    const r = await budget.fetch(current, { redirect: "manual" });
    if (r.skipped) return { chain, final: current, status: null, state: "not_checked", reason: r.reason };
    if (r.error) return { chain, final: current, status: 0, error: r.error, state: "observed" };
    const loc = r.headers?.location;
    chain.push({ url: current, status: r.status, location: loc || null });
    if (r.status >= 300 && r.status < 400 && loc) {
      try { current = new URL(loc, current).href; } catch { break; }
      // Boucle: on s'arrete et on le signale, c'est un finding en soi.
      if (chain.some((c) => c.url === current)) return { chain, final: current, status: r.status, loop: true, state: "observed" };
      continue;
    }
    return { chain, final: current, status: r.status, headers: r.headers, body: r.body, state: "observed" };
  }
  return { chain, final: current, status: null, tooLong: true, state: "observed" };
}

export async function deepRecon(scope, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const budget = new Budget(opts);
  const origin = scope.origin;
  const auth = scope.auth || {};
  const out = { origin, coverage: {}, budget: null };

  // --- robots.txt: corps COMPLET (la recon n'en garde qu'un extrait) --------------
  const robotsRes = await budget.fetch(origin + "/robots.txt", auth);
  if (robotsRes.skipped) out.robots = { state: "not_checked", reason: robotsRes.reason };
  else if (robotsRes.error) out.robots = { state: "not_checked", reason: robotsRes.error };
  else {
    const isReal = robotsRes.status === 200 && !/<html/i.test(robotsRes.body || "");
    out.robots = {
      state: "observed",
      present: isReal,
      status: robotsRes.status,
      // Un robots.txt servi en HTML (SPA qui repond 200 sur tout) n'est pas un robots.txt.
      servedAsHtml: robotsRes.status === 200 && /<html/i.test(robotsRes.body || ""),
      raw: isReal ? robotsRes.body : "",
      parsed: isReal ? parseRobots(robotsRes.body) : null,
    };
  }

  // --- llms.txt: presence ET contenu ----------------------------------------------
  const llmsRes = await budget.fetch(origin + "/llms.txt", auth);
  if (llmsRes.skipped || llmsRes.error) out.llms = { state: "not_checked", reason: llmsRes.reason || llmsRes.error };
  else {
    const isReal = llmsRes.status === 200 && !/<html/i.test(llmsRes.body || "");
    out.llms = { state: "observed", present: isReal, status: llmsRes.status, raw: isReal ? llmsRes.body : "" };
  }

  // --- Sitemaps: index recursif borne ---------------------------------------------
  const declared = out.robots?.parsed?.sitemaps || [];
  const seeds = [...new Set([origin + "/sitemap.xml", ...declared])];
  out.sitemaps = [];
  out.sitemapEntries = [];
  const queue = seeds.slice(0, opts.maxSitemapFiles);
  const seenSitemaps = new Set();
  while (queue.length && out.sitemaps.length < opts.maxSitemapFiles) {
    const loc = queue.shift();
    if (seenSitemaps.has(loc)) continue;
    seenSitemaps.add(loc);
    const r = await budget.fetch(loc, auth);
    if (r.skipped) { out.sitemaps.push({ loc, state: "not_checked", reason: r.reason }); continue; }
    if (r.error) { out.sitemaps.push({ loc, state: "observed", ok: false, error: r.error }); continue; }
    const body = r.body || "";
    const looksXml = /<(urlset|sitemapindex)\b/i.test(body);
    const entry = { loc, state: "observed", ok: r.status === 200 && looksXml, status: r.status, bytes: body.length, servedAsHtml: r.status === 200 && !looksXml && /<html/i.test(body) };
    if (entry.ok && isSitemapIndex(body)) {
      entry.kind = "index";
      const children = parseSitemapIndex(body);
      entry.children = children.length;
      for (const c of children.slice(0, opts.maxSitemapFiles)) queue.push(c.loc);
    } else if (entry.ok) {
      entry.kind = "urlset";
      const urls = parseUrlset(body);
      entry.urls = urls.length;
      out.sitemapEntries.push(...urls.map((u) => ({ ...u, from: loc })));
    }
    out.sitemaps.push(entry);
  }
  out.coverage.sitemap = out.sitemaps.length ? (out.sitemaps.some((s) => s.state === "not_checked") ? "sampled" : "observed") : "not_checked";

  // --- Variantes d'origine: http, www, slash final --------------------------------
  // Deux versions accessibles en 200 = contenu duplique a l'echelle du site entier.
  const host = new URL(origin).host;
  const altHost = host.startsWith("www.") ? host.slice(4) : "www." + host;
  const variantTargets = [
    { key: "http", url: origin.replace(/^https:/, "http:") + "/" },
    { key: "altHost", url: `https://${altHost}/` },
  ];
  out.variants = {};
  for (const v of variantTargets) {
    const res = await followChain(budget, v.url, 4);
    out.variants[v.key] = {
      target: v.url, state: res.state, reason: res.reason,
      status: res.status, hops: res.chain.length, chain: res.chain,
      final: res.final, loop: Boolean(res.loop),
      // 200 sans redirection vers l'origine canonique = duplication.
      duplicate: res.state === "observed" && res.status === 200 && !res.final.startsWith(origin),
    };
  }

  // --- 404: statut reel d'une URL inexistante -------------------------------------
  // Un "soft 404" (page d'erreur servie en 200) fait indexer des pages vides.
  const probe = `${origin}/panoptic-probe-404-${hash(origin)}`;
  const notFound = await budget.fetch(probe, { ...auth, redirect: "follow" });
  if (notFound.skipped || notFound.error) out.notFound = { state: "not_checked", reason: notFound.reason || notFound.error };
  else {
    const body = notFound.body || "";
    out.notFound = {
      state: "observed", status: notFound.status, probe,
      soft404: notFound.status === 200,
      // Une SPA renvoie 200 + son shell: on regarde si le shell dit "introuvable".
      mentionsNotFound: /(404|introuvable|not found|page n['e]existe)/i.test(body.slice(0, 4000)),
      bytes: body.length,
    };
  }

  // --- Statut des URLs du sitemap (echantillon stratifie) -------------------------
  // Stratifie: on prend des URLs de profondeurs et de prefixes differents plutot que
  // les 60 premieres, sinon on ne teste qu'une seule section du site.
  const allSitemapUrls = [...new Set(out.sitemapEntries.map((e) => e.loc))];
  const sample = stratify(allSitemapUrls, opts.maxSitemapUrls);
  const checks = await mapLimit(sample, opts.concurrency, async (url) => {
    const r = await budget.fetch(url, { ...auth, redirect: "manual" });
    if (r.skipped) return { url, state: "not_checked", reason: r.reason };
    if (r.error) return { url, state: "observed", status: 0, error: r.error };
    return {
      url, state: "observed", status: r.status,
      location: r.headers?.location || null,
      xRobots: r.headers?.["x-robots-tag"] || null,
      contentType: r.headers?.["content-type"] || null,
    };
  });
  out.sitemapUrlChecks = checks;
  out.coverage.sitemapUrls = allSitemapUrls.length === 0 ? "not_checked"
    : checks.some((c) => c.state === "not_checked") ? "sampled"
    : sample.length < allSitemapUrls.length ? "sampled" : "observed";
  out.sitemapUrlTotal = allSitemapUrls.length;
  out.sitemapUrlSampled = sample.filter((_, i) => checks[i]?.state === "observed").length;

  // --- Reciprocite hreflang -------------------------------------------------------
  // Declarer un alternate ne suffit pas: la page cible doit pointer en retour.
  // Sans reciprocite Google ignore TOUT le cluster, pas seulement le lien fautif.
  const declaredAlternates = collectAlternates(scope, out);
  const altSample = declaredAlternates.slice(0, opts.maxAlternates);
  const altChecks = await mapLimit(altSample, opts.concurrency, async (a) => {
    const r = await budget.fetch(a.href, { ...auth, redirect: "follow" });
    if (r.skipped) return { ...a, state: "not_checked", reason: r.reason };
    if (r.error) return { ...a, state: "observed", status: 0, error: r.error };
    const backlinks = [...(r.body || "").matchAll(/<link\b[^>]*rel\s*=\s*["']alternate["'][^>]*>/gi)].map((m) => m[0]);
    const backHrefs = backlinks.map((t) => ({
      hreflang: (/hreflang\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]?.toLowerCase() || null,
      href: (/href\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1] || null,
    })).filter((x) => x.href);
    return { ...a, state: "observed", status: r.status, finalUrl: r.url, backHrefs, alternateCount: backHrefs.length };
  });
  out.hreflangChecks = altChecks;
  out.coverage.hreflang = declaredAlternates.length === 0 ? "not_checked"
    : altSample.length < declaredAlternates.length || altChecks.some((c) => c.state === "not_checked") ? "sampled" : "observed";

  out.budget = { requests: budget.used, max: opts.maxRequests, ms: Math.round(budget.elapsed), exhausted: budget.exhausted, exhaustedBy: budget.exhaustedBy };
  return out;
}

// Memoise sur le scope: seo et geo tournent en parallele et doivent partager
// exactement le meme resultat, sans doubler les requetes.
export function deepReconShared(scope, options) {
  if (!scope || !scope.reachable) return Promise.resolve(null);
  if (!scope.__deepReconPromise) scope.__deepReconPromise = deepRecon(scope, options).catch((e) => ({ error: e.message, coverage: {}, budget: null }));
  return scope.__deepReconPromise;
}

// Echantillon stratifie par premier segment d'URL puis par profondeur: garantit
// qu'on teste plusieurs sections du site plutot que les N premieres URLs.
function stratify(urls, max) {
  if (urls.length <= max) return urls;
  const buckets = new Map();
  for (const u of urls) {
    let seg = "/";
    try { seg = new URL(u).pathname.split("/").filter(Boolean)[0] || "/"; } catch { /* ignore */ }
    if (!buckets.has(seg)) buckets.set(seg, []);
    buckets.get(seg).push(u);
  }
  const out = [];
  const keys = [...buckets.keys()];
  let round = 0;
  while (out.length < max) {
    let added = false;
    for (const k of keys) {
      const list = buckets.get(k);
      if (round < list.length) { out.push(list[round]); added = true; if (out.length >= max) break; }
    }
    if (!added) break;
    round++;
  }
  return out;
}

// Alternates declares: ceux de l'accueil (HTML) plus ceux du sitemap.
function collectAlternates(scope, deep) {
  const seen = new Map();
  const push = (hreflang, href, source) => {
    if (!href) return;
    let abs = href;
    try { abs = new URL(href, scope.origin).href; } catch { return; }
    if (abs === scope.url) return;   // l'auto-reference n'a rien a verifier
    if (!seen.has(abs)) seen.set(abs, { hreflang, href: abs, source });
  };
  for (const m of (scope.home?.body || "").matchAll(/<link\b[^>]*rel\s*=\s*["']alternate["'][^>]*>/gi)) {
    const t = m[0];
    const hl = (/hreflang\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]?.toLowerCase();
    if (!hl) continue;
    push(hl, (/href\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1], "html");
  }
  for (const e of deep.sitemapEntries || []) {
    for (const a of e.alternates || []) push(a.hreflang, a.href, "sitemap");
  }
  return [...seen.values()];
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
