// Panoptic - Pipeline d'orchestration.
// Le coeur defendable du produit. Cinq couches, deterministes:
//   1. Reconnaissance & scoping unifie   (un seul crawl pour tous les agents)
//   2. Fan-out des agents actifs          (chacun code + prod, en parallele)
//   3. Verification adversariale          (chaque finding challenge avant le rapport)
//   4. Dedup + scoring + priorisation     (fusion inter-domaines, impact/effort)
//   5. Synthese                           (score de sante, roadmap, executive summary)
//
// Les runners d'outils (semgrep, lighthouse, zap...) sont injectes: ce fichier
// orchestre, il ne connait pas les outils. Ca permet de tester le flux sans infra.

import { activeAgents } from "./agents.js";
import { priorityScore, dedupeKey, healthScore, SEVERITY } from "./schema.js";

/**
 * @param {Object} deps
 * @param {(target) => Promise<Scope>} deps.scan            - couche 1
 * @param {(agent, scope) => Promise<Finding[]>} deps.runAgent - couche 2
 * @param {(finding) => Promise<Finding>} deps.verify        - couche 3
 * @param {(msg: string) => void} [deps.onProgress]
 */
export function createOrchestrator({ scan, runAgent, verify, onProgress = () => {}, concurrency = Infinity }) {
  return async function audit(target) {
    // Couche 1 - Scoping. Les agents recoivent un perimetre, ils ne le redecouvrent pas.
    onProgress("scoping");
    const scope = await scan(target);
    const agents = activeAgents(scope);
    onProgress(`scope pret: ${scope.pages?.length ?? 0} pages, ${agents.length} agents actifs`);

    // Couche 2 - Fan-out par lots (concurrence bornee pour maitriser le pic memoire).
    const runOne = async (agent) => {
      onProgress(`agent:${agent.id} demarre`);
      const findings = await runAgent(agent, scope);
      onProgress(`agent:${agent.id} termine (${findings.length})`);
      return findings.map((f) => ({ ...f, agent: agent.id, family: agent.family }));
    };
    const raw = (await mapLimit(agents, concurrency, runOne)).flat();

    // Couche 3 - Verification adversariale. Un finding non reproductible est rejete.
    onProgress(`verification de ${raw.length} findings`);
    const verified = await Promise.all(raw.map(verify));
    const survivors = verified.filter((f) => f.check?.verdict !== "rejected");

    // Couche 4 - Dedup inter-domaines puis scoring impact/effort.
    // Tri: la severite prime (un critique n'est jamais depasse par un moyen),
    // le score impact/effort departage a severite egale (les quick wins remontent).
    const merged = dedupe(survivors);
    const weightById = Object.fromEntries(agents.map((a) => [a.id, a.weight]));
    for (const f of merged) f.priority = priorityScore(f, weightById[f.agent] ?? 1);
    merged.sort((a, b) =>
      (SEVERITY[b.severity]?.rank ?? 0) - (SEVERITY[a.severity]?.rank ?? 0) ||
      b.priority - a.priority
    );

    // Couche 5 - Synthese.
    const score = healthScore(merged, agents);
    onProgress(`synthese: sante ${score}/100, ${merged.length} findings retenus`);

    return {
      target,
      scope,
      score,
      agents: agents.map((a) => a.id),
      findings: merged,
      summary: synthesize(merged, score, agents),
      generatedAt: null, // stampe par l'appelant (pas de Date.now ici)
    };
  };
}

// Applique fn a chaque item avec au plus `limit` executions simultanees.
// Preserve l'ordre des resultats. limit=Infinity => tout en parallele.
async function mapLimit(items, limit, fn) {
  const cap = Number.isFinite(limit) ? Math.max(1, limit) : items.length;
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return results;
}

// Fusionne les findings qui pointent le meme endroit + meme regle normalisee.
// On garde la severite max et on trace tous les agents qui l'ont remonte.
function dedupe(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = dedupeKey(f);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...f, raisedBy: [f.agent] });
      continue;
    }
    if (!prev.raisedBy.includes(f.agent)) prev.raisedBy.push(f.agent);
    if ((SEVERITY[f.severity]?.rank ?? 0) > (SEVERITY[prev.severity]?.rank ?? 0)) {
      prev.severity = f.severity;
    }
  }
  return [...map.values()];
}

// Construit l'executive summary: comptes par severite, top risques, effort total,
// et un decoupage roadmap par SLA de severite.
function synthesize(findings, score, agents) {
  const bySeverity = {};
  for (const s of Object.keys(SEVERITY)) bySeverity[s] = 0;
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  const totalEffort = findings.reduce((s, f) => s + (f.effort ?? 0), 0);
  const riskEur = findings.reduce((s, f) => s + (f.business?.risk_eur ?? 0), 0);
  const gainEur = findings.reduce((s, f) => s + (f.business?.gain_eur ?? 0), 0);

  return {
    score,
    bySeverity,
    domainsCovered: agents.length,
    totalFindings: findings.length,
    effortDays: Math.round(totalEffort * 10) / 10,
    riskEur,
    gainEur,
    quickWins: findings.filter((f) => (f.effort ?? 1) <= 0.25).slice(0, 10),
    top: findings.slice(0, 10),
    roadmap: {
      immediat: findings.filter((f) => f.severity === "critical"),
      semaine: findings.filter((f) => f.severity === "high"),
      mois: findings.filter((f) => f.severity === "medium"),
      backlog: findings.filter((f) => ["low", "info"].includes(f.severity)),
    },
  };
}
