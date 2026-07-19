// Panoptic - Registre des runners d'agents. id (agents.js) -> fonction run(scope).
// C'est le point d'injection unique de l'orchestrateur: brancher un agent = une ligne ici.
import { runSecurity } from "./agents/security/index.js";
import { run as seo } from "./agents/seo/index.js";
import { run as geo } from "./agents/geo/index.js";
import { run as perf } from "./agents/perf/index.js";
import { run as a11y } from "./agents/a11y/index.js";
import { run as legal } from "./agents/legal/index.js";
import { run as analytics } from "./agents/analytics/index.js";
import { run as ux } from "./agents/ux/index.js";
import { run as cro } from "./agents/cro/index.js";
import { run as content } from "./agents/content/index.js";
import { run as infra } from "./agents/infra/index.js";
import { run as email } from "./agents/email/index.js";
import { run as deps } from "./agents/deps/index.js";
import { run as codeArch } from "./agents/code-arch/index.js";
import { run as data } from "./agents/data/index.js";

export const RUNNERS = {
  security: async (scope) => (await runSecurity({ repoPath: scope.repoPath, url: scope.url })).findings,
  seo: async (scope) => (await seo(scope)).findings,
  geo: async (scope) => (await geo(scope)).findings,
  perf: async (scope) => (await perf(scope)).findings,
  a11y: async (scope) => (await a11y(scope)).findings,
  legal: async (scope) => (await legal(scope)).findings,
  analytics: async (scope) => (await analytics(scope)).findings,
  ux: async (scope) => (await ux(scope)).findings,
  cro: async (scope) => (await cro(scope)).findings,
  content: async (scope) => (await content(scope)).findings,
  infra: async (scope) => (await infra(scope)).findings,
  email: async (scope) => (await email(scope)).findings,
  deps: async (scope) => (await deps(scope)).findings,
  "code-arch": async (scope) => (await codeArch(scope)).findings,
  data: async (scope) => (await data(scope)).findings,
};

// Dispatch pour createOrchestrator: (agent, scope) -> Finding[]
export async function runAgent(agent, scope) {
  const fn = RUNNERS[agent.id];
  if (!fn) return [];
  try { return await fn(scope); }
  catch (e) { return [{ agent: agent.id, family: agent.family, rule: "agent-error", title: `Agent ${agent.id} en erreur`, severity: "info", evidence: { type: "code", proof: e.message, reproducible: false }, location: {}, business: { kind: "risk", risk_eur: 0 }, fix: { summary: "Corriger l'agent." }, effort: 0, check: { verdict: "plausible", votes: 1, refuters: 0 } }]; }
}
