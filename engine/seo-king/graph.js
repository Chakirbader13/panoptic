// Panoptic SEO KING - graphe d'evidence unifie.
//
// Les meilleurs diagnostics SEO deterministes ne sont pas des checks isoles, ce sont
// des INCOHERENCES DE GRAPHE: une canonical qui pointe vers une page elle-meme
// canonicalisee ailleurs, une locale qui ne repond pas en retour, une URL dans le
// sitemap que rien ne lie, une page money a quatre clics de l'accueil. Aucune de ces
// erreurs n'est visible page par page. On construit donc le graphe une fois, et
// toutes les lanes le lisent.
//
// Noeuds: URLs normalisees. Aretes typees: link (avec ancre), canonical, hreflang,
// sitemap, redirect.

import { isAllowed } from "./robots.js";
import { extractFacts } from "./pagefacts.js";

export function normalizeUrl(u, origin) {
  try {
    const url = new URL(u, origin);
    url.hash = "";
    // On garde la query: ?page=2 est une autre page. On retire le slash final
    // (sauf racine) pour ne pas dedoubler /a et /a/.
    let p = url.pathname.replace(/\/+$/, "") || "/";
    return url.origin + p + (url.search || "");
  } catch { return null; }
}

// Construit le graphe a partir du crawl partage (scope.crawl) et de la deep-recon.
export function buildGraph(scope, deep) {
  const origin = scope.origin;
  const home = normalizeUrl(scope.url, origin);
  const nodes = new Map();

  const node = (url) => {
    const n = normalizeUrl(url, origin);
    if (!n) return null;
    if (!nodes.has(n)) {
      nodes.set(n, {
        url: n, path: pathOf(n, origin),
        crawled: false, status: null, title: null, desc: null,
        h1Count: 0, words: 0, noindex: false, nofollow: false, canonical: null,
        canonicalNormalized: null, lang: null, headings: [], text: "",
        inLinks: [], outLinks: [], inSitemap: false, sitemapLastmod: null,
        alternates: [], depth: null, rank: 0,
      });
    }
    return nodes.get(n);
  };

  node(home);

  // --- Pages crawlees ---------------------------------------------------------------
  // Deux sources possibles, selon le regime de la recon:
  //   - petit regime: chaque page porte son HTML, on enrichit depuis le HTML;
  //   - grand regime: le HTML a ete libere, on enrichit depuis les faits deja extraits.
  // Les lanes ne voient pas la difference: un noeud expose les memes champs.
  const pages = scope.crawl?.pages || [];
  const factsMap = scope.facts || null;
  for (const p of pages) {
    const n = node(p.url);
    if (!n) continue;
    n.crawled = true;
    n.status = p.status;
    n.title = p.title;
    n.desc = p.desc;
    n.h1Count = p.h1 || 0;
    n.words = p.words || 0;
    n.noindex = Boolean(p.noindex);
    n.canonical = p.canonical || null;
    n.canonicalNormalized = p.canonical ? normalizeUrl(p.canonical, p.url) : null;
    n.error = p.error || null;

    const f = factsMap?.get(p.url);
    if (p.html) enrichFromHtml(n, p.html, p.url, origin, node);
    else if (f) enrichFromFacts(n, f, origin, node);
    // Le HTML brut n'existe que pour l'echantillon detaille en grand regime.
    if (!n.html && scope.detailHtml?.has(p.url)) n.html = scope.detailHtml.get(p.url);
  }

  // L'accueil a toujours son HTML complet via la recon, meme sans crawl multi-pages.
  if (scope.home?.body) {
    const h = node(home);
    h.crawled = true;
    h.status = scope.home.status;
    enrichFromHtml(h, scope.home.body, scope.url, origin, node);
  }

  // --- Sitemap ----------------------------------------------------------------------
  // Seules les URL de CETTE origine entrent dans le graphe. Un sitemap qui declare
  // un autre domaine (alias de marque, migration) creerait sinon des noeuds jamais
  // crawles, comptes a tort comme pages orphelines: c'est un faux positif massif.
  for (const e of deep?.sitemapEntries || []) {
    if (!sameOrigin(e.loc, origin)) continue;
    const n = node(e.loc);
    if (!n) continue;
    n.inSitemap = true;
    n.sitemapLastmod = e.lastmod || null;
    if (e.alternates?.length) n.alternates.push(...e.alternates.map((a) => ({ ...a, source: "sitemap" })));
  }

  // --- Statuts observes par la deep-recon (prioritaires sur l'absence de crawl) -----
  for (const c of deep?.sitemapUrlChecks || []) {
    if (c.state !== "observed" || !sameOrigin(c.url, origin)) continue;
    const n = node(c.url);
    if (!n) continue;
    if (n.status == null) n.status = c.status;
    n.observedStatus = c.status;
    n.redirectTo = c.location || null;
    n.xRobots = c.xRobots || null;
  }

  // --- Pages volontairement interdites au crawl -------------------------------------
  // Un Disallow est une DECISION. Auditer le title, la canonical ou le contenu d'une
  // page que le proprietaire a explicitement fermee produit du bruit, pas du conseil.
  const robotsParsed = deep?.robots?.parsed;
  if (robotsParsed) {
    for (const n of nodes.values()) {
      try {
        // normalizeUrl retire le slash final, or robots.txt fait de la correspondance
        // LITTERALE: "Disallow: /console/" ne matche pas "/console". Le crawler, lui,
        // demande bien "/console/". On teste donc les deux formes et on retient le
        // blocage si l'une des deux est interdite.
        const path = new URL(n.url).pathname;
        const forms = path === "/" ? ["/"] : [path, path.endsWith("/") ? path.slice(0, -1) : path + "/"];
        n.robotsBlocked = forms.some((p) => !isAllowed(robotsParsed, "Googlebot", p).allowed);
      } catch { n.robotsBlocked = false; }
    }
  }

  // --- Profondeur de crawl (BFS depuis l'accueil, aretes link uniquement) ----------
  const depth = bfsDepth(nodes, home);
  for (const [url, d] of depth) { const n = nodes.get(url); if (n) n.depth = d; }

  // --- Autorite interne approchee (PageRank simplifie, 20 iterations) --------------
  pagerank(nodes);

  return {
    origin, home, nodes,
    list: () => [...nodes.values()],
    get: (u) => nodes.get(normalizeUrl(u, origin)) || null,
    // Pages auditables: crawlees, en 200, et non fermees par robots.txt.
    crawledPages: () => [...nodes.values()].filter((n) => n.crawled && n.status === 200 && !n.error && !n.robotsBlocked),
    // Tout ce qui a ete crawle, y compris les pages fermees: la lane technique en a
    // besoin pour verifier les statuts.
    allCrawled: () => [...nodes.values()].filter((n) => n.crawled),
  };
}

export function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

// Enrichissement depuis les faits deja extraits (grand regime). Doit produire
// exactement les memes champs que enrichFromHtml, sinon une lane se comporterait
// differemment selon la taille de l'audit, ce qui serait un piege a bugs.
function enrichFromFacts(n, f, origin, node) {
  if (n.__enriched) return;
  n.__enriched = true;
  n.facts = f;
  n.headings = f.headings;
  n.text = f.textSample;          // extrait borne: le texte complet a ete libere
  n.textLength = f.textLength;
  n.derived = f.derived;          // metriques calculees quand le texte etait complet
  n.sketch = f.sketch;
  n.topTerms = f.topTerms;
  n.template = f.template;
  n.metas = f.metas;
  n.lang = f.lang;
  n.robotsDirectives = f.robotsDirectives;
  n.noindex = n.noindex || f.noindex;
  n.nofollow = f.nofollow;
  n.canonicalCount = f.canonicalCount;
  n.images = f.images;
  n.jsonld = f.jsonld;
  n.externalLinks = f.externalLinks;
  n.allLinks = f.allLinks;
  n.words = f.words || n.words;
  if (f.canonical && !n.canonical) {
    n.canonical = f.canonical;
    n.canonicalNormalized = normalizeUrl(f.canonical, n.url);
  }
  for (const a of f.alternates || []) n.alternates.push({ ...a, source: "html" });

  for (const l of f.internalLinks || []) {
    const target = node(l.abs);
    if (!target || target.url === n.url) continue;
    const edge = { from: n.url, to: target.url, anchor: l.anchor, rel: l.rel, source: l.source };
    n.outLinks.push(edge);
    target.inLinks.push(edge);
  }
}

// Enrichissement depuis le HTML brut (petit regime). Delegue au MEME extracteur que
// le grand regime: c'est la seule garantie qu'une lane ne se comporte pas differemment
// selon la taille de l'audit. Seule difference assumee: on conserve le texte complet
// et le HTML, puisqu'on peut se le permettre a cette echelle.
function enrichFromHtml(n, html, baseUrl, origin, node) {
  // L'accueil est enrichi deux fois (une fois depuis le crawl, une fois depuis la
  // recon). Sans ce garde, ses aretes sortantes et ses alternates seraient doubles,
  // ce qui fausse le PageRank, le compte de liens entrants et la lecture hreflang.
  if (n.__enriched) return;
  const f = extractFacts(baseUrl, html, { status: n.status ?? 200, origin, keepFullText: true });
  enrichFromFacts(n, f, origin, node);
  n.html = html;
}

function safeAbs(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}

function pathOf(url, origin) {
  try { return new URL(url).pathname + new URL(url).search; } catch { return url.replace(origin, "") || "/"; }
}

// Profondeur = nombre minimal de clics depuis l'accueil. Les pages a plus de 3 clics
// recoivent structurellement moins d'autorite et sont crawlees moins souvent.
function bfsDepth(nodes, home) {
  const depth = new Map();
  if (!nodes.has(home)) return depth;
  depth.set(home, 0);
  let frontier = [home];
  let d = 0;
  while (frontier.length && d < 12) {
    d++;
    const next = [];
    for (const url of frontier) {
      const n = nodes.get(url);
      if (!n) continue;
      for (const e of n.outLinks) {
        if (depth.has(e.to)) continue;
        depth.set(e.to, d);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  return depth;
}

// PageRank simplifie: montre ou l'autorite interne s'accumule reellement.
// Le but n'est pas de reproduire Google, c'est de repondre a "mes pages qui
// convertissent recoivent-elles du jus, ou tout part-il dans le footer ?".
function pagerank(nodes, damping = 0.85, iterations = 20) {
  const list = [...nodes.values()];
  const N = list.length || 1;
  const index = new Map(list.map((n, i) => [n.url, i]));
  let rank = new Array(N).fill(1 / N);
  const outCount = list.map((n) => new Set(n.outLinks.map((e) => e.to)).size);

  for (let it = 0; it < iterations; it++) {
    const next = new Array(N).fill((1 - damping) / N);
    let dangling = 0;
    for (let i = 0; i < N; i++) if (outCount[i] === 0) dangling += rank[i];
    for (let i = 0; i < N; i++) {
      if (outCount[i] === 0) continue;
      const share = (damping * rank[i]) / outCount[i];
      for (const to of new Set(list[i].outLinks.map((e) => e.to))) {
        const j = index.get(to);
        if (j != null) next[j] += share;
      }
    }
    const spread = (damping * dangling) / N;
    for (let i = 0; i < N; i++) next[i] += spread;
    rank = next;
  }
  const max = Math.max(...rank, 1e-9);
  list.forEach((n, i) => { n.rank = Math.round((rank[i] / max) * 1000) / 1000; });
}

// Chaine de canonicals: A -> B -> C. Google ne suit pas les chaines de canonical,
// il choisit lui-meme. Une chaine = perte de controle sur l'URL indexee.
export function canonicalChains(graph) {
  const out = [];
  for (const n of graph.list()) {
    if (!n.canonicalNormalized || n.canonicalNormalized === n.url) continue;
    const target = graph.nodes.get(n.canonicalNormalized);
    if (!target) continue;
    if (target.canonicalNormalized && target.canonicalNormalized !== target.url) {
      out.push({ from: n.url, via: target.url, to: target.canonicalNormalized, loop: target.canonicalNormalized === n.url });
    }
  }
  return out;
}

// Diversite des ancres vers une page. Une page ciblee par 40 liens tous ancres
// "en savoir plus" ne recoit aucun signal semantique.
export function anchorProfile(node) {
  const anchors = node.inLinks.map((e) => (e.anchor || "").trim().toLowerCase()).filter(Boolean);
  const counts = new Map();
  for (const a of anchors) counts.set(a, (counts.get(a) || 0) + 1);
  const generic = anchors.filter((a) => /^(en savoir plus|lire la suite|cliquez ici|ici|voir|plus|read more|learn more|click here|more|link|details?|découvrir|decouvrir)$/i.test(a)).length;
  return {
    total: node.inLinks.length,
    withAnchor: anchors.length,
    empty: node.inLinks.length - anchors.length,
    unique: counts.size,
    generic,
    genericRatio: anchors.length ? Math.round((generic / anchors.length) * 100) : 0,
    top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
