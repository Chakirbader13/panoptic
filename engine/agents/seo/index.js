// Panoptic - Agent SEO technique.
//
// Facade sur le moteur SEO KING (engine/seo-king): l'agent ne contient plus de
// regles, il consomme les lanes. Huit lanes alimentent cet agent (technique,
// on-page, schema, sitemap, hreflang, maillage et cannibalisation, contenu et
// E-E-A-T, adequation a l'intention); les lanes GEO et entite alimentent l'agent
// geo. Les deux agents partagent UNE SEULE execution memoisee sur le scope, donc
// une seule vague de requetes, conformement a la promesse "un seul crawl".

import { makeFinding } from "../shared.js";
import { runShared } from "../../seo-king/index.js";

export async function run(scope) {
  if (!scope.reachable) return { findings: [], stats: { skipped: "prod injoignable" } };

  const result = await runShared(scope, scope.seoKing || {});
  const mine = result.findings.filter((f) => f.owner === "seo");

  const findings = mine.map((f) =>
    makeFinding("seo", "visibilite", {
      ...f,
      url: f.url || scope.url,
      // Une regle declaree non concluante ne doit jamais ressortir en verdict ferme:
      // on la marque des l'emission, la couche adversariale la maintiendra en
      // "plausible" au lieu de la confirmer.
      check: f.check || (f.verifiability === "inconclusive"
        ? { verdict: "plausible", votes: 2, refuters: 1, reason: f.reason || "Signal, pas preuve: revue humaine recommandee." }
        : undefined),
    })
  );

  return {
    findings,
    stats: {
      lanes: result.lanes.filter((l) => !["geo", "entity"].includes(l.id)),
      pages: result.stats.pages,
      requests: result.stats.requests,
      coverage: result.coverage,
      budget: result.budget,
      strengths: result.strengths.filter((s) => !["geo", "entity"].includes(s.lane)).map((s) => s.text),
      ms: result.stats.ms,
    },
  };
}
