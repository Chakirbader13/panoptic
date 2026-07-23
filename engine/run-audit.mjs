#!/usr/bin/env node
// Panoptic - CLI d'audit complet. Recon (1 crawl) -> 15 agents -> verif -> dedup -> synthese.
//   node run-audit.mjs <url> [--repo <chemin>] [--pages N] [--cookie "s=..."] [--bearer <token>]
// Exemples:
//   node run-audit.mjs https://example.com --repo . --pages 12
//   node run-audit.mjs https://app.exemple.fr/dashboard --cookie "session=abc123" --pages 8
import { createOrchestrator } from "./orchestrator.js";
import { recon } from "./recon.js";
import { runAgent } from "./registry.js";
import { verifyFinding } from "./verify.js";

const args = process.argv.slice(2);
let target = null, repoPath = null, maxPages = 1, cookie = null, bearer = null;
const headers = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repo") repoPath = args[++i];
  else if (args[i] === "--pages") maxPages = Math.max(1, Math.min(30, parseInt(args[++i], 10) || 1));
  else if (args[i] === "--cookie") cookie = args[++i];
  else if (args[i] === "--bearer") bearer = args[++i];
  else if (args[i] === "--header") { const h = args[++i]; const idx = h.indexOf(":"); if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim(); }
  else if (!args[i].startsWith("--")) target = args[i];
}
if (!target) { console.error("usage: node run-audit.mjs <url> [--repo <chemin>] [--pages N] [--cookie ...] [--bearer ...] [--header 'K: V']"); process.exit(2); }
const auth = (cookie || bearer || Object.keys(headers).length) ? { cookie, bearer, headers: Object.keys(headers).length ? headers : undefined } : null;

const c = { r: "\x1b[0m", d: "\x1b[2m", b: "\x1b[1m", red: "\x1b[31m", org: "\x1b[33m", yel: "\x1b[93m", blue: "\x1b[34m", gry: "\x1b[90m", grn: "\x1b[32m" };
const SEV = { critical: c.red, high: c.org, medium: c.yel, low: c.blue, info: c.gry };

const scan = (t) => recon(t, { repoPath, auth, maxPages });
const audit = createOrchestrator({ scan, runAgent, verify: verifyFinding, onProgress: (m) => process.stdout.write(`${c.gry}.${c.r} ${m}\n`) });

const authNote = auth ? ` ${c.gry}[authentifie]${c.r}` : "";
console.log(`\n${c.b}Panoptic - audit complet${c.r}  ${c.d}${target}${repoPath ? " + repo " + repoPath : ""}${maxPages > 1 ? " + " + maxPages + " pages" : ""}${c.r}${authNote}\n`);
const t0 = performance.now();
const r = await audit(target);
const secs = ((performance.now() - t0) / 1000).toFixed(1);

console.log(`\n${c.b}=== SYNTHESE ===${c.r}`);
console.log(`sante           : ${scoreColor(r.score)}${r.score}/100${c.r}`);
console.log(`agents actifs   : ${r.agents.length}  (${r.agents.join(", ")})`);
console.log(`findings retenus: ${c.b}${r.findings.length}${c.r}`);
const s = r.summary;
console.log(`par severite    : ` + Object.entries(s.bySeverity).map(([k, v]) => `${SEV[k]}${v} ${k}${c.r}`).join("  "));
console.log(`effort total    : ${s.effortDays} j-h    risque ~${s.riskEur.toLocaleString("fr-FR")} EUR    gain potentiel ~${s.gainEur.toLocaleString("fr-FR")} EUR`);
console.log(`duree           : ${secs}s\n`);

console.log(`${c.b}TOP 12 (severite puis impact/effort)${c.r}`);
for (const f of r.findings.slice(0, 12)) {
  const loc = f.location.file ? `${f.location.file}:${f.location.line}` : (f.location.url || "");
  const raised = f.raisedBy && f.raisedBy.length > 1 ? ` ${c.gry}<${f.raisedBy.join("+")}>${c.r}` : "";
  console.log(`${SEV[f.severity]}${c.b}[${f.severity}]${c.r} ${f.title}  ${c.gry}${f.agent}${c.r}${raised}`);
  console.log(`   ${c.d}${loc}${c.r}`);
}

console.log(`\n${c.b}ROADMAP${c.r}  immediat ${s.roadmap.immediat.length} | semaine ${s.roadmap.semaine.length} | mois ${s.roadmap.mois.length} | backlog ${s.roadmap.backlog.length}`);

function scoreColor(n) { return n >= 80 ? c.grn : n >= 50 ? c.yel : c.red; }
process.exit(0);

