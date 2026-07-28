// SEO KING - regressions anti-faux-positifs.
//
// Chacun de ces cas a REELLEMENT ete produit par le moteur lors du premier audit
// live, puis corrige. Ils sont figes ici parce qu'un faux positif est le seul defaut
// qui detruit la confiance dans un outil d'audit: un client qui verifie un constat
// faux ne verifiera plus jamais les autres.
import { buildGraph } from "./graph.js";
import { parseRobots } from "./robots.js";
import * as technical from "./lanes/technical.js";
import * as sitemapLane from "./lanes/sitemap.js";
import * as hreflangLane from "./lanes/hreflang.js";
import * as onpage from "./lanes/onpage.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };
const has = (res, rule) => res.findings.some((f) => f.rule === rule);
const find = (res, rule) => res.findings.find((f) => f.rule === rule);

const ORIGIN = "https://alias.example";
const CANON = "https://canonique.example";

const page = (path, canonical, siblings = [], extra = "") => ({
  url: ORIGIN + path,
  status: 200,
  title: `Titre ${path}`,
  desc: "Une description de page",
  h1: 1,
  canonical,
  noindex: false,
  words: 400,
  html: `<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>Titre ${path}</title><meta name="description" content="Une description de page">
    <link rel="canonical" href="${canonical}">
    <link rel="alternate" hreflang="fr" href="${CANON}/"><link rel="alternate" hreflang="en" href="${CANON}/en/">
    <link rel="alternate" hreflang="x-default" href="${CANON}/">${extra}</head>
    <body><h1>Titre ${path}</h1><p>${"contenu ".repeat(80)}</p>
    ${siblings.map((s) => `<a href="${s}">page ${s}</a>`).join("")}</body></html>`,
});

function makeCtx({ paths, robotsTxt, sitemapUrls, alias }) {
  // Chaque page lie toutes les autres: sans maillage, une orpheline serait
  // correctement detectee et le test testerait autre chose que ce qu'il annonce.
  const pages = paths.map((p) => page(p, `${CANON}${p === "/" ? "/" : p}`, paths.filter((x) => x !== p)));
  const scope = {
    origin: ORIGIN, url: ORIGIN + "/", reachable: true,
    home: { status: 200, body: pages[0].html, headers: {} },
    crawl: { pages },
  };
  const deep = {
    robots: { state: "observed", present: true, parsed: parseRobots(robotsTxt || "User-agent: *\nAllow: /\n") },
    llms: { state: "observed", present: false, status: 404 },
    sitemaps: [{ loc: ORIGIN + "/sitemap.xml", state: "observed", ok: true, kind: "urlset", urls: sitemapUrls.length }],
    sitemapEntries: sitemapUrls.map((loc) => ({ loc, lastmod: null, alternates: [], from: ORIGIN + "/sitemap.xml" })),
    sitemapUrlChecks: sitemapUrls.map((url) => ({ url, state: "observed", status: 200 })),
    hreflangChecks: [],
    variants: {}, notFound: { state: "observed", status: 404 },
    coverage: {}, budget: { requests: 10 },
  };
  const graph = buildGraph(scope, deep);
  return { scope, deep, graph, alias, options: {} };
}

// --- Regression 1: domaine alias -------------------------------------------------------
// Toutes les pages se canonicalisent vers UN SEUL autre domaine. C'est une
// configuration deliberee (alias de marque, preproduction Netlify), pas un critique.
const aliasCtx = makeCtx({
  paths: ["/", "/en", "/de"],
  sitemapUrls: [CANON + "/", CANON + "/en", CANON + "/de"],
  alias: { canonicalOrigin: CANON, pages: 3, total: 3, ratio: 100 },
});
const aliasTech = technical.run(aliasCtx);
ok(!has(aliasTech, "cross-origin-canonical"), "alias: pas de critique 'canonical vers un autre domaine'");
ok(has(aliasTech, "alias-domain"), "alias: un constat informatif explique la configuration");
ok(find(aliasTech, "alias-domain").severity === "info", "alias: severite info, pas critique");

// Sans alias (une seule page part ailleurs), le critique DOIT revenir.
const leakCtx = makeCtx({ paths: ["/", "/en", "/de"], sitemapUrls: [ORIGIN + "/"], alias: null });
leakCtx.graph.get(ORIGIN + "/en").canonicalNormalized = CANON + "/en";
const leakTech = technical.run(leakCtx);
ok(has(leakTech, "cross-origin-canonical"), "fuite d'indexation partielle: le critique reste leve");

// --- Regression 2: URL de sitemap d'un autre domaine -----------------------------------
// Le sitemap declarait 16 URL de panopticaudit.com; le moteur les comptait comme des
// pages orphelines de l'alias, et declarait toutes les pages locales absentes du sitemap.
const foreignSm = sitemapLane.run(aliasCtx);
ok(!has(foreignSm, "orphan-pages"), "sitemap etranger: aucune page orpheline inventee");
ok(!has(foreignSm, "pages-missing-from-sitemap"), "sitemap etranger: aucun trou de couverture invente");
ok(has(foreignSm, "sitemap-points-to-canonical"), "sitemap etranger: explique vers quel domaine il pointe");
ok(aliasCtx.graph.list().every((n) => n.url.startsWith(ORIGIN)), "aucun noeud d'un autre domaine n'entre dans le graphe");

// Hors alias, un sitemap qui declare un autre domaine reste une vraie anomalie.
const foreignNoAlias = sitemapLane.run(makeCtx({ paths: ["/"], sitemapUrls: [CANON + "/a", CANON + "/b"], alias: null }));
ok(has(foreignNoAlias, "sitemap-foreign-urls"), "hors alias: URL etrangeres au sitemap signalees");

// --- Regression 3: reciprocite hreflang depuis un alias ---------------------------------
// Les alternates pointent vers le domaine canonique et celui-ci ne pointe pas en
// retour vers l'alias: c'est exactement le comportement correct.
const aliasHreflang = hreflangLane.run(aliasCtx);
ok(!has(aliasHreflang, "hreflang-not-reciprocal"), "alias: aucune fausse non-reciprocite");
ok(!has(aliasHreflang, "hreflang-no-self-reference"), "alias: aucune fausse absence d'auto-reference");
ok(has(aliasHreflang, "hreflang-on-alias-domain"), "alias: indique ou verifier le vrai cluster");

// --- Regression 4: page fermee par robots.txt -------------------------------------------
// /console est en Disallow: auditer sa canonical ou son title est du bruit.
// Piege reel: l'URL normalisee perd son slash final, la regle est "Disallow: /console/".
const blockedCtx = makeCtx({
  paths: ["/", "/console"],
  robotsTxt: "User-agent: *\nAllow: /\nDisallow: /console/\n",
  sitemapUrls: [ORIGIN + "/"],
  alias: null,
});
ok(blockedCtx.graph.get(ORIGIN + "/console").robotsBlocked, "page interdite reconnue malgre le slash final de la regle");
ok(blockedCtx.graph.crawledPages().every((p) => !p.url.endsWith("/console")), "les pages fermees sortent du perimetre auditable");
ok(blockedCtx.graph.allCrawled().some((p) => p.url.endsWith("/console")), "elles restent visibles pour le controle des statuts");

// --- Regression 5: alternates dedoublonnes ------------------------------------------------
// L'accueil etait enrichi deux fois (crawl + recon): aretes sortantes et alternates
// comptes en double, ce qui faussait PageRank, liens entrants et lecture hreflang.
const homeNode = aliasCtx.graph.get(ORIGIN + "/");
const altKeys = homeNode.alternates.map((a) => `${a.hreflang}|${a.href}`);
ok(new Set(altKeys).size === altKeys.length, "aucun alternate en double sur l'accueil");
const outKeys = homeNode.outLinks.map((e) => e.to);
ok(new Set(outKeys).size === outKeys.length, "aucune arete sortante dupliquee");

// --- Garde-fou general: un site sain ne doit produire aucun constat inventé ----------------
const clean = makeCtx({ paths: ["/", "/a"], sitemapUrls: [ORIGIN + "/", ORIGIN + "/a"], alias: null });
const cleanTech = technical.run(clean);
ok(!has(cleanTech, "missing-canonical"), "site sain: aucune canonical manquante inventee");
ok(!has(cleanTech, "missing-viewport"), "site sain: viewport correctement detectee");
ok(!has(cleanTech, "missing-html-lang"), "site sain: attribut lang correctement detecte");
const cleanSm = sitemapLane.run(clean);
ok(!has(cleanSm, "orphan-pages"), "site sain: aucune orpheline inventee");
ok(!has(cleanSm, "sitemap-dead-urls"), "site sain: aucune URL morte inventee");
ok(cleanTech.strengths.length > 0, "les points deja corrects sont remontes, pas seulement les defauts");

// --- Toute regle emise doit porter une preuve et un niveau de verifiabilite -----------------
const allFindings = [aliasTech, leakTech, foreignSm, aliasHreflang, cleanTech, cleanSm, onpage.run(clean)].flatMap((r) => r.findings);
ok(allFindings.every((f) => f.proof && String(f.proof).length > 20), "chaque constat porte une preuve citable");
ok(allFindings.every((f) => f.verifiability), "chaque constat declare son niveau de verifiabilite");
ok(allFindings.every((f) => f.fix), "chaque constat porte un correctif");
ok(allFindings.every((f) => Array.isArray(f.dimensions) && f.dimensions.length), "chaque constat alimente au moins un axe du score");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
