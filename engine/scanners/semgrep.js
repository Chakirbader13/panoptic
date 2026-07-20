// Panoptic - runner semgrep REEL (SAST structurel, au-dela des regex maison).
// Execute le vrai binaire semgrep sur le depot clone (offre code+prod), avec un jeu
// de regles curate offline. Emet des findings au format "raw" de l'agent securite
// (scan.js), donc ils passent par toCanonical + verification + dedup sans cas special.
//
// DEGRADATION GRACIEUSE (jamais de fausse confiance): si semgrep est absent (ex.
// environnement serverless, binaire non installe) -> { available:false, findings:[] }
// et l'appelant le signale, il ne pretend pas avoir scanne.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RULES = join(dirname(fileURLToPath(import.meta.url)), "semgrep-rules.yml");
const SEV = { ERROR: "high", WARNING: "medium", INFO: "low" };

// Commande semgrep. En prod (Render) semgrep est sur le PATH (installe via Docker).
// SEMGREP_CMD permet de surcharger (ex. local: "uvx --from semgrep semgrep").
function resolveCmd() {
  const raw = process.env.SEMGREP_CMD;
  if (raw) { const p = raw.trim().split(/\s+/); return { bin: p[0], pre: p.slice(1) }; }
  return { bin: "semgrep", pre: [] };
}

function firstCwe(meta) {
  const c = meta?.cwe;
  const s = Array.isArray(c) ? c[0] : c;
  const m = /CWE-\d+/.exec(s || "");
  return m ? m[0] : undefined;
}

/**
 * @param {string} repoPath  depot a scanner (chemin absolu)
 * @returns {Promise<{findings: object[], available: boolean, error?: string, stats?: object}>}
 */
export function runSemgrep(repoPath, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    if (!repoPath) return resolve({ findings: [], available: false, error: "pas de depot" });
    const { bin, pre } = resolveCmd();
    const args = [
      ...pre, "--json", "--quiet", "--disable-version-check", "--metrics=off",
      "--timeout", "30", "--config", RULES, repoPath,
    ];
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Codes semgrep: 0 = aucun finding, 1 = findings trouves (PAS une erreur),
      // autres = erreur reelle. On parse stdout des qu'il existe.
      if (err && err.code !== 1 && !stdout) {
        const missing = err.code === "ENOENT";
        return resolve({ findings: [], available: !missing, error: missing ? "semgrep absent du PATH" : (err.message || String(stderr).slice(0, 300)) });
      }
      let data;
      try { data = JSON.parse(stdout); } catch { return resolve({ findings: [], available: true, error: "sortie semgrep illisible" }); }
      const findings = (data.results || []).map((r) => {
        const rel = relative(repoPath, r.path) || r.path;
        const src = String(r.extra?.lines || "").trim().slice(0, 200);
        return {
          ruleId: "semgrep:" + String(r.check_id).split(".").pop(),
          kind: "code",
          cwe: firstCwe(r.extra?.metadata),
          severity: SEV[r.extra?.severity] || "low",
          title: (r.extra?.message || r.check_id).split(" - ")[0].slice(0, 120),
          fix: r.extra?.metadata?.fix || r.extra?.message,
          effort: 0.4,
          confidence: "high", // semgrep = analyse structurelle, faible taux de faux positifs
          file: rel,
          line: r.start?.line || 1,
          match: src.slice(0, 80),
          source: src,
        };
      });
      resolve({ findings, available: true, stats: { results: findings.length, errors: (data.errors || []).length } });
    });
  });
}
