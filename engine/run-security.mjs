#!/usr/bin/env node
// Panoptic - CLI de l'agent securite.
//   node run-security.mjs <chemin> [--url https://site]
//   node run-security.mjs --url https://site
// Exemples:
//   node run-security.mjs ./agents/security/__fixtures__
//   node run-security.mjs . --url https://example.com
import { runSecurity } from "./agents/security/index.js";

const args = process.argv.slice(2);
let repoPath = null, url = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url") url = args[++i];
  else if (!args[i].startsWith("--")) repoPath = args[i];
}
if (!repoPath && !url) {
  console.error("usage: node run-security.mjs <chemin> [--url https://site]");
  process.exit(2);
}

const c = { reset: "\x1b[0m", dim: "\x1b[2m", b: "\x1b[1m", red: "\x1b[31m", org: "\x1b[33m", yel: "\x1b[93m", blue: "\x1b[34m", grn: "\x1b[32m", gry: "\x1b[90m" };
const SEV = {
  critical: { c: c.red, l: "CRITIQUE" }, high: { c: c.org, l: "ELEVE" },
  medium: { c: c.yel, l: "MOYEN" }, low: { c: c.blue, l: "FAIBLE" }, info: { c: c.gry, l: "INFO" },
};
const VERD = { confirmed: `${c.grn}confirme${c.reset}`, plausible: `${c.yel}plausible${c.reset}`, rejected: `${c.gry}rejete${c.reset}` };

console.log(`\n${c.b}Panoptic - Agent securite${c.reset}`);
console.log(`${c.dim}cible code: ${repoPath || "(aucune)"}   cible prod: ${url || "(aucune)"}${c.reset}\n`);

const { findings, stats } = await runSecurity({ repoPath, url });

if (repoPath) console.log(`${c.dim}code:${c.reset} ${stats.files} fichiers, ${stats.lines} lignes scannes`);
if (url) console.log(`${c.dim}prod:${c.reset} ${stats.prodReachable ? `${stats.prod.status} sur ${stats.prod.url} (server: ${stats.prod.server || "masque"})` : `injoignable (${stats.prod?.error || "?"})`}`);
console.log(`${c.dim}matches bruts:${c.reset} ${stats.rawMatches}   ${c.dim}rejetes (faux positifs):${c.reset} ${stats.rejected}   ${c.dim}retenus:${c.reset} ${c.b}${stats.reported}${c.reset}\n`);

const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
for (const f of findings) counts[f.severity]++;
console.log(Object.entries(counts).map(([k, v]) => `${SEV[k].c}${v} ${SEV[k].l.toLowerCase()}${c.reset}`).join("   ") + "\n");

let n = 0;
for (const f of findings) {
  const s = SEV[f.severity];
  const loc = f.location.file ? `${f.location.file}:${f.location.line}` : f.location.url;
  console.log(`${s.c}${c.b}[${s.l}]${c.reset} ${f.title}  ${c.gry}${f.cwe} ${f.id}${c.reset}`);
  console.log(`  ${c.dim}ou:${c.reset} ${loc}`);
  console.log(`  ${c.dim}preuve:${c.reset} ${String(f.evidence.proof).replace(/\s+/g, " ").slice(0, 100)}`);
  console.log(`  ${c.dim}verdict:${c.reset} ${VERD[f.check.verdict]} ${c.gry}(${f.check.votes}/${f.check.votes + f.check.refuters}) - ${f.check.reason}${c.reset}`);
  console.log(`  ${c.dim}correctif:${c.reset} ${f.fix.summary}`);
  console.log(`  ${c.dim}effort:${c.reset} ${f.effort} j-h   ${c.dim}risque:${c.reset} ~${f.business.risk_eur.toLocaleString("fr-FR")} EUR\n`);
  n++;
}

const riskTotal = findings.reduce((s, f) => s + f.business.risk_eur, 0);
console.log(`${c.b}${n} findings retenus${c.reset}  ${c.dim}risque cumule ~${riskTotal.toLocaleString("fr-FR")} EUR${c.reset}`);

// Exit code CI: non-zero si critique ou eleve.
process.exit(counts.critical + counts.high > 0 ? 1 : 0);
