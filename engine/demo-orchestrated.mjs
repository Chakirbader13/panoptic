#!/usr/bin/env node
// Panoptic - demo du pipeline COMPLET avec l'agent securite reel branche.
// Prouve que l'orchestrateur (scoping -> fan-out -> verif -> dedup -> synthese)
// tourne avec un vrai agent qui trouve de vraies failles.
//   node demo-orchestrated.mjs [--url https://site]
import { createOrchestrator } from "./orchestrator.js";
import { runSecurity } from "./agents/security/index.js";
import { verifyFinding } from "./verify.js";
import { AGENTS } from "./agents.js";

const urlArg = (() => { const i = process.argv.indexOf("--url"); return i >= 0 ? process.argv[i + 1] : "https://example.com"; })();
const FIXTURES = new URL("./agents/security/__fixtures__", import.meta.url).pathname;

// Couche 1 - scoping (ici fourni; en prod, produit par l'agent de reconnaissance).
const scan = async (target) => ({
  target, url: target, repoPath: FIXTURES,
  pages: ["/"], repo: true, database: false, sendsEmail: false,
});

// Couche 2 - fan-out. L'agent securite est REEL; les autres sont encore des stubs vides.
const runAgent = async (agent, scope) => {
  if (agent.id === "security") {
    const { findings } = await runSecurity({ repoPath: scope.repoPath, url: scope.url });
    return findings;
  }
  return []; // agents restants: a implementer (option A / runners reels)
};

// Couche 3 - verification adversariale reelle (preserve les verdicts de l'agent securite).
const log = (m) => console.log("  .", m);
const audit = createOrchestrator({ scan, runAgent, verify: verifyFinding, onProgress: log });

console.log("\nPanoptic - pipeline complet (agent securite reel)\n");
const r = await audit(urlArg);
r.generatedAt = new Date().toISOString();

console.log("\n=== SYNTHESE ===");
console.log("cible          :", r.target);
console.log("sante          :", r.score + "/100");
console.log("agents actifs  :", r.agents.length, "(securite reel, 14 stubs)");
console.log("findings retenus:", r.findings.length);
console.log("par severite   :", JSON.stringify(r.summary.bySeverity));
console.log("effort total   :", r.summary.effortDays, "j-h");
console.log("risque cumule  : ~" + r.summary.riskEur.toLocaleString("fr-FR"), "EUR");
console.log("\ntop 5 par priorite (impact/effort):");
for (const f of r.summary.top.slice(0, 5)) {
  const loc = f.location.file ? `${f.location.file}:${f.location.line}` : f.location.url;
  console.log(`  [${f.severity}] ${f.title}  <${f.raisedBy.join("+")}> prio=${f.priority}  ${loc}`);
}
console.log("\nroadmap:");
console.log("  immediat (critique):", r.summary.roadmap.immediat.length);
console.log("  semaine  (eleve)   :", r.summary.roadmap.semaine.length);
console.log("  mois     (moyen)   :", r.summary.roadmap.mois.length);
console.log("  backlog            :", r.summary.roadmap.backlog.length);
