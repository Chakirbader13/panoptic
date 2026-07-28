// SEO KING - detection des ecarts HTML brut / DOM rendu.
//
// Un site statique ne prouve rien: il n'a aucun ecart. On sert donc un site qui casse
// exprES, une panne par page, et on verifie que chacune est detectee ET qu'aucune
// n'est inventee sur la page temoin.
//
// Le test se saute proprement si Chromium n'est pas installe: c'est exactement la
// degradation que le moteur promet en production, autant la respecter ici.
import { createServer } from "node:http";
import { recon } from "../recon.js";
import { runShared } from "./index.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// Chromium disponible ? Sinon on sort en succes, en le disant.
let hasBrowser = false;
try {
  const pw = await import("playwright");
  const b = await pw.chromium.launch({ headless: true });
  await b.close();
  hasBrowser = true;
} catch { /* pas de navigateur ici */ }

if (!hasBrowser) {
  console.log("  Chromium indisponible: test de rendu saute (degradation attendue en serverless)");
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(0);
}

const SHELL_TITLE = "Mon application";
const TEXT = "audit technique du site analyse des pages structure des donnees performance indexation ".repeat(8);

// Chaque page sert un HTML brut, plus un script qui le modifie APRES chargement.
function doc({ title = SHELL_TITLE, head = "", body = "", script = "" }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>${head}</head>
<body>${body}<script>${script}<\/script></body></html>`;
}

const server = createServer((req, res) => {
  const path = req.url.split("?")[0].replace(/\/$/, "") || "/";
  res.setHeader("content-type", "text/html; charset=utf-8");

  if (path === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
  if (path === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); return res.end("<?xml version=\"1.0\"?><urlset></urlset>"); }

  // TEMOIN: tout est deja dans le HTML servi. Ne doit generer AUCUN constat d'ecart.
  if (path === "/") {
    return res.end(doc({
      title: "Accueil complet servi par le serveur",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/">
        <meta name="description" content="Description servie par le serveur">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Temoin"}<\/script>`,
      body: `<h1>Accueil</h1><p>${TEXT}</p>
        <a href="/jsonld-js">a</a><a href="/canonical-js">b</a><a href="/titre-js">c</a><a href="/liens-js">d</a><a href="/noindex-js">e</a><a href="/texte-js">f</a><a href="/typo-js">g</a>`,
    }));
  }

  // 1. JSON-LD injecte par JavaScript.
  if (path === "/jsonld-js") {
    return res.end(doc({
      title: "Page avec balisage injecte",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/jsonld-js">`,
      body: `<h1>Balisage injecte</h1><p>${TEXT}</p><a href="/">accueil</a>`,
      script: `const s=document.createElement('script');s.type='application/ld+json';
        s.textContent=JSON.stringify({"@context":"https://schema.org","@type":"Product","name":"Chose"});
        document.head.appendChild(s);`,
    }));
  }

  // 2. Canonical reecrite par JavaScript vers une AUTRE URL.
  if (path === "/canonical-js") {
    return res.end(doc({
      title: "Page a canonical reecrite",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/canonical-js">`,
      body: `<h1>Canonical reecrite</h1><p>${TEXT}</p><a href="/">accueil</a>`,
      script: `document.querySelector('link[rel=canonical]').setAttribute('href','http://127.0.0.1:${server.port}/autre-page');`,
    }));
  }

  // 3. Titre du shell, remplace au rendu (piege classique des applications monopage).
  if (path === "/titre-js") {
    return res.end(doc({
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/titre-js">`,
      body: `<h1>Titre injecte</h1><p>${TEXT}</p><a href="/">accueil</a>`,
      script: `document.title = "Le vrai titre de la page, pose par JavaScript";`,
    }));
  }

  // 4. Navigation construite en JavaScript.
  if (path === "/liens-js") {
    return res.end(doc({
      title: "Page a navigation JavaScript",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/liens-js">`,
      body: `<h1>Navigation injectee</h1><p>${TEXT}</p><nav id="nav"></nav>`,
      script: `const n=document.getElementById('nav');
        for (let i=1;i<=12;i++){const a=document.createElement('a');a.href='/profond-'+i;a.textContent='page '+i;n.appendChild(a);}`,
    }));
  }

  // 5. noindex injecte apres coup: la page se desindexe toute seule.
  if (path === "/noindex-js") {
    return res.end(doc({
      title: "Page qui se desindexe",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/noindex-js">`,
      body: `<h1>Desindexation</h1><p>${TEXT}</p><a href="/">accueil</a>`,
      script: `const m=document.createElement('meta');m.name='robots';m.content='noindex,follow';document.head.appendChild(m);`,
    }));
  }

  // 7. Titre reecrit uniquement en typographie (apostrophe droite -> courbe).
  // Techniquement une reecriture, semantiquement identique: ne doit RIEN declencher.
  if (path === "/typo-js") {
    return res.end(doc({
      title: "L'audit d'un site \"complet\" - 2026",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/typo-js">`,
      body: `<h1>Typographie</h1><p>${TEXT}</p><a href="/">accueil</a>`,
      script: `document.title = "L\u2019audit d\u2019un site \u201ccomplet\u201d \u2013 2026";`,
    }));
  }

  // 6. Contenu entierement injecte: le HTML servi est une coquille vide.
  if (path === "/texte-js") {
    return res.end(doc({
      title: "Page a contenu injecte",
      head: `<link rel="canonical" href="http://127.0.0.1:${server.port}/texte-js">`,
      body: `<div id="app"></div>`,
      script: `document.getElementById('app').innerHTML =
        '<h1>Contenu injecte</h1><h2>Comment ca marche ?</h2><p>${TEXT}</p>';`,
    }));
  }

  if (/^\/profond-\d+$/.test(path)) {
    return res.end(doc({ title: "Page profonde", body: `<h1>Profond</h1><p>${TEXT}</p><a href="/">accueil</a>` }));
  }

  res.statusCode = 404;
  res.end(doc({ title: "404", body: "<h1>Introuvable</h1>" }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
server.port = server.address().port;
const BASE = `http://127.0.0.1:${server.port}`;

const scope = await recon(BASE, { maxPages: 10, browserScan: true });
const r = await runShared(scope, { renderPages: 8 });
const rules = new Set(r.findings.filter((f) => f.lane === "render-delta").map((f) => f.rule));
const byRule = (rule) => r.findings.find((f) => f.rule === rule);

// --- Le rendu a bien eu lieu -------------------------------------------------------
ok(r.render?.available === true, "le rendu navigateur s'est active");
ok(r.render.stats.rendered >= 5, `plusieurs pages rendues (${r.render?.stats?.rendered})`);
ok(r.render.attached >= 5, `les DOM rendus sont rattaches au graphe (${r.render?.attached})`);
ok(r.render.stats.failed === 0, `aucun echec de rendu (${r.render?.stats?.failed})`);

// --- Chaque panne plantee est detectee ----------------------------------------------
ok(rules.has("jsonld-js-only"), "JSON-LD injecte par JavaScript detecte");
ok(rules.has("canonical-mismatch-render"), "canonical divergente entre brut et rendu detectee");
ok(rules.has("internal-links-js-only"), "maillage interne construit en JavaScript detecte");
ok(rules.has("noindex-injected-by-js"), "noindex injecte au rendu detecte");
ok(rules.has("title-js-only") || rules.has("shell-title-shared"), "titre reecrit par JavaScript detecte");

// --- Les preuves nomment la bonne page et les deux valeurs --------------------------
const canon = byRule("canonical-mismatch-render");
ok(canon && /canonical-js/.test(canon.proof) && /autre-page/.test(canon.proof),
   "la preuve canonical cite l'URL servie ET l'URL rendue");
ok(canon?.severity === "critical", "une canonical contradictoire est critique");
const nox = byRule("noindex-injected-by-js");
ok(nox?.severity === "critical", "une desindexation injectee est critique");
const links = byRule("internal-links-js-only");
ok(links && /profond-/.test(links.proof), "la preuve du maillage nomme des URLs decouvrables seulement apres rendu");
const jsonld = byRule("jsonld-js-only");
ok(jsonld && /Product/.test(jsonld.proof), "la preuve JSON-LD nomme le type qui n'apparait qu'apres rendu");

// --- Chaque constat dit A QUI il s'applique ------------------------------------------
const deltas = r.findings.filter((f) => f.lane === "render-delta" && f.severity !== "info");
ok(deltas.length > 0 && deltas.every((f) => f.audience), "chaque ecart nomme le public concerne");
ok(deltas.some((f) => f.audience === "moteurs de reponse IA"), "certains ecarts visent les moteurs de reponse");
ok(deltas.some((f) => f.audience === "moteurs de recherche"), "d'autres visent les moteurs de recherche");

// --- Faux positif de typographie: le piege rencontre sur un vrai site ------------------
// Une SPA qui remplace ses apostrophes droites par des apostrophes courbes au rendu
// declenchait "titre reecrit par JavaScript": vrai a la lettre, vide de sens.
{
  const typo = r.__nodes?.get?.(BASE + "/typo-js") || null;
  ok(Boolean(typo?.raw && typo?.rendered), "la page typographique a bien ete rendue");
  if (typo) {
    ok(typo.raw.title !== typo.rendered.title, "les deux titres different bien caractere pour caractere");
    const titleFinding = r.findings.find((f) => (f.rule === "title-js-only" || f.rule === "shell-title-shared") && /typo-js/.test(String(f.proof)));
    ok(!titleFinding, "mais aucun constat n'est emis: la difference est purement typographique");
  }
}

// --- AUCUN faux positif de normalisation ---------------------------------------------
// Le piege: le navigateur resout les URLs relatives et decode les entites. Sur la page
// temoin, tout est deja servi: aucun ecart ne doit etre signale la.
const home = scope.crawl.pages.find((p) => p.url === BASE + "/");
ok(Boolean(home), "la page temoin a bien ete crawlee");
ok(!rules.has("content-mostly-js"), "aucun faux constat de contenu majoritairement JavaScript");
const delta = r.renderDelta;
ok(delta.visibleRatio >= 70, `le ratio de contenu servi reste eleve malgre les pages piegees (${delta.visibleRatio}%)`);
ok(delta.canonChanged === 1, `exactement une page a une canonical divergente (${delta.canonChanged})`);
ok(delta.noindexInjected === 1, `exactement une page se desindexe au rendu (${delta.noindexInjected})`);

// --- Les DEUX vues coexistent: c'est tout l'interet du dispositif -----------------------
// Sur la page dont le contenu est entierement injecte, la vue "moteur de recherche"
// (DOM rendu) doit voir le texte, et la vue "moteur de reponse" (HTML servi) ne doit
// PAS le voir. Si les deux disent la meme chose, le basculement est casse.
{
  const texteJs = r.__nodes?.get?.(BASE + "/texte-js") || null;
  ok(Boolean(texteJs?.raw && texteJs?.rendered), "la page a contenu injecte porte bien ses deux vues");
  if (texteJs?.raw && texteJs?.rendered) {
    ok(texteJs.rendered.words > texteJs.raw.words + 50,
       `le DOM rendu contient le texte (${texteJs.rendered.words} mots) que le HTML servi n'a pas (${texteJs.raw.words})`);
    ok(texteJs.rendered.headings.length > texteJs.raw.headings.length,
       "les titres injectes n'existent que dans la vue rendue");
    // Valeur principale = rendu (verite Google), vue brute preservee (verite IA).
    ok(texteJs.words === texteJs.rendered.words, "la valeur principale du noeud suit le DOM rendu");
    ok(texteJs.raw.words < 50, "la vue HTML servi reste bien celle d'une coquille vide");
  }
}

// --- Sans navigateur, degradation propre ------------------------------------------------
const scope2 = await recon(BASE, { maxPages: 4, browserScan: false });
const r2 = await runShared(scope2, {});
const l2 = r2.lanes.find((x) => x.id === "render-delta");
ok(r2.render === null || r2.render === undefined, "sans autorisation navigateur, aucun rendu n'est lance");
ok(l2.skipped && /non demande/.test(l2.skipped), "la lane se tait en DISANT pourquoi");
ok(l2.findings === 0, "et ne produit aucun constat invente");

server.close();
console.log(`\n  ecarts detectes: ${[...rules].join(", ")}`);
console.log(`  rendu: ${r.render.stats.rendered} pages en ${(r.render.stats.ms / 1000).toFixed(1)}s`);
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
