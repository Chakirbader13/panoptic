// Panoptic SEO KING - lane e-commerce (conditionnelle).
//
// Ne se declenche que si le site vend en ligne: schema Product, panier, ou pages
// produit detectees. Sur un site vitrine, elle se tait et le dit.
// Ce qui compte ici n'est pas "avez-vous du Product schema" mais "vos fiches sont
// elles eligibles aux resultats produits", ce qui se joue sur quatre proprietes
// exactes que Google exige et que la plupart des integrations oublient.

import { extractBlocks, validate, findNode } from "../jsonld.js";

export const id = "ecommerce";

const CART_RE = /(add[-_\s]?to[-_\s]?cart|ajouter au panier|mon panier|\/cart\b|\/panier\b|\/checkout\b|\/commande\b|data-product-id)/i;
const PRICE_RE = /(\d[\d\s.,]*)\s*(€|EUR|\$|USD|CHF|£)|(?:€|\$|£)\s*\d/;

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["schema"], url: scope.url, ...r });

  const pages = graph.crawledPages();
  if (!pages.length) return { findings: out, strengths, skipped: "aucune page analysable" };

  // --- Detection ---------------------------------------------------------------------
  const withProductSchema = [];
  const parsedByPage = new Map();
  for (const p of pages) {
    if (!p.html) continue;
    const blocks = extractBlocks(p.html);
    if (!blocks.length) continue;
    const v = validate(blocks, origin);
    parsedByPage.set(p.url, v);
    if (v.typeCount.Product || v.typeCount.ProductGroup) withProductSchema.push(p);
  }
  const withCart = pages.filter((p) => CART_RE.test(p.html || ""));

  if (!withProductSchema.length && !withCart.length) {
    return { findings: out, strengths, skipped: "aucun signal e-commerce (ni schema Product, ni panier, ni tunnel de commande)" };
  }

  // --- Pages de vente sans schema Product ------------------------------------------------
  const cartNoSchema = withCart.filter((p) => !withProductSchema.includes(p));
  if (cartNoSchema.length) {
    F({
      rule: "product-page-without-schema", severity: "high", effort: 0.4,
      title: `${cartNoSchema.length} page(s) de vente sans schema Product`,
      url: cartNoSchema[0].url,
      proof: cartNoSchema.slice(0, 5).map((p) => short(p.url)).join(", ") + ". Un bouton d'achat est present, aucun balisage Product: ces fiches sont inelegibles aux resultats produits (prix, disponibilite, note en SERP).",
      fix: "Baliser chaque fiche en Product avec name, image, description, et un Offer complet.",
      verifiability: "cross-checked",
    });
  } else if (withProductSchema.length) {
    strengths.push(`${withProductSchema.length} fiche(s) produit balisee(s) en Product`);
  }

  // --- Offer: les quatre proprietes qui decident de l'eligibilite --------------------------
  const offerIssues = [];
  for (const p of withProductSchema) {
    const v = parsedByPage.get(p.url);
    const offer = findNode(v.nodes, "Offer") || findNode(v.nodes, "AggregateOffer");
    if (!offer) { offerIssues.push({ p, missing: ["offers"] }); continue; }
    const missing = [];
    if (!offer.price && !offer.lowPrice) missing.push("price");
    if (!offer.priceCurrency) missing.push("priceCurrency");
    if (!offer.availability) missing.push("availability");
    if (missing.length) offerIssues.push({ p, missing });
  }
  if (offerIssues.length) {
    F({
      rule: "offer-incomplete", severity: "high", effort: 0.3,
      title: `${offerIssues.length} fiche(s) produit avec une offre incomplete`,
      url: offerIssues[0].p.url,
      proof: offerIssues.slice(0, 5).map((o) => `${short(o.p.url)}: ${o.missing.join(", ")} manquant(s)`).join(" | ") + ". Sans prix, devise et disponibilite, aucun affichage enrichi produit n'est possible.",
      fix: "Completer chaque Offer: price, priceCurrency (ISO 4217), availability (https://schema.org/InStock ou OutOfStock).",
      verifiability: "self-evident",
    });
  } else if (withProductSchema.length) {
    strengths.push("Offres produit completes (prix, devise, disponibilite)");
  }

  // --- Prix affiche mais absent du balisage --------------------------------------------------
  const priceInTextOnly = pages.filter((p) => {
    if (withProductSchema.includes(p)) return false;
    if (!CART_RE.test(p.html || "")) return false;
    return PRICE_RE.test(p.text || "");
  });
  if (priceInTextOnly.length) {
    F({
      rule: "price-not-structured", severity: "medium", effort: 0.3,
      title: `${priceInTextOnly.length} page(s) affichent un prix qu'aucune donnee structuree ne declare`,
      url: priceInTextOnly[0].url,
      proof: priceInTextOnly.slice(0, 4).map((p) => short(p.url)).join(", ") + ". Le prix est lisible par un humain, pas par un moteur ni par un assistant IA qui compare des offres.",
      fix: "Declarer le prix dans un Offer en JSON-LD, avec la meme valeur que celle affichee.",
      verifiability: "cross-checked",
      dimensions: ["schema", "geo"],
    });
  }

  // --- Fil d'Ariane sur les fiches ---------------------------------------------------------------
  const noBreadcrumb = withProductSchema.filter((p) => !parsedByPage.get(p.url)?.typeCount.BreadcrumbList);
  if (noBreadcrumb.length && withProductSchema.length) {
    F({
      rule: "product-no-breadcrumb", severity: "low", effort: 0.3,
      title: `${noBreadcrumb.length} fiche(s) produit sans BreadcrumbList`,
      proof: noBreadcrumb.slice(0, 4).map((p) => short(p.url)).join(", ") + ". Sur une fiche produit, le fil d'Ariane remplace l'URL en SERP et situe le produit dans sa categorie.",
      fix: "Ajouter BreadcrumbList sur chaque fiche: accueil > categorie > produit.",
      verifiability: "self-evident",
    });
  }

  // --- Confiance transactionnelle -------------------------------------------------------------------
  const TRUST_RE = /(livraison|expedition|shipping|retour|remboursement|refund|garantie|warranty|paiement securise|secure payment)/i;
  const homeText = graph.get(scope.url)?.text || "";
  const linkText = (graph.get(scope.url)?.allLinks || []).map((l) => `${l.href} ${l.effectiveAnchor}`).join(" ");
  if (!TRUST_RE.test(homeText) && !TRUST_RE.test(linkText)) {
    F({
      rule: "no-commerce-trust-signals", severity: "medium", effort: 0.4,
      title: "Aucune information de livraison, retour ou garantie accessible",
      proof: "Ni dans le texte de l'accueil ni dans ses liens. Ce sont les trois informations qu'un acheteur cherche avant de commander, et que les assistants IA citent quand ils comparent des marchands.",
      fix: "Publier des pages livraison, retours et garantie, et les lier depuis le pied de page.",
      verifiability: "cross-checked",
      dimensions: ["schema", "content"],
    });
  } else strengths.push("Informations de livraison, retour ou garantie accessibles");

  return { findings: out, strengths };
}
