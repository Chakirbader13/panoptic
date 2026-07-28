// Panoptic SEO KING - lane entite et Knowledge Graph.
//
// Etre bien reference, c'est etre une PAGE que le moteur comprend. Etre cite par une
// IA, c'est etre une ENTITE que le moteur reconnait. La difference se joue sur la
// coherence: le meme nom, le meme @id, les memes profils officiels, partout.
// Une marque nommee de trois facons differentes sur son propre site n'est une entite
// pour personne.

import { extractBlocks, validate, findNode, asStrings, typesOf } from "../jsonld.js";

export const id = "entity";

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["entity"], url: scope.url, ...r });

  const home = graph.get(scope.url);
  if (!home?.html) return { findings: out, strengths, skipped: "accueil indisponible" };

  const blocks = extractBlocks(home.html);
  const v = blocks.length ? validate(blocks, origin) : null;
  const org = v ? (findNode(v.nodes, "Organization") || findNode(v.nodes, "LocalBusiness") || findNode(v.nodes, "Corporation")) : null;
  const site = v ? findNode(v.nodes, "WebSite") : null;

  const props = home.metas?.property || {};
  const ogSite = props["og:site_name"] || null;
  const titleBrand = brandFromTitle(home.title);
  const schemaName = org?.name || null;

  let score = 100;

  // --- Nom de marque: une seule forme, partout -----------------------------------------
  const names = [
    schemaName && { source: "schema Organization.name", value: schemaName },
    ogSite && { source: "og:site_name", value: ogSite },
    titleBrand && { source: "suffixe du <title>", value: titleBrand },
  ].filter(Boolean);
  const normalized = new Set(names.map((n) => norm(n.value)));
  if (names.length >= 2 && normalized.size > 1) {
    score -= 20;
    F({
      rule: "brand-name-inconsistent", severity: "medium", effort: 0.2,
      title: "Le nom de marque differe selon la source",
      proof: names.map((n) => `${n.source}: "${n.value}"`).join(" | ") + ". Un moteur qui cherche a consolider une entite voit trois marques differentes.",
      fix: "Fixer une seule forme du nom et l'utiliser a l'identique dans le schema, og:site_name et le suffixe des titles.",
      verifiability: "cross-checked",
    });
  } else if (names.length >= 2) {
    strengths.push(`Nom de marque coherent sur ${names.length} sources ("${names[0].value}")`);
  }

  // --- Ancrage de l'entite ------------------------------------------------------------
  if (!org) {
    score -= 30;
    F({
      rule: "no-entity-anchor", severity: "medium", effort: 0.4,
      title: "Aucune entite Organization declaree: rien a rattacher a la marque",
      proof: v ? `Types presents sur l'accueil: ${Object.keys(v.typeCount).join(", ") || "aucun"}.` : "Aucun JSON-LD sur l'accueil.",
      fix: "Declarer Organization avec name, url, logo, description et un @id stable (ex: https://exemple.com/#organization) reutilise sur toutes les pages.",
      verifiability: "self-evident",
      dimensions: ["entity", "schema"],
    });
  } else {
    // @id stable: sans lui, chaque page declare une organisation DIFFERENTE.
    if (!org["@id"]) {
      score -= 15;
      F({
        rule: "organization-no-id", severity: "low", effort: 0.2,
        title: "Organization sans @id stable",
        proof: `Organization "${org.name || "?"}" declaree sans @id. Chaque page declare alors une entite distincte au lieu de reference la meme.`,
        fix: `Ajouter "@id": "${origin}/#organization" et pointer vers cet @id depuis WebSite.publisher et Article.publisher.`,
        verifiability: "self-evident",
        dimensions: ["entity", "schema"],
      });
    } else strengths.push(`Organization ancree sur un @id stable (${org["@id"]})`);

    // sameAs: le graphe de profils officiels. C'est ce qui permet de relier le site
    // aux autres traces de la marque et d'alimenter un panneau de connaissance.
    const sameAs = asStrings(org.sameAs);
    if (!sameAs.length) {
      score -= 20;
      F({
        rule: "no-sameas-graph", severity: "medium", effort: 0.3,
        title: "Aucun sameAs: l'entite n'est reliee a aucun profil officiel",
        proof: `Organization "${org.name || "?"}" sans propriete sameAs. Rien ne relie ce site aux autres traces verifiables de la marque.`,
        fix: "Lister dans sameAs les profils OFFICIELS de l'organisation (pages entreprise, annuaires professionnels, registres, depot de marque). Ne pas y mettre de comptes personnels sans decision explicite.",
        verifiability: "self-evident",
      });
    } else if (sameAs.length < 3) {
      score -= 8;
      F({
        rule: "thin-sameas-graph", severity: "low", effort: 0.2,
        title: `Graphe sameAs reduit (${sameAs.length} profil)`,
        proof: `sameAs: ${sameAs.join(", ")}. Un seul point de correlation externe suffit rarement a consolider une entite.`,
        fix: "Ajouter les autres profils officiels verifiables de l'organisation.",
        verifiability: "self-evident",
      });
    } else strengths.push(`Graphe sameAs fourni (${sameAs.length} profils officiels)`);

    if (!org.logo) {
      score -= 8;
      F({
        rule: "organization-no-logo", severity: "low", effort: 0.2,
        title: "Organization sans logo declare",
        proof: "Pas de propriete logo dans le schema Organization. Le logo est ce qu'un panneau de connaissance affiche en premier.",
        fix: "Ajouter logo (ImageObject ou URL absolue, format carre ou rectangulaire lisible en petit).",
        verifiability: "self-evident",
      });
    }
    if (!org.description) {
      score -= 6;
      F({
        rule: "organization-no-description", severity: "low", effort: 0.2,
        title: "Organization sans description",
        proof: "Pas de propriete description: la definition canonique de l'entite est absente des donnees structurees.",
        fix: "Ajouter une description d'une a deux phrases: ce que fait l'organisation, pour qui, ou. C'est la phrase qu'une IA reprendra pour presenter la marque.",
        verifiability: "self-evident",
        dimensions: ["entity", "geo"],
      });
    }
  }

  // --- WebSite relie a l'Organization ----------------------------------------------------
  if (org && site) {
    const publisher = site.publisher;
    const linked = publisher && (publisher["@id"] === org["@id"] || publisher.name === org.name || typeof publisher === "string");
    if (!linked) {
      score -= 10;
      F({
        rule: "website-not-linked-to-org", severity: "low", effort: 0.2,
        title: "WebSite non relie a l'Organization",
        proof: `WebSite declare sans publisher pointant vers l'Organization${org["@id"] ? ` (@id ${org["@id"]})` : ""}. Le graphe reste en deux morceaux.`,
        fix: `Ajouter "publisher": { "@id": "${org["@id"] || origin + "/#organization"}" } dans le noeud WebSite.`,
        verifiability: "cross-checked",
        dimensions: ["entity", "schema"],
      });
    } else strengths.push("WebSite et Organization relies dans le meme graphe");
  }

  // --- Coherence de l'entite entre les pages ----------------------------------------------
  const orgNames = new Set();
  for (const p of graph.crawledPages()) {
    if (!p.html) continue;
    const b = extractBlocks(p.html);
    if (!b.length) continue;
    const pv = validate(b, origin);
    const o = findNode(pv.nodes, "Organization") || findNode(pv.nodes, "LocalBusiness");
    if (o?.name) orgNames.add(norm(o.name));
  }
  if (orgNames.size > 1) {
    score -= 15;
    F({
      rule: "entity-name-drift", severity: "medium", effort: 0.3,
      title: `L'Organization porte ${orgNames.size} noms differents selon les pages`,
      proof: `Formes rencontrees: ${[...orgNames].join(" | ")}. Chaque variante est une entite distincte pour un moteur.`,
      fix: "Generer le schema Organization depuis une source unique et l'inclure a l'identique sur toutes les pages.",
      verifiability: "cross-checked",
    });
  }

  // --- Definition canonique dans le contenu -------------------------------------------------
  // Une IA a besoin d'une phrase reprenable qui dit ce qu'est l'entite.
  const brand = schemaName || ogSite || titleBrand;
  if (brand) {
    const re = new RegExp(`${escapeRe(brand)}\\s+(est|is|ist|es|e')\\s+`, "i");
    if (!re.test(home.text || "")) {
      score -= 10;
      F({
        rule: "no-canonical-definition", severity: "low", effort: 0.3,
        title: "Aucune phrase de definition de la marque dans le contenu",
        proof: `Le texte de l'accueil ne contient jamais la forme "${brand} est ...". C'est pourtant la phrase qu'un moteur de reponse reprend pour presenter l'entite.`,
        fix: `Ecrire une phrase de definition explicite en haut de page: "${brand} est <categorie> qui <benefice> pour <cible>."`,
        verifiability: "self-evident",
        dimensions: ["entity", "geo"],
      });
    } else strengths.push(`Definition canonique presente dans le contenu ("${brand} est ...")`);
  }

  ctx.entityScore = Math.max(0, score);
  return { findings: out, strengths };
}

function norm(s = "") {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Le suffixe d'un title est presque toujours la marque: "Page | Marque".
function brandFromTitle(title) {
  if (!title) return null;
  const parts = String(title).split(/\s+[|–—-]\s+/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  return last.length >= 2 && last.length <= 40 ? last : null;
}
