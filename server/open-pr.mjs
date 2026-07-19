#!/usr/bin/env node
// Panoptic - CLI d'ouverture de PR depuis un audit stocke.
//   GITHUB_TOKEN=... node server/open-pr.mjs <auditId> <owner/repo> [--dry-run]
// Sans token ou avec --dry-run: affiche le plan sans rien pousser.
import { store } from "./store.js";
import { openAuditPR } from "./github.js";

const [auditId, repoArg, ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run") || !process.env.GITHUB_TOKEN;
if (!auditId) { console.error("usage: [GITHUB_TOKEN=...] node open-pr.mjs <auditId> <owner/repo> [--dry-run]"); process.exit(2); }

const audit = await store.get(auditId);
if (!audit) { console.error("audit introuvable:", auditId); process.exit(1); }
const [owner, repo] = (repoArg || "/").split("/");

const r = await openAuditPR({ token: process.env.GITHUB_TOKEN, owner, repo, audit, dryRun });

if (r.dryRun) {
  console.log(`\nPLAN DE PR (dry-run) — ${r.note}\n`);
  console.log("branche :", r.branch);
  console.log("titre   :", r.title);
  console.log("fichiers:", Object.keys(r.files).join(", "));
  console.log("findings:", r.stats.total, `(code ${r.stats.code}, prod ${r.stats.prod})`);
  console.log("\n--- corps de la PR (extrait) ---");
  console.log(r.body.split("\n").slice(0, 12).join("\n"));
  console.log("...\n\nPour ouvrir reellement: GITHUB_TOKEN=<token> node server/open-pr.mjs " + auditId + " " + (repoArg || "<owner/repo>"));
} else {
  console.log(`\nPR ouverte: ${r.url}`);
  console.log(`branche ${r.branch} -> ${r.base}, fichiers ajoutes: ${r.filesWritten.join(", ") || "(aucun nouveau)"}`);
}
