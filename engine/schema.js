// Panoptic - Schema unique de finding.
// C'est le contrat central: chaque agent, quel que soit son domaine, produit ce format.
// L'orchestrateur ne peut dedoublonner et prioriser a travers 15 domaines QUE parce que
// tous les findings parlent la meme langue.

/**
 * @typedef {Object} Finding
 * @property {string} id            - identifiant stable (hash de agent+localisation+regle)
 * @property {string} agent         - id de l'agent emetteur (voir agents.js)
 * @property {string} family        - technique | visibilite | humain | risque
 * @property {string} rule          - regle / check declencheur
 * @property {string} title         - resume court, oriente probleme
 * @property {Severity} severity     - severite normalisee (voir SEVERITY)
 * @property {Evidence} evidence     - preuve reproductible (sinon rejete a la verification)
 * @property {Location} location     - localisation code ET/OU prod
 * @property {Business} business     - traduction en risque / gain
 * @property {Remediation} fix       - correctif propose
 * @property {number} effort         - effort en jours-homme (0.1 = quick win)
 * @property {Verification} check    - resultat de la verification adversariale
 */

export const SEVERITY = {
  critical: { rank: 5, label: "Critique", sla: "Immediat" },
  high: { rank: 4, label: "Eleve", sla: "7 jours" },
  medium: { rank: 3, label: "Moyen", sla: "30 jours" },
  low: { rank: 2, label: "Faible", sla: "90 jours" },
  info: { rank: 1, label: "Info", sla: "Backlog" },
};

/**
 * @typedef {"critical"|"high"|"medium"|"low"|"info"} Severity
 * @typedef {{ type: "code"|"prod"|"both", proof: string, reproducible: boolean, artifact?: string }} Evidence
 * @typedef {{ file?: string, line?: number, url?: string, selector?: string }} Location
 * @typedef {{ impact: string, risk_eur?: number, gain_eur?: number, kind: "risk"|"gain" }} Business
 * @typedef {{ summary: string, patch?: string, opens_pr?: boolean }} Remediation
 * @typedef {{ verdict: "confirmed"|"plausible"|"rejected", votes: number, refuters: number }} Verification
 */

// Priorisation impact / effort. Score haut = a traiter en premier.
// Combine la severite, le poids du domaine et l'inverse de l'effort.
export function priorityScore(finding, agentWeight = 1) {
  const sev = SEVERITY[finding.severity]?.rank ?? 1;
  const effort = Math.max(0.1, finding.effort ?? 1);
  const confidence = finding.check?.verdict === "confirmed" ? 1 : finding.check?.verdict === "plausible" ? 0.6 : 0;
  return Math.round(((sev * sev * agentWeight * confidence) / effort) * 10);
}

// Cle de deduplication inter-agents. Le meme probleme remonte souvent via
// securite ET perf ET seo: on le fusionne sur localisation + regle normalisee.
export function dedupeKey(finding) {
  const loc = finding.location?.file
    ? `${finding.location.file}:${finding.location.line ?? 0}`
    : finding.location?.url || finding.location?.selector || "global";
  return `${loc}::${normalizeRule(finding.rule)}`;
}

function normalizeRule(rule = "") {
  return rule.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Score d'un domaine (0-100) a partir de ses seuls findings. Plus sensible que le global.
export function domainScore(findings) {
  const penalty = findings
    .filter((f) => f.check?.verdict !== "rejected")
    .reduce((s, f) => { const sev = SEVERITY[f.severity]?.rank ?? 1; return s + sev * sev; }, 0);
  return Math.max(0, Math.round(100 - (100 * penalty) / (penalty + 40)));
}

// Score de sante global du site, 0-100, pondere par domaine.
// Un finding critique non resolu plafonne le score de sa famille.
export function healthScore(findings, agents) {
  const weightById = Object.fromEntries(agents.map((a) => [a.id, a.weight]));
  const penalties = findings
    .filter((f) => f.check?.verdict !== "rejected")
    .reduce((sum, f) => {
      const w = weightById[f.agent] ?? 0.5;
      const sev = SEVERITY[f.severity]?.rank ?? 1;
      return sum + w * sev * sev;
    }, 0);
  // Normalisation douce: beaucoup de findings graves font chuter le score sans jamais < 0.
  return Math.max(0, Math.round(100 - (100 * penalties) / (penalties + 120)));
}
