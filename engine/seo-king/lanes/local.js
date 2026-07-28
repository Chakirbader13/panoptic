// Panoptic SEO KING - lane locale (conditionnelle).
//
// Ne se declenche QUE si le site a une realite physique: schema LocalBusiness,
// adresse postale, telephone ou carte integree. Sur un SaaS pur, cette lane se tait
// et le dit. Un audit qui reproche a un editeur de logiciel de ne pas avoir d'horaires
// d'ouverture perd sa credibilite en une ligne.

import { extractBlocks, validate, findNode, asStrings } from "../jsonld.js";

export const id = "local";

const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2}(?:[\s.-]?\d{2}){3,4}/g;
const POSTAL_RE = /\b\d{5}\b(?!\s*(?:€|EUR|%))/;
const MAP_RE = /(google\.com\/maps|maps\.google|openstreetmap|mapbox|leaflet|<iframe[^>]+maps)/i;

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["content"], url: scope.url, ...r });

  const home = graph.get(scope.url);
  if (!home?.html) return { findings: out, strengths, skipped: "accueil indisponible" };

  const blocks = extractBlocks(home.html);
  const v = blocks.length ? validate(blocks, origin) : null;
  const localNode = v ? (findNode(v.nodes, "LocalBusiness") || findNode(v.nodes, "Restaurant") || findNode(v.nodes, "Store") || findNode(v.nodes, "ProfessionalService")) : null;

  const text = home.text || "";
  const hasPostal = POSTAL_RE.test(text);
  const hasMap = MAP_RE.test(home.html);
  const hasTelLink = /href\s*=\s*["']tel:/i.test(home.html);
  const phones = [...new Set((text.match(PHONE_RE) || []).map((p) => p.replace(/[\s.-]/g, "")).filter((p) => p.length >= 9 && p.length <= 15))];

  // Declencheur: au moins deux signaux physiques, ou un schema local explicite.
  const signals = [Boolean(localNode), hasPostal, hasMap, hasTelLink].filter(Boolean).length;
  if (!localNode && signals < 2) {
    return { findings: out, strengths, skipped: "aucun signal d'etablissement physique (pas de LocalBusiness, d'adresse, de telephone ni de carte)" };
  }

  // --- Schema LocalBusiness -------------------------------------------------------------
  if (!localNode) {
    F({
      rule: "local-no-schema", severity: "medium", effort: 0.4,
      title: "Signaux d'etablissement physique sans schema LocalBusiness",
      proof: `Detecte sur l'accueil: ${[hasPostal && "code postal", hasTelLink && "lien tel:", hasMap && "carte integree"].filter(Boolean).join(", ")}. Aucun schema LocalBusiness pour autant: Google ne peut pas relier ce site a une fiche etablissement.`,
      fix: "Declarer LocalBusiness (ou le sous-type exact) avec name, address complet, telephone, openingHoursSpecification et geo.",
      verifiability: "cross-checked",
      dimensions: ["content", "entity"],
    });
  } else {
    strengths.push("Schema LocalBusiness declare");
    const addr = localNode.address;
    const missing = [];
    if (!addr) missing.push("address");
    else if (typeof addr === "object") {
      for (const k of ["streetAddress", "postalCode", "addressLocality"]) if (!addr[k]) missing.push(`address.${k}`);
    }
    if (!localNode.telephone) missing.push("telephone");
    if (!localNode.openingHoursSpecification && !localNode.openingHours) missing.push("openingHours");
    if (!localNode.geo) missing.push("geo");
    if (missing.length) {
      F({
        rule: "local-schema-incomplete", severity: "medium", effort: 0.3,
        title: `LocalBusiness incomplet: ${missing.join(", ")} manquant(s)`,
        proof: `Schema declare pour "${localNode.name || "?"}" sans ${missing.join(", ")}. Les resultats locaux et le panneau etablissement s'appuient directement sur ces champs.`,
        fix: "Completer chaque champ avec la donnee reelle de l'etablissement, identique a celle de la fiche Google Business Profile.",
        verifiability: "self-evident",
        dimensions: ["content", "schema"],
      });
    } else strengths.push("LocalBusiness complet (adresse, telephone, horaires, coordonnees)");
  }

  // --- Coherence NAP entre les pages -------------------------------------------------------
  // Nom, adresse, telephone doivent etre IDENTIQUES partout. Une variation suffit a
  // empecher la consolidation de l'etablissement par les moteurs.
  const napByPage = new Map();
  for (const p of graph.crawledPages()) {
    if (!p.text) continue;
    const nums = [...new Set((p.text.match(PHONE_RE) || []).map((x) => x.replace(/[\s.-]/g, "")).filter((x) => x.length >= 9 && x.length <= 15))];
    if (nums.length) napByPage.set(p.url, nums);
  }
  const allPhones = new Set([...napByPage.values()].flat());
  if (allPhones.size > 1) {
    F({
      rule: "nap-phone-inconsistent", severity: "medium", effort: 0.3,
      title: `${allPhones.size} numeros de telephone differents selon les pages`,
      proof: [...napByPage.entries()].slice(0, 4).map(([u, n]) => `${short(u)}: ${n.join(", ")}`).join(" | ") + ". Un NAP incoherent empeche les moteurs de consolider l'etablissement.",
      fix: "Publier un seul numero de reference, identique partout et identique a la fiche Google Business Profile.",
      verifiability: "cross-checked",
    });
  } else if (allPhones.size === 1) strengths.push("Numero de telephone identique sur toutes les pages");

  // --- Telephone cliquable -------------------------------------------------------------------
  if (phones.length && !hasTelLink) {
    F({
      rule: "phone-not-clickable", severity: "low", effort: 0.1,
      title: "Numero de telephone affiche mais non cliquable",
      proof: `Numero present dans le texte (${phones[0]}) sans lien tel:. Sur mobile, l'appel demande une copie manuelle.`,
      fix: `Encadrer le numero d'un <a href="tel:+33...">.`,
      verifiability: "self-evident",
    });
  }

  // --- Carte ---------------------------------------------------------------------------------
  if (!hasMap && localNode) {
    F({
      rule: "local-no-map", severity: "low", effort: 0.2,
      title: "Aucune carte integree sur le site",
      proof: "Etablissement physique declare sans carte ni lien vers un itineraire.",
      fix: "Integrer une carte ou un lien d'itineraire sur la page contact.",
      verifiability: "self-evident",
    });
  }

  return { findings: out, strengths };
}
