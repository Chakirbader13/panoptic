// Panoptic - point d'entree PROGRAMMATIQUE partage du moteur.
// Une seule fonction runAudit() reutilisee par le CLI, le serveur MCP et (a terme) le
// serveur HTTP, pour ne pas dupliquer le cablage recon -> agents -> verif -> synthese.
import { createOrchestrator } from "./orchestrator.js";
import { recon } from "./recon.js";
import { runAgent } from "./registry.js";
import { verifyFinding } from "./verify.js";

/**
 * Lance un audit complet et renvoie le resultat canonique.
 * @param {string} target URL a auditer.
 * @param {object} [opts]
 * @param {string} [opts.repoPath] Chemin local d'un depot (active les agents code).
 * @param {number} [opts.maxPages=1] Profondeur de crawl (>1 = multi-pages + navigateur).
 * @param {object} [opts.auth] { cookie?, bearer?, headers? } pour scan authentifie.
 * @param {object} [opts.businessParams] { monthlyVisits, conversionValue, conversionRate }.
 * @param {(msg:string)=>void} [opts.onProgress] Callback de progression.
 * @param {number} [opts.concurrency=4] Concurrence du fan-out des agents.
 * @returns {Promise<object>} { target, score, agents, findings, summary, generatedAt, ... }
 */
export async function runAudit(target, opts = {}) {
  const { repoPath = null, maxPages = 1, auth = null, businessParams = null, onProgress = () => {}, concurrency = 4 } = opts;
  const scan = (t) => recon(t, { repoPath, auth, maxPages, businessParams });
  const orchestrate = createOrchestrator({ scan, runAgent, verify: verifyFinding, onProgress, concurrency });
  const r = await orchestrate(target);
  r.generatedAt = new Date().toISOString();
  return r;
}

const RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// Nombre de findings de severite >= seuil (pour --fail-on en CI).
export function countAtOrAbove(findings, severity) {
  const floor = RANK[severity] ?? 0;
  return (findings || []).filter((f) => (RANK[f.severity] ?? 9) <= floor).length;
}
