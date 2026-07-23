import { buildSlackMessage, buildJiraIssue, createJiraIssues, sendSlack } from "/Users/chakirbader/chakirbader/panoptic-audit/server/notify.js";

const audit = {
  target: "https://lebonprompt.com/", score: 74,
  summary: { weightedScore: 74, effortDays: 2.1, bySeverity: { critical: 1, high: 0, medium: 2, low: 4 }, riskLow: 1400, riskHigh: 7000, calibrated: false },
  findings: [
    { severity: "critical", title: "Cle API Stripe exposee", agent: "security", cwe: "CWE-798", location: { file: "src/lib/pay.ts", line: 12 }, evidence: { proof: "sk_live_... dans main.js" }, effort: 0.5, business: { low: 18400, high: 18400 } },
    { severity: "medium", title: "Canonical absente", agent: "seo", location: { url: "https://lebonprompt.com/prompts" }, effort: 0.2, business: { low: 500, high: 2500 } },
    { severity: "low", title: "Pas de CAA", agent: "infra", location: { url: "https://lebonprompt.com" }, effort: 0.2, business: { low: 100, high: 500 } },
  ],
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error("FAIL:", m); } };

// --- Slack ---
const slack = buildSlackMessage(audit);
ok(slack.blocks[0].type === "header", "header block");
ok(slack.blocks[0].text.text.includes("lebonprompt.com"), "host in header");
ok(slack.blocks[0].text.text.includes("⚠️"), "warn emoji for 74");
ok(JSON.stringify(slack).includes("74/100"), "score shown");
ok(JSON.stringify(slack).includes(`${(1400).toLocaleString("fr-FR")} - ${(7000).toLocaleString("fr-FR")}`), "risk range fr-formatted");
ok(slack.blocks.some((b) => b.type === "section" && /Priorités/.test(JSON.stringify(b))), "priorities section");
ok(JSON.stringify(slack).includes("src/lib/pay.ts:12"), "file:line in priorities");
ok(JSON.stringify(slack).indexOf("🔴") < JSON.stringify(slack).indexOf("🟡"), "critical listed before medium");
ok(slack.text.startsWith("Audit Panoptic"), "fallback text");

// --- Jira ADF ---
const issue = buildJiraIssue(audit.findings[0], { projectKey: "PAN" });
ok(issue.fields.project.key === "PAN", "jira project key");
ok(issue.fields.summary === "[Panoptic] Cle API Stripe exposee", "jira summary prefixed");
ok(issue.fields.issuetype.name === "Task", "jira issuetype");
ok(issue.fields.labels.includes("sev-critical") && issue.fields.labels.includes("panoptic-security"), "jira labels");
ok(issue.fields.description.type === "doc" && issue.fields.description.version === 1, "ADF doc root");
ok(JSON.stringify(issue.fields.description).includes("CWE-798"), "ADF has cwe");
ok(JSON.stringify(issue.fields.description).includes("src/lib/pay.ts:12"), "ADF has location");
ok(issue.fields._priorityName === "Highest", "priority mapped");

// --- guards ---
let threw = false;
try { await sendSlack("http://evil.example/x", audit); } catch { threw = true; }
ok(threw, "sendSlack rejects non-slack url");
threw = false;
try { await createJiraIssues({ baseUrl: "https://x.atlassian.net" }, audit); } catch { threw = true; }
ok(threw, "createJiraIssues rejects incomplete config");

// --- bounding: only critical+high considered by default (minSeverity high) ---
const targets = audit.findings.filter((f) => ["critical", "high"].includes(f.severity));
ok(targets.length === 1, "only 1 critical/high in fixture (bounding sanity)");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
