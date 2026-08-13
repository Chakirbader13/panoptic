#!/usr/bin/env node
// Panoptic CLI - audit de site depuis le terminal ou la CI. Zero dependance.
//
//   npx panoptic scan <url> [options]
//
// Options:
//   --pages N          profondeur de crawl (defaut 1; >1 active axe/Lighthouse)
//   --repo <chemin>    audite aussi le code source local (agents deps/code/data/secu)
//   --cookie <v>       scan authentifie (cookie de session)
//   --bearer <token>   scan authentifie (jeton bearer)
//   --json             sortie JSON brute (pour scripts / pipe vers un agent IA)
//   --fail-on <sev>    code de sortie != 0 si un finding >= severite (critical|high|medium|low)
//   --quiet            pas de progression
//
// Exemples:
//   npx panoptic scan https://exemple.fr --pages 10
//   npx panoptic scan https://exemple.fr --repo . --json > audit.json
//   npx panoptic scan https://exemple.fr --fail-on high      # casse le build en CI
import { runAudit, countAtOrAbove } from "../engine/audit.mjs";

const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", red: "\x1b[31m", org: "\x1b[33m", yel: "\x1b[93m", blue: "\x1b[34m", gry: "\x1b[90m", grn: "\x1b[32m" };
const SEVC = { critical: C.red, high: C.org, medium: C.yel, low: C.blue, info: C.gry };
const isTTY = process.stdout.isTTY;
const col = (c, s) => (isTTY ? c + s + C.r : s);

function parse(argv) {
  const o = { cmd: argv[0], target: null, pages: 1, repo: null, cookie: null, bearer: null, json: false, failOn: null, quiet: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") o.pages = Math.max(1, Math.min(30, parseInt(argv[++i], 10) || 1));
    else if (a === "--repo") o.repo = argv[++i];
    else if (a === "--cookie") o.cookie = argv[++i];
    else if (a === "--bearer") o.bearer = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--fail-on") o.failOn = argv[++i];
    else if (a === "--quiet") o.quiet = true;
    else if (!a.startsWith("--") && !o.target) o.target = a;
  }
  return o;
}

function usage() {
  process.stderr.write(`Panoptic - audit de site\n\n  npx panoptic scan <url> [--pages N] [--repo .] [--json] [--fail-on high]\n\nVoir https://panopticaudit.com\n`);
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.cmd !== "scan" || !o.target) { usage(); process.exit(2); }
  let target = o.target;
  if (!/^https?:\/\//.test(target)) target = "https://" + target;
  const auth = (o.cookie || o.bearer) ? { cookie: o.cookie, bearer: o.bearer } : null;

  const onProgress = (o.quiet || o.json) ? () => {} : (m) => process.stderr.write(col(C.gry, ". ") + m + "\n");
  const r = await runAudit(target, { repoPath: o.repo, maxPages: o.pages, auth, onProgress });

  if (o.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); }
  else printReport(r);

  // Code de sortie pour la CI.
  if (o.failOn) {
    const n = countAtOrAbove(r.findings, o.failOn);
    if (n > 0) { if (!o.json) process.stderr.write(col(C.red, `\n${n} finding(s) >= ${o.failOn} -> echec (--fail-on)\n`)); process.exit(1); }
  }
  process.exit(0);
}

function printReport(r) {
  const s = r.summary || {};
  const score = s.weightedScore ?? r.score;
  const sc = score >= 80 ? C.grn : score >= 50 ? C.yel : C.red;
  const w = process.stdout.write.bind(process.stdout);
  w(`\n${col(C.b, "Panoptic")} ${col(C.d, r.target)}\n`);
  w(`sante   : ${col(sc, score + "/100")}   findings: ${col(C.b, String(r.findings.length))}   agents: ${r.agents.length}\n`);
  const by = s.bySeverity || {};
  w(`severite: ` + ["critical", "high", "medium", "low", "info"].filter((k) => by[k]).map((k) => col(SEVC[k], by[k] + " " + k)).join("  ") + "\n");
  w(`effort  : ${s.effortDays ?? "?"} j-h   risque ~${(s.riskEur || 0).toLocaleString("fr-FR")} EUR (est.)\n\n`);
  const order = ["critical", "high", "medium", "low", "info"];
  const top = [...r.findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, 15);
  for (const f of top) {
    const loc = f.location?.file ? `${f.location.file}:${f.location.line}` : (f.location?.url || "");
    w(`${col(SEVC[f.severity], "[" + f.severity + "]")} ${f.title}  ${col(C.gry, f.agent)}\n`);
    if (loc) w(`   ${col(C.d, loc)}\n`);
  }
  if (r.findings.length > 15) w(col(C.gry, `\n... +${r.findings.length - 15} autres. --json pour tout.\n`));
}

main().catch((e) => { process.stderr.write("Erreur: " + e.message + "\n"); process.exit(3); });
