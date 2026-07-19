// Panoptic - Agent GEO (visibilite dans les moteurs de reponse IA).
import { makeFinding, visibleText } from "../shared.js";

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended"];

export function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("geo", "visibilite", { ...r, url }));

  // llms.txt
  if (!scope.llmsTxt.present) F({ rule: "no-llms-txt", severity: "medium", effort: 0.3, title: "llms.txt absent", fix: "Publier un /llms.txt resumant l'offre et les pages cles pour les moteurs IA.", proof: "/llms.txt introuvable." });

  // Crawlers IA bloques dans robots.txt
  const robots = scope.robots.present ? scope.robots.body : "";
  for (const bot of AI_BOTS) {
    const re = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?Disallow:\\s*/\\s*(?:\\n|$)`, "i");
    if (re.test(robots)) F({ rule: `blocks-${bot}`, severity: "medium", effort: 0.1, title: `Crawler IA ${bot} bloque dans robots.txt`, fix: `Autoriser ${bot} si vous voulez etre cite par ce moteur.`, proof: `Disallow pour ${bot}.` });
  }

  // Donnees factuelles extractibles (structured data)
  if (!/application\/ld\+json/i.test(html)) F({ rule: "no-jsonld-geo", severity: "medium", effort: 0.4, title: "Pas de JSON-LD: faits peu extractibles par l'IA", fix: "Exposer Organization/FAQ/Product en JSON-LD pour la citabilite.", proof: "Aucun ld+json." });

  // Structure question/reponse (citabilite au niveau paragraphe)
  const text = visibleText(html);
  const hasQA = /\b(qu'est-ce|comment|pourquoi|what is|how to|why)\b/i.test(text) || /<h[23][^>]*>[^<]*\?/i.test(html);
  if (text.length > 400 && !hasQA) F({ rule: "no-qa-structure", severity: "low", effort: 0.5, title: "Contenu peu structure en question/reponse", fix: "Ajouter des titres interrogatifs et des reponses courtes et citables.", proof: "Aucun motif Q/R detecte." });

  // E-E-A-T: signaux d'auteur/organisation
  if (!/author|auteur|rel=["']author["']/i.test(html) && text.length > 800) F({ rule: "weak-eeat", severity: "low", effort: 0.5, title: "Signaux E-E-A-T faibles (auteur/expertise)", fix: "Afficher auteur, date, sources et page a-propos pour la confiance.", proof: "Pas de signal d'auteur." });

  return { findings, stats: { checks: 4 + AI_BOTS.length, textLen: text.length } };
}
