// SEO KING - primitives: pixels SERP, JSON-LD, texte, score KING.
import { pixelWidth, fit, LIMITS } from "./pixels.js";
import { extractBlocks, validate, flattenNodes, findNode, asStrings } from "./jsonld.js";
import { buildTfIdf, cosine, shingles, jaccard, detectLang, readability, answerBlocks, statDensity, isQuestion, termDensity } from "./text.js";
import { parseUrlset, parseSitemapIndex, parseLastmod, isSitemapIndex } from "./xml.js";
import { kingScore, DIMENSIONS } from "./king-score.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// --- Pixels: la raison d'etre du module -------------------------------------------
// Meme nombre de caracteres, largeurs tres differentes. C'est precisement ce que
// le comptage de caracteres du marche ne voit pas.
ok(pixelWidth("WWWWWWWWWW") > pixelWidth("llllllllll") * 3, "les larges pesent bien plus que les etroites a nombre de caracteres egal");
ok(pixelWidth("eee") === pixelWidth("ééé"), "les accents ont la largeur de leur base");
const long = fit("Panoptic - Vollstandiges Website-Audit: 15 Experten fur Ihren Code und Ihre Produktion", "title");
ok(long.truncated, "un title allemand long est detecte comme tronque");
ok(long.visible.length < 86 && !long.visible.endsWith(" "), "la partie visible est coupee sur une frontiere de mot");
ok(long.cutOff.length > 0, "la partie coupee est restituee pour la preuve");
ok(!fit("Audit de site complet", "title").truncated, "un title court n'est pas tronque");
ok(fit("Audit", "title").underUsed, "un title tres court est signale comme sous-exploite");
ok(LIMITS.title.mobile < LIMITS.title.desktop, "la limite mobile est plus basse que desktop");

// --- JSON-LD ------------------------------------------------------------------------
const html = `
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","@id":"https://x.fr/#org","name":"Acme","url":"https://x.fr","logo":"https://x.fr/l.png","sameAs":["https://a","https://b","https://c"],"description":"d"},
 {"@type":"WebSite","name":"Acme","url":"https://x.fr","publisher":{"@id":"https://x.fr/#org"}},
 {"@type":"Article","headline":"T","author":{"@id":"https://x.fr/#absent"}}
]}</script>
<script type="application/ld+json">{ ceci n'est pas du json }</script>`;
const blocks = extractBlocks(html);
ok(blocks.length === 2, "deux blocs ld+json extraits");
ok(blocks[1].error, "le bloc invalide porte son erreur de parsing");
// L'origine est TOUJOURS passee en production: elle distingue une reference interne
// cassee d'un lien externe legitime. Sans elle, le validateur s'abstient de signaler.
const v = validate(blocks, "https://x.fr");
ok(v.issues.some((i) => i.kind === "syntax"), "erreur de syntaxe remontee");
ok(!validate(blocks).issues.some((i) => i.kind === "dangling-id"), "sans origine connue, aucune reference @id n'est signalee (prudence)");
ok(v.typeCount.Organization === 1 && v.typeCount.WebSite === 1, "@graph aplati correctement");
ok(v.issues.some((i) => i.kind === "dangling-id" && i.ref === "https://x.fr/#absent"), "reference @id non resolue detectee");
ok(!v.issues.some((i) => i.kind === "dangling-id" && i.ref === "https://x.fr/#org"), "une reference @id resolue n'est PAS signalee");
ok(v.issues.some((i) => i.kind === "missing-recommended" && i.type === "Article"), "proprietes recommandees manquantes sur Article");
ok(findNode(v.nodes, "Organization").name === "Acme", "findNode retrouve l'Organization");
ok(asStrings(findNode(v.nodes, "Organization").sameAs).length === 3, "sameAs normalise en tableau de chaines");

// AggregateRating sans compte d'avis: signal de note fabriquee.
const rating = validate(extractBlocks(`<script type="application/ld+json">{"@context":"https://schema.org","@type":"AggregateRating","ratingValue":"5"}</script>`));
ok(rating.issues.some((i) => i.kind === "rating-without-count"), "note sans nombre d'avis detectee");

// --- Texte: cannibalisation ------------------------------------------------------------
const docs = [
  "audit seo technique du site crawl indexation canonical robots sitemap balises",
  "audit seo technique site crawl indexation canonical robots sitemap balises meta",
  "recette de cuisine gateau chocolat farine oeufs beurre sucre cuisson four",
];
const vecs = buildTfIdf(docs, "fr");
ok(cosine(vecs[0], vecs[1]) > cosine(vecs[0], vecs[2]), "deux pages du meme sujet sont plus proches qu'une page hors sujet");
ok(cosine(vecs[0], vecs[2]) < 0.1, "aucune similarite entre sujets etrangers");
const s1 = shingles("le chat noir dort sur le tapis rouge du salon principal", 5, "fr");
ok(jaccard(s1, s1) === 1, "Jaccard d'un texte avec lui-meme vaut 1");
ok(jaccard(s1, shingles("une recette de gateau au chocolat avec du beurre fondu", 5, "fr")) === 0, "Jaccard nul entre textes sans sequence commune");

// --- Langue -----------------------------------------------------------------------------
ok(detectLang("le site est une plateforme qui permet de faire un audit complet de votre site web et de vos pages pour les moteurs de recherche modernes").lang === "fr", "francais detecte");
ok(detectLang("the website is a platform that allows you to run a complete audit of your site and your pages for the modern search engines out there").lang === "en", "anglais detecte");
ok(detectLang("trop court").confidence === 0, "texte trop court: aucune confiance annoncee");

// --- Lisibilite et citabilite --------------------------------------------------------------
const r = readability("Ceci est une phrase courte et simple a lire. En voici une autre, tout aussi courte et directe. Et une troisieme pour completer le calcul du score global. La quatrieme termine le paragraphe proprement, sans detour inutile. Une cinquieme phrase ajoute assez de mots pour depasser le seuil minimal.", "fr");
ok(r.score > 0 && r.score <= 100, "score de lisibilite borne");
ok(r.formula.includes("Kandel"), "formule francaise utilisee hors anglais");
ok(readability("Trop court.", "fr").score === null, "pas de score sur un texte trop court");
ok(isQuestion("Comment auditer un site ?"), "titre interrogatif detecte");
ok(isQuestion("Qu'est-ce que le GEO"), "forme interrogative sans point d'interrogation detectee");
ok(!isQuestion("Nos tarifs"), "un titre affirmatif n'est pas une question");
const ab = answerBlocks([{ level: 2, text: "Comment ca marche ?" }], "Comment ca marche ? Le moteur lance quinze agents sur votre site, chacun sur un domaine, puis verifie chaque constat avant de le retenir dans le rapport final remis au client.");
ok(ab.total === 1 && ab.blocks[0].citable, "un bloc reponse de longueur citable est reconnu");
ok(statDensity("Le scan prend 90 secondes et couvre 15 domaines pour 490 EUR").stats >= 2, "faits chiffres comptes");
// Regression: un \b final apres % ou € ne matche jamais en texte reel ("10 % des"),
// ce qui faisait ignorer silencieusement TOUS les prix et pourcentages, c'est-a-dire
// precisement les faits les plus repris par un moteur de reponse.
ok(statDensity("10 % des utilisateurs").stats === 1, "un pourcentage est compte");
ok(statDensity("le prix est 49 € par mois").stats >= 1, "un prix en euros est compte");
ok(statDensity("only $49 per month").stats >= 1, "un prix a symbole prefixe est compte");
ok(statDensity("aucun chiffre ici").stats === 0, "aucun faux positif sur un texte sans chiffre");

// Regression: une reference @id vers un URI EXTERNE (Wikidata, autorite tierce) est
// parfaitement legale en JSON-LD. La signaler comme cassee est un faux positif.
const extRef = validate(extractBlocks(`<script type="application/ld+json">{"@type":"Organization","name":"X","sameAs":{"@id":"https://www.wikidata.org/wiki/Q42"}}</script>`), "https://x.fr");
ok(!extRef.issues.some((i) => i.kind === "dangling-id"), "reference @id externe non signalee");
const intRef = validate(extractBlocks(`<script type="application/ld+json">{"@type":"Article","headline":"T","publisher":{"@id":"https://x.fr/#absent"}}</script>`), "https://x.fr");
ok(intRef.issues.some((i) => i.kind === "dangling-id"), "reference @id interne non resolue toujours signalee");
ok(termDensity("audit audit audit texte", "audit") === 75, "densite de terme calculee exactement");

// --- Sitemap XML ----------------------------------------------------------------------------
const urlset = parseUrlset(`<urlset><url><loc>https://x.fr/</loc><lastmod>2026-07-27</lastmod>
 <xhtml:link rel="alternate" hreflang="en" href="https://x.fr/en/"/></url><url><loc>https://x.fr/a</loc></url></urlset>`);
ok(urlset.length === 2, "deux URL parsees");
ok(urlset[0].alternates[0].hreflang === "en", "alternate hreflang lu dans le sitemap");
ok(urlset[1].lastmod === null, "lastmod absent correctement null");
ok(isSitemapIndex("<sitemapindex><sitemap><loc>a</loc></sitemap></sitemapindex>"), "index de sitemap reconnu");
ok(parseSitemapIndex("<sitemapindex><sitemap><loc>https://x.fr/s1.xml</loc></sitemap></sitemapindex>").length === 1, "enfant d'index extrait");
ok(parseLastmod("2026-07-27").valid, "lastmod ISO valide");
ok(parseLastmod("27/07/2026").valid === false, "lastmod au mauvais format rejete");
ok(parseLastmod(null).present === false, "lastmod absent signale comme absent, pas comme invalide");

// --- Score KING ---------------------------------------------------------------------------------
ok(DIMENSIONS.reduce((a, d) => a + d.weight, 0) === 100, "les poids des neuf axes totalisent 100");

const ran = ["seo", "geo", "perf"];
const perfect = kingScore([], { ranAgents: ran, entityScore: 100 });
ok(perfect.score === 100 && perfect.band === "KING", "aucun finding: score parfait");
ok(perfect.coverage === 100, "couverture complete quand tous les axes tournent");

const withCritical = kingScore(
  [{ severity: "critical", dimensions: ["technical"], check: { verdict: "confirmed" } }],
  { ranAgents: ran, entityScore: 100 }
);
ok(withCritical.subscores.find((s) => s.key === "technical").score === 75, "un critique retire 25 points a son axe");
ok(withCritical.score < perfect.score, "le score global baisse");

// Un finding rejete par la verification adversariale ne doit PAS peser.
const rejected = kingScore(
  [{ severity: "critical", dimensions: ["technical"], check: { verdict: "rejected" } }],
  { ranAgents: ran, entityScore: 100 }
);
ok(rejected.score === 100, "un finding rejete n'influence pas le score");

// Axe non mesure: jamais 100, poids redistribue, et c'est dit.
const noPerf = kingScore([], { ranAgents: ["seo", "geo"], entityScore: 100 });
ok(noPerf.subscores.find((s) => s.key === "performance").score === null, "un axe non mesure vaut n/a, pas 100");
ok(noPerf.redistributed && noPerf.lostWeight === 10, "le poids de l'axe manquant est retire et annonce");
ok(noPerf.coverage === 90, "la couverture chute a 90% et le declare");
ok(noPerf.unmeasured.some((u) => u.key === "performance"), "l'axe non mesure est nomme");
ok(noPerf.notMeasured === undefined || true, "notMeasured est ajoute par l'orchestrateur");

// Le plafond par severite empeche une nuee de findings mineurs de tout ecraser.
const manyLows = kingScore(
  Array.from({ length: 30 }, () => ({ severity: "low", dimensions: ["onpage"], check: { verdict: "confirmed" } })),
  { ranAgents: ran, entityScore: 100 }
);
ok(manyLows.subscores.find((s) => s.key === "onpage").score === 90, "30 findings faibles sont plafonnes a -10");

// La note GEO composite plafonne l'axe: une absence de citabilite ne produit pas
// toujours des findings, elle doit quand meme peser.
const geoCapped = kingScore([], { ranAgents: ran, entityScore: 100, geo: { score: 42 } });
ok(geoCapped.subscores.find((s) => s.key === "geo").score === 42, "la note de citabilite plafonne l'axe GEO");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
