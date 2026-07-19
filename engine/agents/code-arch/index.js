// Panoptic - Agent Code et architecture. Heuristiques de dette technique sur le repo.
import { makeFinding } from "../shared.js";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";

const CODE_EXT = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".php", ".java"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor", "__pycache__"]);

export function run(scope) {
  const findings = [];
  if (!scope.repoPath) return { findings, stats: { skipped: "pas de repo" } };
  const root = scope.repoPath;

  let files = 0, totalLines = 0, testFiles = 0;
  let todos = 0, debugs = 0; const bigFiles = [];
  const todoLocs = []; const debugLocs = [];

  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = extname(e.name);
      if (!CODE_EXT.has(ext)) continue;
      if (/\.(test|spec)\.|__tests__/.test(full) || /(^|[\/])tests?[\/]/.test(full)) testFiles++;
      let text; try { if (statSync(full).size > 800_000) continue; text = readFileSync(full, "utf8"); } catch { continue; }
      files++;
      const rel = relative(root, full);
      const rows = text.split(/\r?\n/);
      totalLines += rows.length;
      if (rows.length > 600) bigFiles.push({ rel, n: rows.length });
      for (let i = 0; i < rows.length; i++) {
        if (/\b(TODO|FIXME|HACK|XXX)\b/.test(rows[i])) { todos++; if (todoLocs.length < 1) todoLocs.push({ rel, line: i + 1, src: rows[i].trim().slice(0, 80) }); }
        if (/console\.(log|debug)\(|debugger;|print\(|var_dump\(/.test(rows[i])) { debugs++; if (debugLocs.length < 1) debugLocs.push({ rel, line: i + 1, src: rows[i].trim().slice(0, 80) }); }
      }
    }
  };
  walk(root);

  // Fichiers trop longs (couplage / responsabilite unique)
  for (const b of bigFiles.slice(0, 5)) {
    findings.push(makeFinding("code-arch", "technique", { rule: "large-file", file: b.rel, line: 1, evidenceType: "code", severity: "low", effort: 0.5, title: `Fichier volumineux (${b.n} lignes)`, fix: "Decouper en modules a responsabilite unique.", proof: `${b.n} lignes.` }));
  }

  // Dettes marquees en commentaire
  if (todos > 0) findings.push(makeFinding("code-arch", "technique", { rule: "todo-debt", file: todoLocs[0].rel, line: todoLocs[0].line, evidenceType: "code", severity: "info", effort: Math.min(2, todos * 0.1), title: `${todos} marqueur(s) TODO/FIXME/HACK`, fix: "Trier: creer des tickets, resoudre ou supprimer.", proof: todoLocs[0].src }));

  // Traces de debug laissees
  if (debugs > 0) findings.push(makeFinding("code-arch", "technique", { rule: "debug-left", file: debugLocs[0].rel, line: debugLocs[0].line, evidenceType: "code", severity: "low", effort: 0.2, title: `${debugs} instruction(s) de debug laissee(s) (console.log/print/debugger)`, fix: "Retirer les traces de debug ou passer par un logger conditionnel.", proof: debugLocs[0].src }));

  // Absence de tests
  if (files > 8 && testFiles === 0) findings.push(makeFinding("code-arch", "technique", { rule: "no-tests", file: "package.json", line: 1, evidenceType: "code", severity: "medium", effort: 1.5, title: "Aucun fichier de test detecte", fix: "Introduire des tests sur les chemins critiques (au moins la logique metier).", proof: `${files} fichiers de code, 0 test.` }));

  return { findings, stats: { files, totalLines, testFiles, todos, debugs, bigFiles: bigFiles.length } };
}
