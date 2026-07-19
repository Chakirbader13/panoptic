// Panoptic - Agent UX / UI / parcours (heuristiques au niveau HTML, distinct du CRO).
import { makeFinding, elements, attr, visibleText } from "../shared.js";

export function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("ux", "humain", { ...r, url }));

  // Formulaires longs (friction)
  const forms = html.split(/<form\b/i).slice(1);
  for (const f of forms) {
    const fields = (f.split(/<\/form>/i)[0].match(/<input\b|<select\b|<textarea\b/gi) || []).length;
    if (fields > 7) { F({ rule: "long-form", severity: "medium", effort: 0.4, title: `Formulaire long (${fields} champs)`, fix: "Reduire aux champs essentiels ou decouper en etapes.", proof: `${fields} champs.` }); break; }
  }

  // Absence d'etats (chargement/erreur) cote markup statique: heuristique douce
  // On verifie surtout la coherence des tailles de police via inline styles minuscules.
  if (/font-size\s*:\s*(?:[0-9]|1[0-1])px/i.test(html)) F({ rule: "tiny-font", severity: "low", effort: 0.2, title: "Texte a police tres petite (<12px)", fix: "Garder le corps de texte >= 14-16px pour la lisibilite mobile.", proof: "font-size < 12px detecte." });

  // Cibles tactiles: inputs/boutons sans hauteur suffisante (heuristique inline)
  // Liens de navigation trop nombreux dans le header (surcharge cognitive)
  const header = (html.split(/<\/header>/i)[0] || "").toLowerCase();
  const navLinks = (header.match(/<a\b/gi) || []).length;
  if (navLinks > 9) F({ rule: "nav-overload", severity: "low", effort: 0.3, title: `Navigation chargee (${navLinks} liens dans l'en-tete)`, fix: "Regrouper la navigation, prioriser 5-7 entrees principales.", proof: `${navLinks} liens d'en-tete.` });

  // Contenu principal tres pauvre (page vide/en construction)
  const text = visibleText(html);
  if (text.length < 200) F({ rule: "thin-page", severity: "medium", effort: 0.5, title: "Page tres pauvre en contenu", fix: "Etoffer le contenu; verifier que la page n'est pas rendue cote client uniquement.", proof: `${text.length} caracteres visibles.` });

  // Favicon
  if (!/rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(html)) F({ rule: "no-favicon", severity: "info", effort: 0.1, title: "Favicon absent", fix: "Ajouter un favicon et une apple-touch-icon.", proof: "Aucun lien d'icone." });

  // Image de fond hero sans texte alternatif de contexte: skip (couvert a11y)
  return { findings, stats: { forms: forms.length, navLinks, textLen: text.length } };
}
