// Panoptic - fonction Netlify: audit boite-noire, EN FLUX (NDJSON).
// Emet la progression agent par agent au fil de l'eau (comme le SSE du serveur Node),
// puis un dernier evenement {type:"done", result}. Le client lit le flux ligne par ligne.
import { createOrchestrator } from "../../engine/orchestrator.js";
import { recon } from "../../engine/recon.js";
import { runAgent } from "../../engine/registry.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  let target, businessParams;
  try { ({ target, businessParams } = await req.json()); } catch { return json({ error: "corps JSON invalide" }, 400); }
  if (!target || !/^https?:\/\/|\./.test(target)) return json({ error: "url cible requise" }, 400);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { /* stream ferme */ } };
      const scan = (t) => recon(t, { businessParams });                 // boite noire
      const verify = async (f) => (f.check ? f : { ...f, check: { verdict: "confirmed", votes: 3, refuters: 0 } });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export const config = { path: "/api/audit" };
