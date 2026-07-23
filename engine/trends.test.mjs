// Test chantier 3: moteur de tendances + diff de findings (pur, sans I/O).
import { computeTrend, diffFindings } from "./trends.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// --- computeTrend ---
const history = [
  { id: "a3", score: 82, created_at: "2026-07-23T12:00:00Z", summary: { weightedScore: 82, bySeverity: { medium: 1 }, byDomain: [{ id: "seo", label: "SEO", score: 90 }, { id: "security", label: "Securite", score: 70 }] } },
  { id: "a2", score: 88, created_at: "2026-07-22T12:00:00Z", summary: { weightedScore: 88, bySeverity: {}, byDomain: [{ id: "seo", label: "SEO", score: 90 }, { id: "security", label: "Securite", score: 86 }] } },
  { id: "a1", score: 80, created_at: "2026-07-21T12:00:00Z", summary: { weightedScore: 80, bySeverity: {}, byDomain: [] } },
]; // recent -> ancien (comme store.history)

const t = computeTrend(history);
ok(t.count === 3, "3 audits dans la serie");
ok(t.series[0].at < t.series[2].at, "serie triee ancien->recent");
ok(t.series[t.series.length - 1].score === 82, "dernier point = score le plus recent");
ok(t.scoreDelta === 82 - 88, "scoreDelta = latest - previous (-6)");
ok(t.verdict === "regression", "verdict regression (chute de 6): " + t.verdict);
ok(t.latestId === "a3" && t.previousId === "a2", "latest/previous ids");
const secDelta = t.domainDeltas.find((d) => d.id === "security");
ok(secDelta && secDelta.delta === -16 && secDelta.from === 86 && secDelta.to === 70, "delta securite -16 (86->70)");
ok(t.domainDeltas[0].delta < 0, "regressions en tete des domainDeltas");
ok(!t.domainDeltas.find((d) => d.id === "seo"), "domaine stable (90->90) non liste");

// baseline: un seul audit
ok(computeTrend([history[0]]).verdict === "baseline", "1 audit = baseline");
ok(computeTrend([]).verdict === "baseline", "0 audit = baseline");

// amelioration
const up = computeTrend([
  { id: "b2", created_at: "2026-07-23T00:00:00Z", summary: { weightedScore: 90, byDomain: [] } },
  { id: "b1", created_at: "2026-07-22T00:00:00Z", summary: { weightedScore: 70, byDomain: [] } },
]);
ok(up.verdict === "amelioration" && up.scoreDelta === 20, "amelioration +20");

// --- diffFindings ---
const prev = [
  { agent: "seo", rule: "missing-title", location: { url: "https://x.fr/a" }, severity: "high" },
  { agent: "security", rule: "csp-weak", location: { url: "https://x.fr/" }, severity: "medium" },
];
const curr = [
  { agent: "security", rule: "csp-weak", location: { url: "https://x.fr/" }, severity: "medium" }, // persiste
  { agent: "security", rule: "secret-exposed", location: { file: "pay.ts", line: 3 }, severity: "critical" }, // APPARU
  { agent: "a11y", rule: "img-no-alt", location: { url: "https://x.fr/" }, severity: "low" }, // apparu mais low
];
const d = diffFindings(prev, curr);
ok(d.counts.added === 2, "2 findings apparus");
ok(d.counts.resolved === 1, "1 finding resolu (missing-title)");
ok(d.counts.persisting === 1, "1 finding persistant (csp-weak)");
ok(d.counts.regressions === 1, "1 regression (critical), le low exclu");
ok(d.regressions[0].rule === "secret-exposed", "regression = le secret critique");
ok(d.resolved[0].rule === "missing-title", "resolu = missing-title");

// stabilite: aucun changement
const same = diffFindings(prev, prev);
ok(same.counts.added === 0 && same.counts.resolved === 0 && same.counts.regressions === 0, "audit identique = 0 changement");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
