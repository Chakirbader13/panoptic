// Panoptic - Agent securite (agent de reference profond).
// Combine le scan de code (SAST + secrets) et le scan de prod (DAST passif),
// verifie chaque finding, mappe au schema canonique, dedoublonne, retire les faux positifs.
// Signature compatible orchestrator.js: runSecurity({repoPath, url}) -> Finding[]
import { scanCode } from "./scan.js";
import { scanProd } from "./prod.js";
import { verifyFinding } from "./verify.js";
import { dedupeKey } from "../../schema.js";

// Risque business indicatif (euros) par severite. Heuristique assumee, pas une mesure.
const RISK_EUR = { critical: 15000, high: 6000, medium: 1500, low: 300, info: 0 };

function toCanonical(raw) {
  const isProd = raw.kind === "prod";
  return {
    id: hash(`${raw.ruleId}:${raw.file || raw.url}:${raw.line || 0}`),
    agent: "security", family: "technique",
    rule: raw.ruleId, cwe: raw.cwe, title: raw.title, severity: raw.severity,
    evidence: {
      type: isProd ? "prod" : "code",
      proof: raw.proof || raw.source || raw.match,
      reproducible: true,
      artifact: raw.match || undefined,
    },
    location: isProd ? { url: raw.url } : { file: raw.file, line: raw.line },
    business: { kind: "risk", risk_eur: RISK_EUR[raw.severity] ?? 0, impact: raw.title },
    fix: { summary: raw.fix, opens_pr: false },
    effort: raw.effort ?? 0.3,
  };
}

export async function runSecurity({ repoPath, url } = {}) {
  const raw = [];
  const stats = { files: 0, lines: 0, prodReachable: false };

  if (repoPath) {
    const r = scanCode(repoPath);
    raw.push(...r.findings);
    stats.files = r.stats.files;
    stats.lines = r.stats.lines;
  }
  if (url) {
    const p = await scanProd(url);
    raw.push(...p.findings);
    stats.prodReachable = p.reachable;
    stats.prod = p.info;
  }

  // Verification + mise au format canonique.
  const verified = raw.map((r) => {
    const f = toCanonical(r);
    f.check = verifyFinding(r);
    return f;
  });

  // Retire les faux positifs, dedup, tri par severite.
  const survivors = verified.filter((f) => f.check.verdict !== "rejected");
  const merged = dedupe(survivors);
  const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  merged.sort((a, b) => (rank[b.severity] - rank[a.severity]) || (b.business.risk_eur - a.business.risk_eur));

  return {
    findings: merged,
    stats: { ...stats, rawMatches: raw.length, rejected: verified.length - survivors.length, reported: merged.length },
  };
}

// Adaptateur pour createOrchestrator: agent -> findings (le scope porte repoPath/url).
export function securityRunner(scope) {
  return runSecurity({ repoPath: scope.repoPath || scope.repo, url: scope.url || scope.target });
}

function dedupe(findings) {
  const map = new Map();
  for (const f of findings) {
    const k = dedupeKey(f);
    if (!map.has(k)) map.set(k, f);
  }
  return [...map.values()];
}

// Hash court deterministe (pas de dependance, pas de Date/random).
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "SEC-" + h.toString(36);
}
