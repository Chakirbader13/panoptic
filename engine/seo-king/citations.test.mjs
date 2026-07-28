// SEO KING - mesure des citations IA: parties deterministes.
//
// Aucun appel reseau ici. Les fournisseurs sont remplaces par des reponses figees:
// un test qui depenserait de l'argent a chaque execution ne serait jamais lance, et
// un test dont le resultat depend de l'humeur d'un LLM ne prouve rien.
import { derivePrompts, deriveCategory } from "./citations/prompts.js";
import { measureCitations } from "./citations/measure.js";
import { domainOf, availableProviders } from "./citations/providers.js";
import { buildGraph } from "./graph.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// --- Domaines ---------------------------------------------------------------------
ok(domainOf("https://www.exemple.fr/page?a=1") === "exemple.fr", "URL complete reduite au domaine");
ok(domainOf("exemple.fr") === "exemple.fr", "domaine nu accepte (Gemini renvoie le domaine en titre)");
ok(domainOf("WWW.Exemple.FR") === "exemple.fr", "casse et www normalises");
ok(domainOf("") === null && domainOf("pas une url") === null, "entree invalide -> null");

// --- Categorie: la ou le site la declare -------------------------------------------
const mkGraph = (title, extra = "") => {
  const html = `<html lang="fr"><head><title>${title}</title>
    <meta name="description" content="Une description quelconque">${extra}</head>
    <body><h1>Un titre</h1><h2>Comment auditer un site web rapidement ?</h2>
    <p>${"contenu ".repeat(120)}</p></body></html>`;
  const scope = { origin: "https://x.fr", url: "https://x.fr/", reachable: true,
    home: { status: 200, body: html, headers: {} },
    crawl: { pages: [{ url: "https://x.fr/", status: 200, title, html }] } };
  return buildGraph(scope, null);
};

ok(deriveCategory(mkGraph("Panoptic - Audit de site complet : 15 experts sur votre code"), "Panoptic", "fr")
   === "audit de site complet", "categorie prise apres le nom de marque dans le title");
ok(deriveCategory(mkGraph("Acme | Logiciel de facturation pour PME"), "Acme", "fr")
   === "logiciel de facturation", "connecteur interne conserve, coupe a 4 mots");
// Garde de qualite: mieux vaut aucune categorie qu'une categorie inventee.
ok(deriveCategory(mkGraph("Acme"), "Acme", "fr") === null, "title reduit a la marque -> aucune categorie");
ok(deriveCategory(mkGraph("Acme - 15 experts"), "Acme", "fr") === null, "un chiffre coupe: fragment trop court -> aucune categorie");
ok(deriveCategory(mkGraph("Bienvenue"), "Acme", "fr") === null, "un seul mot -> aucune categorie");

// --- Prompts ----------------------------------------------------------------------
const g = mkGraph("Panoptic - Audit de site complet : 15 experts");
const prompts = derivePrompts({ brand: "Panoptic", category: "audit de site", lang: "fr", graph: g, limit: 8 });
ok(prompts.some((p) => p.kind === "marque" && /Qu'est-ce que Panoptic/.test(p.text)), "question d'entite posee");
ok(prompts.some((p) => p.kind === "categorie" && /audit de site/.test(p.text)), "question commerciale posee sur la categorie");
ok(prompts.some((p) => p.kind === "question" && /Comment auditer un site web/.test(p.text)), "les propres questions du site sont reprises verbatim");
ok(prompts.every((p) => p.text.length > 10 && p.intent), "chaque prompt porte une intention explicite");
// Determinisme: c'est ce qui rend deux audits comparables dans le temps.
const again = derivePrompts({ brand: "Panoptic", category: "audit de site", lang: "fr", graph: g, limit: 8 });
ok(JSON.stringify(prompts) === JSON.stringify(again), "la derivation est deterministe");
// Sans categorie, on ne fabrique pas de question commerciale.
const noCat = derivePrompts({ brand: "Panoptic", category: null, lang: "fr", graph: g, limit: 8 });
ok(!noCat.some((p) => p.kind === "categorie"), "aucune question commerciale inventee sans categorie");
ok(noCat.some((p) => p.kind === "marque"), "la question d'entite reste posee");

// --- Mesure, fournisseurs simules ---------------------------------------------------
const fakeEnv = { PANOPTIC_PERPLEXITY_KEY: "x".repeat(20) };
const stub = (answers) => {
  const mod = availableProviders(fakeEnv).find((p) => p.available).provider;
  const original = mod.ask;
  mod.ask = async (prompt) => answers[prompt] || answers.default;
  return () => { mod.ask = original; };
};

const P = [
  { id: "p1", kind: "marque", text: "Qu'est-ce que Acme ?" },
  { id: "p2", kind: "categorie", text: "Meilleures solutions pour facturation ?" },
];

// 1. Site cite: taux de citation non nul, classement correct.
{
  const restore = stub({
    "Qu'est-ce que Acme ?": { answer: "Acme est un logiciel de facturation reconnu.", citedDomains: ["acme.fr", "concurrent.fr"] },
    "Meilleures solutions pour facturation ?": { answer: "Parmi les solutions de facturation: Acme et d'autres.", citedDomains: ["concurrent.fr", "autre.fr"] },
  });
  const r = await measureCitations(P, { siteDomain: "acme.fr", brand: "Acme", category: "logiciel de facturation", topicTerms: ["facturation"], env: fakeEnv });
  restore();
  ok(r.state === "observed", "mesure aboutie");
  ok(r.citationRate === 50, `taux de citation exact (${r.citationRate}%)`);
  ok(r.mentionRate === 100, "mentions verifiees: le sujet est bien celui du site");
  ok(r.ambiguousCount === 0, "aucune mention ambigue quand le sujet correspond");
  ok(r.sample.prompts === 2 && r.sample.successful === 2, "l'echantillon est annonce");
  // concurrent.fr est cite 2 fois, acme.fr 1 fois: un seul domaine STRICTEMENT devant.
  ok(r.aheadCount === 1, `seules les sources strictement plus citees comptent (${r.aheadCount})`);
  ok(r.competitorsAhead[0]?.domain === "concurrent.fr", "le concurrent le plus cite est nomme");
  ok(r.tiedCount === 1, `les ex aequo sont comptes a part (${r.tiedCount})`);
}

// 2. Marque homonyme d'un mot courant: le nom apparait, le sujet non.
{
  const restore = stub({
    default: { answer: "Le terme panoptic designe un dispositif de surveillance imagine par Bentham.", citedDomains: ["dictionary.com"] },
  });
  const r = await measureCitations(P, { siteDomain: "panopticaudit.com", brand: "Panoptic", category: "audit de site", topicTerms: ["audit", "rapport"], env: fakeEnv });
  restore();
  ok(r.ambiguousCount === 2, `les occurrences hors sujet sont classees ambigues (${r.ambiguousCount})`);
  ok(r.mentionRate === 0, "elles ne gonflent PAS le taux de mention");
  ok(r.ambiguousSample.length > 0 && r.ambiguousSample[0].excerpt, "un extrait probant est conserve");
}

// 3. Jamais cite, jamais mentionne.
{
  const restore = stub({ default: { answer: "Voici plusieurs options du marche.", citedDomains: ["autre.fr"] } });
  const r = await measureCitations(P, { siteDomain: "absent.fr", brand: "Absent", category: "logiciel", topicTerms: [], env: fakeEnv });
  restore();
  ok(r.citationRate === 0 && r.mentionRate === 0, "absence totale correctement mesuree");
  ok(r.sitePosition === null, "le site n'apparait pas au classement");
}

// 4. Panne de fournisseur: aucun chiffre invente.
{
  const restore = stub({ default: { error: "HTTP 429: quota depasse" } });
  const r = await measureCitations(P, { siteDomain: "acme.fr", brand: "Acme", env: fakeEnv });
  restore();
  ok(r.state === "not_measured", "un fournisseur en panne ne produit pas de mesure");
  ok(/429|quota/.test(r.reason || ""), "la cause de l'echec est rapportee");
  ok(r.citationRate === undefined || r.citationRate === null, "aucun taux publie sans donnee");
}

// 5. Aucune cle: la lane se tait proprement, sans jamais simuler.
{
  const r = await measureCitations(P, { siteDomain: "acme.fr", brand: "Acme", env: {} });
  ok(r.state === "not_measured", "sans cle, aucune mesure");
  ok(Array.isArray(r.providersKnown) && r.providersKnown.length >= 2, "les fournisseurs supportes sont listes pour l'operateur");
  ok(!("citationRate" in r), "aucun taux fabrique en l'absence de cle");
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
