// Panoptic - Agent Dependances / supply chain. Interroge l'API OSV (vulns connues) en reel.
import { makeFinding } from "../shared.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export async function run(scope) {
  const findings = [];
  if (!scope.repoPath) return { findings, stats: { skipped: "pas de repo" } };
  const root = scope.repoPath;
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return { findings, stats: { skipped: "pas de package.json" } };

  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); } catch { return { findings, stats: { error: "package.json illisible" } }; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const names = Object.keys(deps);

  // Lockfile present ?
  const hasLock = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"].some((f) => existsSync(join(root, f)));
  if (names.length && !hasLock) findings.push(makeFinding("deps", "technique", { rule: "no-lockfile", file: "package.json", line: 1, evidenceType: "code", severity: "medium", effort: 0.2, title: "Aucun lockfile (installations non reproductibles)", fix: "Committer un lockfile (package-lock/yarn/pnpm/bun).", proof: `${names.length} dependances sans lockfile.` }));

  // Interrogation OSV pour les vulnerabilites connues.
  const queries = names.map((n) => ({ package: { name: n, ecosystem: "npm" }, version: cleanVersion(deps[n]) })).filter((q) => q.version);
  if (queries.length) {
    const osv = await osvBatch(queries).catch((e) => ({ error: e.message }));
    if (!osv.error && osv.results) {
      osv.results.forEach((r, i) => {
        const vulns = r?.vulns || [];
        if (vulns.length) {
          const name = queries[i].package.name;
          findings.push(makeFinding("deps", "technique", {
            rule: "known-vuln", file: "package.json", line: 1, evidenceType: "code",
            cwe: "CWE-1104", severity: vulns.length > 2 ? "high" : "medium", effort: 0.3,
            title: `${name}@${queries[i].version}: ${vulns.length} vulnerabilite(s) connue(s)`,
            fix: `Mettre a jour ${name} vers une version corrigee (${vulns.map((v) => v.id).slice(0, 3).join(", ")}).`,
            proof: vulns.map((v) => v.id).slice(0, 5).join(", "),
          }));
        }
      });
    } else {
      findings.push(makeFinding("deps", "technique", { rule: "osv-unreachable", file: "package.json", line: 1, evidenceType: "code", severity: "info", effort: 0, title: "Base OSV injoignable (scan de vulns non effectue)", fix: "Relancer avec acces reseau a api.osv.dev.", proof: osv.error || "?" }));
    }
  }

  return { findings, stats: { deps: names.length, lockfile: hasLock } };
}

function cleanVersion(range) {
  const m = String(range).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

async function osvBatch(queries) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    });
    return await res.json();
  } finally { clearTimeout(to); }
}
