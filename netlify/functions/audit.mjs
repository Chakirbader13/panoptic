// Panoptic - fonction Netlify: audit boite-noire, EN FLUX (NDJSON).
// Emet la progression agent par agent au fil de l'eau (comme le SSE du serveur Node),
// puis un dernier evenement {type:"done", result}. Le client lit le flux ligne par ligne.
import { createOrchestrator } from "../../engine/orchestrator.js";
import { recon } from "../../engine/recon.js";
import { runAgent } from "../../engine/registry.js";
import { verifyFinding } from "../../engine/verify.js";
import { rateLimit, validateTarget } from "./_guard.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);

  // Anti-abus: chaque appel lance le moteur complet -> quota par IP + plafond global.
  const rl = await rateLimit(req);
  if (!rl.ok) {
    return json(
      { error: rl.scope === "global" ? "Service temporairement sature, reessayez dans quelques minutes." : "Trop d'audits depuis cette adresse. Reessayez plus tard." },
      429,
      { "retry-after": String(rl.retryAfter) },
    );
  }

  let target, businessParams;
  try { ({ target, businessParams } = await req.json()); } catch { return json({ error: "corps JSON invalide" }, 400); }

  // Garde SSRF + normalisation de la cible.
  const check = validateTarget(target);
  if (!check.ok) return json({ error: check.error }, 400);
  target = check.url;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { /* stream ferme */ } };
      const scan = (t) => recon(t, { businessParams });                 // boite noire
      const verify = verifyFinding;                                     // vraie verif adversariale
      const onProgress = (msg) => send({ type: "log", msg });
      const orchestrate = createOrchestrator({ scan, runAgent, verify, onProgress, concurrency: 6 });
      try {
        const r = await orchestrate(target);
        send({ type: "done", result: {
          target: r.target, score: r.score, agents: r.agents,
          reachable: r.scope?.reachable, stack: r.scope?.stack || [],
          findings: r.findings, summary: r.summary, generatedAt: new Date().toISOString(),
        } });
      } catch (e) {
        send({ type: "error", error: e.message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra } });
}

export const config = { path: "/api/audit" };
