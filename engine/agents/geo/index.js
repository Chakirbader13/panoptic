// Panoptic - Agent GEO (visibilite dans les moteurs de reponse IA).
//
// Facade sur le moteur SEO KING. Deux lanes alimentent cet agent: la lane GEO
// (accessibilite des crawlers de reponse, llms.txt, citabilite au niveau passage,
// lisibilite structurelle, fraicheur, readiness par plateforme) et la lane entite
// (ancrage Organization, graphe sameAs, coherence de marque, definition canonique).
//
// La lane technique lui transmet en plus ses constats a portee IA (crawler bloque,
// rendu cote client), via la dimension principale du finding.

import { makeFinding } from "../shared.js";
import { runShared } from "../../seo-king/index.js";

export async function run(scope) {
  if (!scope.reachable) return { findings: [], stats: { skipped: "prod injoignable" } };

  const result = await runShared(scope, scope.seoKing || {});
  const mine = result.findings.filter((f) => f.owner === "geo");

  const findings = mine.map((f) =>
    makeFinding("geo", "visibilite", {
      ...f,
      url: f.url || scope.url,
      check: f.check || (f.verifiability === "inconclusive"
        ? { verdict: "plausible", votes: 2, refuters: 1, reason: f.reason || "Signal, pas preuve: revue humaine recommandee." }
        : undefined),
    })
  );

  return {
    findings,
    stats: {
      // Note composite de citabilite et ses cinq composantes, exposees pour que le
      // rapport puisse les afficher separement du score global.
      geoScore: result.geo?.score ?? null,
      components: result.geo?.components || null,
      totals: result.geo?.totals || null,
      platforms: result.platforms || null,
      crawlerMatrix: result.crawlerMatrix
        ? result.crawlerMatrix.map((b) => ({ ua: b.ua, platform: b.platform, kind: b.kind, blocked: b.blockedCount }))
        : null,
      entityScore: result.entityScore,
      strengths: result.strengths.filter((s) => ["geo", "entity"].includes(s.lane)).map((s) => s.text),
      ms: result.stats.ms,
    },
  };
}
