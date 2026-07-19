// Panoptic - fonction Netlify: audit boite-noire (prod uniquement), synchrone.
// Pas de repo cote serverless: seuls les agents prod tournent (recon + SEO/perf/a11y/
// RGPD/analytics/UX/CRO/GEO/contenu/infra/email + securite headers). C'est l'offre "scan".
import { createOrchestrator } from "../../engine/orchestrator.js";
import { recon } from "../../engine/recon.js";
import { runAgent } from "../../engine/registry.js";

export default async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST requis" }), { status: 405, headers: { "content-type": "application/json" } });
  let target;
  try { ({ target } = await req.json()); } catch { return json({ error: "corps JSON invalide" }, 400); }
  if (!target || !/^https?:\/\/|\./.test(target)) return json({ error: "url cible requise" }, 400);

  const scan = (t) => recon(t);                 // pas de repoPath: boite noire
  const verify = async (f) => (f.check ? f : { ...f, check: { verdict: "confirmed", votes: 3, refuters: 0 } });
  const orchestrate = createOrchestrator({ scan, runAgent, verify });

  try {
    const r = await orchestrate(target);
    return json({
      target: r.target,
      score: r.score,
      agents: r.agents,
      reachable: r.scope?.reachable,
      stack: r.scope?.stack || [],
      findings: r.findings,
      summary: r.summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export const config = { path: "/api/audit" };
