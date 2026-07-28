// Panoptic SEO KING - lane donnees structurees.
// Un JSON-LD invalide est PIRE que pas de JSON-LD: l'equipe croit avoir des donnees
// structurees, Google ignore le bloc en silence, et personne ne s'en apercoit.

import { extractBlocks, validate, findNode, asStrings } from "../jsonld.js";

export const id = "schema";

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["schema"], url: scope.url, ...r });

  const pages = graph.crawledPages();
  const perPage = new Map();
  let totalBlocks = 0, totalParsed = 0;
  const allTypes = {};

  for (const p of pages) {
    if (!p.html) continue;
    const blocks = extractBlocks(p.html);
    if (!blocks.length) { perPage.set(p.url, null); continue; }
    const v = validate(blocks, origin);
    perPage.set(p.url, v);
    totalBlocks += v.blockCount;
    totalParsed += v.parsedCount;
    for (const [t, c] of Object.entries(v.typeCount)) allTypes[t] = (allTypes[t] || 0) + c;
  }
  ctx.schema = { perPage, allTypes };

  const withNone = [...perPage.entries()].filter(([, v]) => !v).map(([u]) => u);
  if (withNone.length === pages.length && pages.length) {
    F({
      rule: "no-structured-data", severity: "medium", effort: 0.5,
      title: "Aucune donnee structuree sur le site",
      proof: `${pages.length} page(s) analysee(s), aucun bloc application/ld+json. Sans donnees structurees, ni les rich results ni l'extraction de faits par les moteurs de reponse ne sont possibles.`,
      fix: "Publier au minimum Organization et WebSite sur l'accueil, puis BreadcrumbList sur les pages internes.",
      verifiability: "self-evident",
      dimensions: ["schema", "geo"],
    });
    return { findings: out, strengths };
  }

  // --- Syntaxe -----------------------------------------------------------------------
  const syntaxErrors = [];
  for (const [url, v] of perPage) {
    if (!v) continue;
    for (const i of v.issues.filter((x) => x.kind === "syntax")) syntaxErrors.push({ url, ...i });
  }
  if (syntaxErrors.length) {
    F({
      rule: "invalid-jsonld", severity: "high", effort: 0.2,
      title: `${syntaxErrors.length} bloc(s) JSON-LD non parsable(s)`,
      url: syntaxErrors[0].url,
      proof: syntaxErrors.slice(0, 3).map((e) => `${short(e.url)} bloc #${e.blockIndex}: ${e.message}. Extrait: ${e.snippet.slice(0, 80)}`).join(" | "),
      fix: "Corriger la syntaxe JSON. Un bloc invalide est integralement ignore par les moteurs.",
      verifiability: "self-evident",
    });
  } else if (totalBlocks) {
    strengths.push(`${totalParsed}/${totalBlocks} blocs JSON-LD valides syntaxiquement`);
  }

  // --- Proprietes requises -------------------------------------------------------------
  const missingReq = [];
  const missingRec = [];
  const dangling = [];
  const ratingNoCount = [];
  const notes = new Set();
  for (const [url, v] of perPage) {
    if (!v) continue;
    for (const i of v.issues) {
      if (i.kind === "missing-required") missingReq.push({ url, ...i });
      else if (i.kind === "missing-recommended") missingRec.push({ url, ...i });
      else if (i.kind === "dangling-id") dangling.push({ url, ...i });
      else if (i.kind === "rating-without-count") ratingNoCount.push({ url, ...i });
      else if (i.kind === "note") notes.add(i.note);
    }
  }

  if (missingReq.length) {
    const byType = group(missingReq, (x) => x.type);
    F({
      rule: "schema-missing-required", severity: "high", effort: 0.3,
      title: `Proprietes obligatoires manquantes sur ${byType.size} type(s) de schema`,
      url: missingReq[0].url,
      proof: [...byType.entries()].slice(0, 4).map(([t, list]) => `${t}: ${[...new Set(list.flatMap((x) => x.props))].join(", ")} (${short(list[0].url)})`).join(" | ") + ". Sans elles, aucune eligibilite aux rich results.",
      fix: "Completer les proprietes requises par type selon les exigences Google Rich Results.",
      verifiability: "self-evident",
    });
  }
  if (missingRec.length) {
    const byType = group(missingRec, (x) => x.type);
    F({
      rule: "schema-missing-recommended", severity: "low", effort: 0.3,
      title: `Proprietes recommandees absentes sur ${byType.size} type(s) de schema`,
      proof: [...byType.entries()].slice(0, 4).map(([t, list]) => `${t}: ${[...new Set(list.flatMap((x) => x.props))].slice(0, 5).join(", ")}`).join(" | "),
      fix: "Completer: l'affichage enrichi est degrade sans ces proprietes, meme quand le balisage est valide.",
      verifiability: "self-evident",
    });
  }
  if (dangling.length) {
    F({
      rule: "schema-dangling-id", severity: "medium", effort: 0.2,
      title: `${dangling.length} reference(s) @id qui ne resolvent nulle part`,
      url: dangling[0].url,
      proof: dangling.slice(0, 4).map((d) => `${d.type || "?"}.${d.prop} -> "${d.ref}" (aucun noeud avec cet @id)`).join(" | ") + ". Le graphe d'entite est casse: l'Organization et le WebSite ne sont plus relies.",
      fix: "Declarer le noeud cible dans le meme @graph, ou pointer vers un @id existant.",
      verifiability: "cross-checked",
      dimensions: ["schema", "entity"],
    });
  }
  if (ratingNoCount.length) {
    F({
      rule: "aggregate-rating-without-count", severity: "high", effort: 0.3,
      title: "AggregateRating sans reviewCount ni ratingCount",
      url: ratingNoCount[0].url,
      proof: `${ratingNoCount.length} bloc(s) AggregateRating declarent une note sans nombre d'avis. Google exige le compte et sanctionne les notes non adossees a des avis reels; c'est aussi un risque de pratique commerciale trompeuse.`,
      fix: "Declarer reviewCount avec le nombre reel d'avis collectes, ou retirer l'AggregateRating.",
      verifiability: "self-evident",
      dimensions: ["schema", "content"],
    });
  }

  // --- Couverture par archetype de page --------------------------------------------------
  const home = graph.get(scope.url);
  const homeSchema = perPage.get(home?.url);
  if (homeSchema) {
    const types = Object.keys(homeSchema.typeCount);
    const hasOrg = types.some((t) => ["Organization", "LocalBusiness", "Corporation"].includes(t));
    const hasSite = types.includes("WebSite");
    if (!hasOrg) {
      F({
        rule: "no-organization-schema", severity: "medium", effort: 0.3,
        title: "Pas de schema Organization sur l'accueil",
        proof: `Types presents: ${types.join(", ") || "aucun"}. Sans Organization, aucun ancrage d'entite: le Knowledge Graph n'a rien a rattacher a la marque.`,
        fix: "Ajouter Organization (name, url, logo, sameAs, description) avec un @id stable reutilise partout.",
        verifiability: "self-evident",
        dimensions: ["schema", "entity"],
      });
    } else strengths.push("Schema Organization present sur l'accueil");
    if (!hasSite) {
      F({
        rule: "no-website-schema", severity: "low", effort: 0.2,
        title: "Pas de schema WebSite sur l'accueil",
        proof: `Types presents: ${types.join(", ") || "aucun"}.`,
        fix: "Ajouter WebSite (name, url, publisher pointant vers l'@id de l'Organization).",
        verifiability: "self-evident",
      });
    }
  }

  const deep = pages.filter((p) => p.depth > 0 && p.status === 200);
  const withoutBreadcrumb = deep.filter((p) => { const v = perPage.get(p.url); return !v || !v.typeCount.BreadcrumbList; });
  if (deep.length >= 3 && withoutBreadcrumb.length === deep.length) {
    F({
      rule: "no-breadcrumb-schema", severity: "low", effort: 0.3,
      title: `Aucun BreadcrumbList sur les ${deep.length} pages internes`,
      proof: "Le fil d'Ariane structure remplace l'URL nue dans les resultats et clarifie la hierarchie du site pour les moteurs.",
      fix: "Ajouter BreadcrumbList sur chaque page interne, avec la position et le nom de chaque niveau.",
      verifiability: "self-evident",
      dimensions: ["schema", "architecture"],
    });
  }

  // --- Notes de contexte: a savoir, pas a corriger ------------------------------------
  if (notes.has("info:faq-no-serp")) {
    F({
      rule: "faq-schema-context", severity: "info", effort: 0,
      title: "FAQPage present: plus de rich result SERP, mais toujours utile pour l'IA",
      proof: "Google a retire les rich results FAQ le 7 mai 2026 (hors sites sante et administration). Le balisage reste lu par les moteurs de reponse pour extraire des paires question/reponse.",
      fix: "Ne pas retirer le balisage existant. Ne pas en ajouter de nouveau dans l'espoir d'un affichage SERP.",
      verifiability: "self-evident",
      dimensions: ["schema", "geo"],
    });
  }
  if (notes.has("info:howto-retired")) {
    F({
      rule: "howto-schema-retired", severity: "info", effort: 0,
      title: "HowTo present: rich result retire par Google",
      proof: "Les rich results HowTo ne sont plus affiches. Le balisage ne nuit pas et reste exploitable par les moteurs de reponse.",
      fix: "Aucune action. Ne pas investir dans du nouveau balisage HowTo pour un gain SERP.",
      verifiability: "self-evident",
    });
  }

  const typeList = Object.entries(allTypes).sort((a, b) => b[1] - a[1]);
  if (typeList.length) strengths.push(`Types de schema couverts: ${typeList.slice(0, 6).map(([t, c]) => `${t}${c > 1 ? ` x${c}` : ""}`).join(", ")}`);

  return { findings: out, strengths };
}

function group(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
