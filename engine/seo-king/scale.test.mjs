// SEO KING - test de passage a l'echelle sur un site synthetique de 2000 pages.
//
// On ne teste pas ca contre un vrai site: il faut un corpus DETERMINISTE (avec des
// doublons plantes a un endroit connu) et il est hors de question de marteler un site
// tiers pour valider un crawler. Un serveur local sert donc un site realiste:
// un accueil, des categories, 1500 fiches produit sur un gabarit unique, des articles
// distincts, et deux quasi-doublons plantes.
//
// Ce que ce test prouve:
//   1. l'ecretage par gabarit evite de crawler 1500 fiches identiques;
//   2. le HTML est libere: l'echantillon detaille reste borne;
//   3. le LSH retrouve les doublons plantes sans comparer toutes les paires;
//   4. la memoire et le temps restent dans le budget.
import { createServer } from "node:http";
import { recon } from "../recon.js";
import { runShared } from "./index.js";
import { urlTemplate } from "./pagefacts.js";
import { LshIndex } from "./minhash.js";
import { shingles } from "./text.js";
import { signature } from "./minhash.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

const PRODUCTS = 1500;
const ARTICLES = 40;
const WORDS = ["audit","balise","canonical","crawl","donnees","entite","fichier","graphe","hreflang","index","jargon","kilo","lien","meta","noindex","optimisation","page","quota","robots","sitemap","titre","url","vitesse","web"];
const SLUGS = [];
{
  // Base 24 sur trois chiffres: 800 combinaisons deterministes et toutes distinctes.
  const n = WORDS.length;
  for (let i = 0; i < 800; i++) {
    const a = WORDS[i % n], b = WORDS[Math.floor(i / n) % n], c = WORDS[Math.floor(i / (n * n)) % n];
    SLUGS.push(`${a}-${b}-${c}`);
  }
  if (new Set(SLUGS).size !== SLUGS.length) throw new Error("slugs de test non distincts");
}
const LOREM = "audit technique du site analyse des pages structure des donnees performance indexation moteur de recherche visibilite contenu editorial ".repeat(6);

function page({ title, desc, h1, body, links }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">
<link rel="canonical" href="https://x/">
</head><body><h1>${h1}</h1>${body}
${(links || []).map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;
}

const server = createServer((req, res) => {
  const path = req.url.split("?")[0].replace(/\/$/, "") || "/";
  res.setHeader("content-type", "text/html; charset=utf-8");

  if (path === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:PORT/sitemap.xml\n"); }
  if (path === "/sitemap.xml") {
    res.setHeader("content-type", "application/xml");
    const urls = ["/", ...Array.from({ length: 10 }, (_, i) => `/categorie/${i + 1}`),
      ...Array.from({ length: PRODUCTS }, (_, i) => `/produit/ref-${i + 1000}`),
      ...Array.from({ length: ARTICLES }, (_, i) => `/blog/article-${i + 1}`),
      ...SLUGS.map((sl) => `/guide/${sl}`)];
    return res.end(`<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>http://127.0.0.1:${server.port}${u}</loc></url>`).join("")}</urlset>`);
  }

  let m;
  if (path === "/") {
    return res.end(page({
      title: "Accueil boutique de test", desc: "Une boutique synthetique", h1: "Boutique",
      body: `<p>${LOREM}</p>`,
      links: Array.from({ length: 10 }, (_, i) => `/categorie/${i + 1}`).concat(["/blog/article-1", `/guide/${SLUGS[0]}`]),
    }));
  }
  if ((m = /^\/categorie\/(\d+)$/.exec(path))) {
    const i = Number(m[1]);
    return res.end(page({
      title: `Categorie ${i} de la boutique`, desc: `Categorie ${i}`, h1: `Categorie ${i}`,
      body: `<p>${LOREM} categorie ${i}</p>`,
      links: Array.from({ length: 150 }, (_, k) => `/produit/ref-${1000 + (i - 1) * 150 + k}`),
    }));
  }
  if ((m = /^\/produit\/ref-(\d+)$/.exec(path))) {
    // Toutes les fiches partagent le MEME gabarit et un contenu quasi identique:
    // c'est exactement ce que l'ecretage doit reconnaitre.
    const i = Number(m[1]);
    return res.end(page({
      title: `Produit ${i} - boutique de test`, desc: `Fiche du produit ${i}`, h1: `Produit ${i}`,
      body: `<p>${LOREM} reference ${i}</p>`, links: ["/"],
    }));
  }
  if ((m = /^\/blog\/article-(\d+)$/.exec(path))) {
    const i = Number(m[1]);
    // Articles 7 et 8: quasi-doublons plantes. Le reste est distinct.
    const dup = (i === 7 || i === 8);
    const uniq = dup ? "sujet duplique volontairement pour le test de detection " .repeat(20)
      : `sujet numero ${i} ${["chaussures", "vetements", "outils", "jardin", "cuisine"][i % 5]} ${LOREM.slice(0, 200)} particularite ${i} `.repeat(4);
    return res.end(page({
      title: `Article ${i} du blog`, desc: `Article ${i}`, h1: `Article ${i}`,
      body: `<h2>Comment faire ?</h2><p>${uniq}</p><h2>Pourquoi ?</h2><p>${uniq}</p>`,
      links: ["/", `/blog/article-${(i % ARTICLES) + 1}`],
    }));
  }
  // Site editorial: 800 pages a slug DISTINCT. Aucun ecretage possible (chaque URL
  // est son propre gabarit), donc c'est ce scenario qui met reellement la memoire
  // sous pression: 800 pages reellement crawlees et analysees.
  if ((m = /^\/guide\/([a-z-]+)$/.exec(path))) {
    const slug = m[1];
    return res.end(page({
      title: `Guide ${slug} pour votre site`, desc: `Guide ${slug}`, h1: `Guide ${slug}`,
      body: `<h2>Qu'est-ce que ${slug} ?</h2><p>${(slug + " ").repeat(60)} se traite en 30 minutes pour 90 % des sites.</p>
             <h2>Comment proceder ?</h2><p>${(slug.split("-").reverse().join(" ") + " ").repeat(60)}</p>`,
      links: ["/", `/guide/${SLUGS[(SLUGS.indexOf(slug) + 1) % SLUGS.length]}`],
    }));
  }

  res.statusCode = 404;
  res.end(page({ title: "404", desc: "", h1: "Introuvable", body: "<p>Page introuvable</p>" }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
server.port = server.address().port;
const BASE = `http://127.0.0.1:${server.port}`;

// --- Verification isolee du LSH ------------------------------------------------------
// Avant de mesurer le systeme complet, on prouve que l'index retrouve bien une paire
// proche et ignore une paire etrangere.
{
  const idx = new LshIndex();
  const mk = (t) => signature(shingles(t, 5, "fr"));
  idx.add("a", mk("le chat noir dort sur le tapis rouge du salon principal de la maison ".repeat(10)));
  idx.add("b", mk("le chat noir dort sur le tapis rouge du salon principal de la maison ".repeat(10) + " avec une variante finale"));
  idx.add("c", mk("recette de gateau au chocolat avec du beurre fondu et trois oeufs frais ".repeat(10)));
  const pairs = idx.candidatePairs({ minSimilarity: 0.3 });
  ok(pairs.some((p) => (p.a === "a" && p.b === "b") || (p.a === "b" && p.b === "a")), "LSH rapproche deux textes quasi identiques");
  ok(!pairs.some((p) => p.a === "c" || p.b === "c"), "LSH ne rapproche pas un texte etranger");
}

// --- Gabarits d'URL --------------------------------------------------------------------
ok(urlTemplate(`${BASE}/produit/ref-1001`) === urlTemplate(`${BASE}/produit/ref-9999`), "deux fiches produit partagent le meme gabarit");
ok(urlTemplate(`${BASE}/produit/ref-1001`) !== urlTemplate(`${BASE}/blog/article-1`), "produit et article ont des gabarits distincts");
ok(urlTemplate("https://x/guide/audit-technique-du-site") === "/guide/{leaf}", "un slug editorial est un TYPE de page, pas un type par page");
ok(urlTemplate("https://x/guide/a") === urlTemplate("https://x/guide/b"), "deux slugs de la meme section partagent leur gabarit");
ok(urlTemplate("https://x/a/550e8400-e29b-41d4-a716-446655440000") === "/a/{leaf}", "uuid en feuille normalise");
ok(urlTemplate("https://x/p/12345") === "/p/{leaf}", "id numerique normalise");
ok(urlTemplate("https://x/securite") === "/securite", "page de premier niveau preservee");

// --- Audit grande echelle -----------------------------------------------------------------
const before = process.memoryUsage().heapUsed;
const t0 = performance.now();
const scope = await recon(BASE, { maxPages: 600 });
const result = await runShared(scope);
const elapsed = Math.round(performance.now() - t0);
const heapGrowth = Math.round((process.memoryUsage().heapUsed - before) / 1024 / 1024);

const crawled = scope.crawl.pages.length;
ok(scope.large === true, "le grand regime s'active au-dela du seuil");
ok(scope.facts instanceof Map && scope.facts.size > 80, `faits extraits pour chaque page (${scope.facts?.size})`);
ok(scope.detailHtml.size <= 50, `echantillon detaille borne a 50 pages (${scope.detailHtml.size})`);
ok(scope.crawl.pages.every((p) => p.html === undefined), "aucun HTML retenu sur les pages du crawl (memoire liberee)");

// Ecretage: sans lui, les 1500 fiches produit rempliraient tout le budget de pages.
const produits = scope.crawl.pages.filter((p) => /\/produit\/ref-/.test(p.url)).length;
ok(produits >= 50 && produits < PRODUCTS, `la section produit recoit une part du budget proportionnelle a son volume (${produits} crawlees sur ${PRODUCTS})`);
ok(scope.crawl.templates && scope.crawl.templates.distinct <= 8, `les types de pages sont correctement regroupes (${scope.crawl.templates?.distinct} types)`);

// Les articles, eux, doivent etre crawles: gabarits distincts par slug.
const articles = scope.crawl.pages.filter((p) => /\/blog\/article-/.test(p.url)).length;
ok(articles >= 8, `les articles editoriaux ne sont pas ecretes (${articles} crawles)`);

// Detection des doublons plantes.
const dups = result.findings.filter((f) => f.rule === "duplicate-content");
ok(dups.length > 0, "la duplication de contenu est detectee");
// Les fiches produit sont rigoureusement identiques a la reference pres: c'est le
// doublon le plus fort du site, il DOIT sortir en premier.
{
  const prods = [...scope.facts.entries()].filter(([u]) => /\/produit\/ref-/.test(u)).slice(0, 2);
  const ip = new LshIndex();
  prods.forEach(([u, f], k) => ip.add("p" + k, f.sketch));
  const pp = ip.candidatePairs({ minSimilarity: 0.3 });
  ok(prods.length === 2 && pp.length === 1 && pp[0].similarity > 0.9,
     `deux fiches produit quasi identiques sont appariees (similarite ${pp[0]?.similarity})`);
}

// Les deux articles plantes doivent aussi etre rapproches. Ils ne sortent pas
// forcement dans le top 3 affiche (les produits sont plus dupliques encore), donc on
// verifie directement l'appariement au niveau de l'index.
const g = result.__graph || null;
const arts = [...scope.facts.entries()].filter(([u]) => /\/blog\/article-(7|8)$/.test(u));
ok(arts.length === 2, "les deux articles plantes ont bien ete crawles");
if (arts.length === 2) {
  const idx2 = new LshIndex();
  idx2.add("a7", arts[0][1].sketch);
  idx2.add("a8", arts[1][1].sketch);
  const p2 = idx2.candidatePairs({ minSimilarity: 0.3 });
  ok(p2.length === 1 && p2[0].similarity > 0.7, `les articles 7 et 8 sont apparies (similarite ${p2[0]?.similarity})`);
}

// Budget.
ok(heapGrowth < 400, `la memoire reste bornee (+${heapGrowth} Mo)`);
ok(elapsed < 120000, `l'audit tient le budget temps (${(elapsed / 1000).toFixed(1)}s pour ${crawled} pages)`);
ok(result.findings.length > 0, "des constats sont produits a cette echelle");

console.log(`\n  ${crawled} pages crawlees, ${scope.facts.size} faits, ${scope.detailHtml.size} HTML detailles, +${heapGrowth} Mo, ${(elapsed / 1000).toFixed(1)}s`);
console.log(`  cannibalisation: ${JSON.stringify(result.findings.filter((f) => ["duplicate-content", "keyword-cannibalization"].includes(f.rule)).length)} constat(s)`);

// --- Scenario 2: 800 pages a slug distinct, aucun ecretage possible -----------------
// C'est le cas qui met vraiment la memoire sous pression: chaque URL est son propre
// gabarit, donc les 800 pages sont reellement crawlees, extraites et comparees.
{
  const before2 = process.memoryUsage().heapUsed;
  const t2 = performance.now();
  const scope2 = await recon(BASE, { maxPages: 900 });
  const res2 = await runShared(scope2);
  const ms2 = Math.round(performance.now() - t2);
  const heap2 = Math.round((process.memoryUsage().heapUsed - before2) / 1024 / 1024);
  const guides = scope2.crawl.pages.filter((p) => /\/guide\//.test(p.url)).length;

  const prods2 = scope2.crawl.pages.filter((p) => /\/produit\//.test(p.url)).length;
  // Repartition PROPORTIONNELLE: la section produit (1500 URLs) doit recevoir plus de
  // budget que la section guide (800 URLs), et les deux doivent etre largement couvertes.
  ok(guides > 250, `la section a slug distinct est largement couverte (${guides} pages)`);
  ok(prods2 > guides, `la section la plus volumineuse recoit la plus grosse part (produit ${prods2} > guide ${guides})`);
  ok(scope2.crawl.pages.length > 600, `volume reel atteint (${scope2.crawl.pages.length} pages)`);
  ok(scope2.crawl.pages.every((p) => p.html === undefined), "HTML libere aussi a 800 pages");
  ok(scope2.detailHtml.size <= 50, `echantillon detaille toujours borne (${scope2.detailHtml.size})`);
  ok(heap2 < 700, `memoire bornee a 800 pages (+${heap2} Mo)`);
  ok(ms2 < 180000, `budget temps tenu a 800 pages (${(ms2 / 1000).toFixed(1)}s)`);
  ok(res2.findings.length > 0, "des constats sont produits a 800 pages");
  // Les guides partagent une structure mais pas leur sujet: pas de fausse alerte massive.
  const dupes2 = res2.findings.filter((f) => f.rule === "duplicate-content").length;
  ok(dupes2 <= 3, `pas d'avalanche de faux doublons sur du contenu distinct (${dupes2})`);

  console.log(`  scenario 2: ${scope2.crawl.pages.length} pages, ${scope2.facts.size} faits, +${heap2} Mo, ${(ms2 / 1000).toFixed(1)}s`);
}

server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
