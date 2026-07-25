// Panoptic - Agent CRO / conversion (optimise la transformation, distinct de l'UX).
import { makeFinding, tagAll, elements, visibleText, tag } from "../shared.js";

// Verbes d'action FR/EN les plus courants. Liste elargie (corrige un faux positif:
// "Scanner mon site" n'etait pas reconnu, donnant un "aucun CTA" sur un site qui en a 5).
const CTA_WORDS = /(acheter|commander|s'inscrire|inscri|essayer|essai|demander|reserver|contact|devis|demarrer|lancer|scanner|scan|analyser|auditer|activer|obtenir|decouvrir|explorer|voir|commencer|get started|sign up|buy|try|book|start|subscribe|scan|analyze|audit|launch|get |telecharger|download)/i;

export function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("cro", "risque", { ...r, url }));

  // Presence d'un CTA clair. Double signal, pour ne pas rater un CTA visuel:
  //  (1) libelle contenant un verbe d'action,
  //  (2) OU element stylise en bouton (class btn/cta/button) = CTA meme sans verbe connu.
  const clickables = [...tagAll(html, "a"), ...tagAll(html, "button")].map((t) => t.replace(/<[^>]+>/g, " ").trim());
  const byWord = clickables.filter((t) => CTA_WORDS.test(t));
  const styled = [...elements(html, "a"), ...elements(html, "button")]
    .filter((t) => /class\s*=\s*["'][^"']*\b(btn|cta|button)\b/i.test(t));
  const ctaCount = Math.max(byWord.length, styled.length);
  if (ctaCount === 0) F({ rule: "no-cta", severity: "high", effort: 0.4, gain_eur: 4000, title: "Aucun appel a l'action clair detecte", fix: "Ajouter un CTA principal explicite et visible au-dessus de la ligne de flottaison.", proof: "Aucun bouton d'action ni libelle d'action reconnu." });

  // Proposition de valeur dans le premier ecran (h1 + sous-titre)
  const h1 = tag(html, "h1");
  if (!h1 || h1.replace(/<[^>]+>/g, "").trim().length < 8) F({ rule: "weak-value-prop", severity: "medium", effort: 0.4, gain_eur: 2500, title: "Proposition de valeur faible ou absente (h1)", fix: "Formuler un h1 qui dit qui vous aidez et a quoi, en une phrase.", proof: h1 ? h1.slice(0, 60) : "pas de h1." });

  // Preuve sociale
  const text = visibleText(html).toLowerCase();
  const hasProof = /(avis|temoignage|review|testimonial|note|etoiles|clients|utilisateurs|trusted|ils nous font confiance|\d+\s*(?:avis|clients|users))/i.test(text);
  if (!hasProof) F({ rule: "no-social-proof", severity: "low", effort: 0.5, gain_eur: 1500, title: "Aucune preuve sociale detectee", fix: "Ajouter avis, logos clients ou chiffres cles credibles.", proof: "Pas de signal de preuve sociale." });

  // Trop de CTA concurrents (dispersion) au-dessus de la ligne. On compte les libelles
  // d'action distincts (pas les boutons stylises identiques repetes, ex. meme CTA en
  // nav + hero + footer, qui est une bonne pratique et non une dispersion).
  const distinctWords = new Set(byWord.map((t) => t.toLowerCase()));
  if (distinctWords.size > 6) F({ rule: "cta-overload", severity: "low", effort: 0.3, gain_eur: 800, title: `Beaucoup d'appels a l'action distincts (${distinctWords.size}) diluent la conversion`, fix: "Prioriser un CTA primaire, reduire les actions concurrentes.", proof: `${distinctWords.size} libelles d'action differents.` });

  return { findings, stats: { ctas: ctaCount, distinct: distinctWords.size, hasProof } };
}
