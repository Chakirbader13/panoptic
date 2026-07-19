// Panoptic - Agent securite: scan du code source (SAST + secrets).
// Parcourt un dossier, applique les regles ligne par ligne, retourne des findings bruts
// (localisation fichier:ligne + preuve). La mise au format canonique se fait dans index.js.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { SECRET_RULES, CODE_RULES } from "./rules.js";

const NUL = String.fromCharCode(0);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  "coverage", "vendor", ".cache", "__pycache__", ".venv", "venv",
]);
const SCAN_EXT = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".php",
  ".go", ".java", ".vue", ".svelte", ".html", ".sh", ".yml", ".yaml",
  ".json", ".env", ".tf", ".ini", ".cfg", ".txt", ".xml",
]);
const DOTFILES = new Set([".env", ".env.local", ".env.production", ".npmrc", ".netrc"]);
const MAX_BYTES = 1_000_000;
const extLang = { ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "ts", ".jsx": "jsx", ".tsx": "tsx", ".py": "py", ".php": "php", ".html": "html", ".env": "env" };

function* walk(dir, root) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full, root);
    } else if (e.isFile()) {
      const ext = extname(e.name);
      if (!SCAN_EXT.has(ext) && !DOTFILES.has(e.name) && !e.name.startsWith(".env")) continue;
      try { if (statSync(full).size > MAX_BYTES) continue; } catch { continue; }
      yield full;
    }
  }
}

// Retourne { findings, stats:{files, lines} }
export function scanCode(root, { ignore = [] } = {}) {
  const findings = [];
  let files = 0, lines = 0;
  const ignoreAbs = ignore.map((p) => join(root, p));

  for (const file of walk(root, root)) {
    if (ignoreAbs.some((p) => file.startsWith(p))) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (text.indexOf(NUL) !== -1) continue; // binaire
    files++;
    const rel = relative(root, file) || file;
    const ext = extname(file);
    const lang = extLang[ext];
    const rows = text.split(/\r?\n/);
    lines += rows.length;

    for (let i = 0; i < rows.length; i++) {
      const line = rows[i];
      if (line.length > 2000) continue;
      // Suppression inline (comme nosemgrep): marque une ligne comme faux positif accepte.
      if (/panoptic-ignore/i.test(line) || (i > 0 && /panoptic-ignore/i.test(rows[i - 1]))) continue;

      for (const r of SECRET_RULES) {
        const m = r.re.exec(line);
        if (m) findings.push(mkRaw(r, "secret", rel, i + 1, m[0], line));
      }
      for (const r of CODE_RULES) {
        if (r.langs && lang && !r.langs.includes(lang)) continue;
        const m = r.re.exec(line);
        if (m) findings.push(mkRaw(r, "code", rel, i + 1, m[0], line));
      }
    }
  }
  return { findings, stats: { files, lines } };
}

function mkRaw(rule, kind, file, line, match, source) {
  return {
    ruleId: rule.id, kind, cwe: rule.cwe, severity: rule.severity,
    title: rule.title, fix: rule.fix, effort: rule.effort, confidence: rule.confidence,
    file, line, match: match.slice(0, 80), source: source.trim().slice(0, 200),
  };
}
