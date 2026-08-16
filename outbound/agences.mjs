#!/usr/bin/env node
// Panoptic - moteur d'outbound agences PERSONNALISE.
//
// L'angle que personne d'autre ne peut jouer : on lance le VRAI moteur Panoptic sur le
// site de chaque agence, on extrait les 3 constats les plus vendeurs (verifies, zero faux
// positif) et on genere un mail froid qui OUVRE sur ces constats reels + un lien vers le
// rapport public partageable. De la preuve, pas de la promesse.
//
// IMPORTANT : ce script ne fait que GENERER des brouillons sur disque. Il n'envoie AUCUN
// mail. L'envoi reste une action manuelle de l'utilisateur (cf. regles de securite).
//
// Usage :
//   node outbound/agences.mjs <domaine...>            # audite les domaines passes
//   node outbound/agences.mjs --file outbound/agences.txt
//   node outbound/agences.mjs --file liste.txt --lang en --share
//   node outbound/agences.mjs monagence.fr --from "Chakir <chakir@panopticaudit.com>"
//
// Options :
//   --file <path>   liste de domaines (un par ligne, # = commentaire)
//   --lang fr|en    langue du mail (defaut fr)
//   --from "<sig>"  bloc signature (defaut : placeholder a remplir)
//   --share         publie un rapport public /r/:id via l'API live et l'insere dans le mail
//   --out <dir>     dossier de sortie (defaut outbound/out)
//   --concurrency N audits simultanes (defaut 3, on reste poli avec les sites tiers)

import { runAudit } from "../engine/audit.mjs";
import { priorityScore, SEVERITY } from "../engine/schema.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHARE_ENDPOINT = "https://panopticaudit.com/api/share";

// ---- parsing des arguments -------------------------------------------------
function parseArgs(argv) {
  const o = { domains: [], file: null, lang: "fr", from: null, share: false, out: "outbound/out", concurrency: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") o.file = argv[++i];
    else if (a === "--lang") o.lang = argv[++i];
    else if (a === "--from") o.from = argv[++i];
    else if (a === "--share") o.share = true;
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--concurrency") o.concurrency = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a.startsWith("--")) throw new Error(`option inconnue: ${a}`);
    else o.domains.push(a);
  }
  return o;
}

// Nettoie une entree (domaine ou URL) en URL https canonique + libelle agence.
function normalize(raw) {
  let d = String(raw).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!d || !d.includes(".")) return null;
  const url = "https://" + d;
  const host = d.replace(/^www\./, "");
  // Libelle agence lisible : "mon-agence.fr" -> "Mon-agence".
  const label = host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { url, host, label };
}

function readList(file) {
  const path = file.startsWith("/") ? file : join(ROOT, file);
  if (!existsSync(path)) throw new Error(`fichier introuvable: ${path}`);
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
}

// ---- selection des 3 constats les plus vendeurs ----------------------------
// On garde les constats retenus (verdict != rejected), on classe par priorityScore
// (severite^2 x confiance / effort), avec un bonus si le constat porte un chiffre en euros
// ou est visible en production (plus parlant qu'un detail technique interne).
function topFindings(result, n = 3) {
  const kept = (result.findings || []).filter((f) => f.check?.verdict !== "rejected");
  const scored = kept.map((f) => {
    let s = priorityScore(f, 1);
    if (f.business?.risk_eur || f.business?.gain_eur) s += 30; // l'argent parle
    if (f.evidence?.type === "prod" || f.evidence?.type === "both") s += 5; // visible, pas theorique
    return { f, s };
  });
  scored.sort((a, b) => b.s - a.s);
  // On evite 3 constats du meme agent (un mail plus riche couvre plusieurs domaines).
  const out = [], seenAgents = {};
  for (const { f } of scored) {
    const cap = (seenAgents[f.agent] = (seenAgents[f.agent] || 0) + 1);
    if (cap <= 2) out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

const eur = (n) => new Intl.NumberFormat("fr-FR").format(Math.round(n));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Une ligne de constat, honnete : titre + traduction business + correctif.
// On evite de repeter l'impact quand il duplique le titre (certains agents mettent
// le meme texte dans title et business.impact) : sinon le mail affiche 2x la meme phrase.
function findingLine(f, i, lang) {
  const sev = SEVERITY[f.severity]?.label || f.severity;
  const title = String(f.title || "").trim();
  let impact = "";
  const rawImpact = String(f.business?.impact || "").trim();
  if (rawImpact) {
    const nt = norm(title), ni = norm(rawImpact);
    if (ni === nt) impact = "";                              // doublon exact : on jette
    else if (ni.startsWith(nt)) {                            // impact = titre + supplement : on garde le supplement
      const extra = rawImpact.slice(title.length).replace(/^[\s:;.,–-]+/, "").trim();
      impact = extra ? ` ${extra}` : "";
    } else impact = ` ${rawImpact}`;                          // impact reellement different : on garde
  }
  let money = "";
  if (f.business?.risk_eur) money = lang === "en" ? ` (~EUR ${eur(f.business.risk_eur)}/yr at risk)` : ` (~${eur(f.business.risk_eur)} EUR/an de risque)`;
  else if (f.business?.gain_eur) money = lang === "en" ? ` (~EUR ${eur(f.business.gain_eur)}/yr to gain)` : ` (~${eur(f.business.gain_eur)} EUR/an a gagner)`;
  const fix = f.fix?.summary ? (lang === "en" ? ` Fix: ${f.fix.summary}` : ` Correctif : ${f.fix.summary}`) : "";
  return `${i + 1}. [${sev}] ${f.title}${impact}${money}${fix ? "\n   " + fix.trim() : ""}`;
}

// ---- generation du mail ----------------------------------------------------
function emailFR({ label, host, score, findings, reportUrl, from }) {
  const lines = findings.map((f, i) => findingLine(f, i, "fr")).join("\n");
  const nice = findings.length >= 3 ? "3 constats qui ressortent" : findings.length === 0 ? "quelques points mineurs" : `${findings.length} constat(s) qui ressortent`;
  const body = [
    `Objet : ${label}, ce que Panoptic a trouve sur ${host} (score ${score}/100)`,
    ``,
    `Bonjour,`,
    ``,
    `J'ai passe ${host} dans Panoptic - l'audit de site tout-en-un (SEO, performance,`,
    `securite, accessibilite, RGPD, conversion), analyse a la fois le code et la production.`,
    `Score global : ${score}/100.`,
    ``,
    findings.length ? `${nice}, verifies (verification anti-faux-positif, on ne remonte pas de bruit) :` : `Le site est plutot propre : ${score}/100, ${nice}.`,
    findings.length ? `` : null,
    findings.length ? lines : null,
    ``,
    reportUrl ? `Rapport complet, partageable : ${reportUrl}` : null,
    reportUrl ? `` : null,
    `Pourquoi je vous ecris : pour une agence, l'interet n'est pas ce seul audit. C'est de`,
    `lancer le meme scan sur CHAQUE site client en 2 min - avant/apres chaque refonte ou`,
    `livraison - et de sortir un rapport chiffre (risque/gain en euros) avec la remediation`,
    `jusqu'a la Pull Request. Un seul outil a la place de six, en marque blanche si besoin.`,
    ``,
    `Si ca vous parle, je vous montre l'audit complet de ${host} + le mode multi-sites agence.`,
    `15 minutes cette semaine ?`,
    ``,
    from || `[Votre nom]\n[Votre email] - panopticaudit.com`,
  ].filter((l) => l !== null);
  return body.join("\n");
}

function emailEN({ label, host, score, findings, reportUrl, from }) {
  const lines = findings.map((f, i) => findingLine(f, i, "en")).join("\n");
  const nice = findings.length >= 3 ? "3 findings that stand out" : findings.length === 0 ? "a few minor points" : `${findings.length} finding(s) that stand out`;
  const body = [
    `Subject: ${label}, what Panoptic found on ${host} (score ${score}/100)`,
    ``,
    `Hi,`,
    ``,
    `I ran ${host} through Panoptic - the all-in-one site audit (SEO, performance,`,
    `security, accessibility, GDPR, conversion) that inspects both code and production.`,
    `Overall score: ${score}/100.`,
    ``,
    findings.length ? `${nice}, all verified (adversarial anti-false-positive pass, no noise):` : `The site is fairly clean: ${score}/100, ${nice}.`,
    findings.length ? `` : null,
    findings.length ? lines : null,
    ``,
    reportUrl ? `Full shareable report: ${reportUrl}` : null,
    reportUrl ? `` : null,
    `Why I'm reaching out: for an agency the point isn't this one audit. It's running the`,
    `same scan on EVERY client site in 2 minutes - before/after each redesign or handoff -`,
    `and shipping a costed report (risk/gain in euros) with remediation all the way to the`,
    `Pull Request. One tool instead of six, white-label if needed.`,
    ``,
    `If that resonates, I'll walk you through the full ${host} audit + the multi-site agency mode.`,
    `15 minutes this week?`,
    ``,
    from || `[Your name]\n[Your email] - panopticaudit.com`,
  ].filter((l) => l !== null);
  return body.join("\n");
}

// Publie un rapport public et renvoie l'URL /r/:id (best effort, jamais bloquant).
async function publishReport(result) {
  try {
    const res = await fetch(SHARE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.url || (j.id ? `https://panopticaudit.com/r/${j.id}` : null);
  } catch { return null; }
}

async function auditOne(entry, opts) {
  const { url, host, label } = entry;
  try {
    const result = await runAudit(url, { maxPages: 1 });
    const score = result.summary?.weightedScore ?? result.score ?? 0;
    const findings = topFindings(result, 3);
    let reportUrl = null;
    if (opts.share) reportUrl = await publishReport(result);
    const email = (opts.lang === "en" ? emailEN : emailFR)({ label, host, score, findings, reportUrl, from: opts.from });
    return { host, label, score, findings, reportUrl, email, ok: true };
  } catch (e) {
    return { host, label, ok: false, error: e.message };
  }
}

// mapLimit local (poli avec les sites tiers).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let raw = [...opts.domains];
  if (opts.file) raw = raw.concat(readList(opts.file));
  const entries = raw.map(normalize).filter(Boolean);
  // dedup par host
  const seen = new Set();
  const targets = entries.filter((e) => (seen.has(e.host) ? false : seen.add(e.host)));

  if (!targets.length) {
    console.error("Aucun domaine. Usage: node outbound/agences.mjs <domaine...> ou --file <liste>");
    process.exit(2);
  }

  const outDir = opts.out.startsWith("/") ? opts.out : join(ROOT, opts.out);
  mkdirSync(outDir, { recursive: true });
  console.error(`Audit de ${targets.length} agence(s), lang=${opts.lang}, share=${opts.share}, concurrence=${opts.concurrency}...\n`);

  const results = await mapLimit(targets, opts.concurrency, async (e) => {
    const r = await auditOne(e, opts);
    if (r.ok) console.error(`  OK   ${r.host.padEnd(32)} score ${r.score}/100  (${r.findings.length} constats)`);
    else console.error(`  FAIL ${e.host.padEnd(32)} ${r.error}`);
    return r;
  });

  // Fichiers par agence + index CSV.
  const rows = [["host", "score", "n_findings", "top_finding", "report_url", "email_file"]];
  for (const r of results) {
    if (!r.ok) { rows.push([r.host, "ERR", "0", r.error, "", ""]); continue; }
    const file = join(outDir, `${r.host.replace(/[^a-z0-9.-]/gi, "_")}.txt`);
    writeFileSync(file, r.email + "\n");
    rows.push([r.host, String(r.score), String(r.findings.length), r.findings[0]?.title || "-", r.reportUrl || "", file]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  writeFileSync(join(outDir, "_index.csv"), csv + "\n");

  const ok = results.filter((r) => r.ok).length;
  console.error(`\n${ok}/${targets.length} audits reussis. Brouillons dans ${outDir}/ (index: _index.csv).`);
  console.error(`Rappel: rien n'a ete envoye. Relis chaque brouillon avant tout envoi manuel.`);
}

main().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
