// Panoptic - Agent Donnees et base de donnees. Heuristiques sur le code (requetes, migrations).
import { makeFinding } from "../shared.js";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";

const CODE_EXT = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".php", ".sql", ".prisma"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor"]);

const RULES = [
  { id: "select-star", re: /\bSELECT\s+\*\s+FROM\b/i, severity: "low", effort: 0.3, title: "Requete SELECT * (colonnes non explicites)", fix: "Selectionner uniquement les colonnes necessaires (perf + stabilite)." },
  { id: "n-plus-one", re: /for\s*\(|\.map\(|\.forEach\(/, needs: /await\s+.*\.(find|query|get|findOne|select)\(/, severity: "medium", effort: 0.5, title: "Requete probable dans une boucle (N+1)", fix: "Charger en une requete (jointure / include / batching)." },
  { id: "no-limit", re: /\.(find|findAll|query)\((?![^)]*limit)[^)]*\)/i, severity: "info", effort: 0.3, title: "Lecture potentiellement sans limite", fix: "Ajouter une limite/pagination aux lectures de collections." },
];

export function run(scope) {
  const findings = [];
  if (!scope.repoPath) return { findings, stats: { skipped: "pas de repo" } };
  const root = scope.repoPath;
  let files = 0, hasMigrations = false, hasSchema = false;
  const seen = new Set();

  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (/migrations?/i.test(e.name)) hasMigrations = true;
        walk(full); continue;
      }
      if (/schema\.(prisma|sql)$|\.sql$/i.test(e.name)) hasSchema = true;
      const ext = extname(e.name);
      if (!CODE_EXT.has(ext)) continue;
      let text; try { if (statSync(full).size > 800_000) continue; text = readFileSync(full, "utf8"); } catch { continue; }
      files++;
      const rel = relative(root, full);
      const rows = text.split(/\r?\n/);
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i];
        for (const r of RULES) {
          if (r.needs) {
            if (r.re.test(line) && r.needs.test(rows.slice(i, i + 4).join("\n"))) push(r, rel, i + 1, line);
          } else if (r.re.test(line)) push(r, rel, i + 1, line);
        }
      }
    }
  };
  function push(r, file, line, src) {
    const key = r.id + ":" + file;
    if (seen.has(key)) return; // un finding par regle et par fichier
    seen.add(key);
    findings.push(makeFinding("data", "technique", { rule: r.id, file, line, evidenceType: "code", severity: r.severity, effort: r.effort, title: r.title, fix: r.fix, proof: src.trim().slice(0, 100) }));
  }
  walk(root);

  // Indice d'ORM/BDD sans migrations versionnees
  const usesDb = files > 0 && findings.length > 0;
  if ((hasSchema || usesDb) && !hasMigrations) findings.push(makeFinding("data", "technique", { rule: "no-migrations", file: ".", line: 1, evidenceType: "code", severity: "low", effort: 0.5, title: "Acces base detecte sans dossier de migrations", fix: "Versionner le schema via des migrations (reproductibilite, rollback).", proof: "Aucun dossier migrations." }));

  return { findings, stats: { files, hasMigrations, hasSchema } };
}
