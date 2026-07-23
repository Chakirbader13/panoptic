// Panoptic - CLI d'envoi des notifications depuis un fichier de resultat d'audit.
//   SLACK_WEBHOOK=https://hooks.slack.com/... node server/notify-cli.mjs audit.json
//   JIRA_BASE=https://x.atlassian.net JIRA_EMAIL=.. JIRA_TOKEN=.. JIRA_PROJECT=PAN node server/notify-cli.mjs audit.json
import { readFileSync } from "node:fs";
import { sendSlack, createJiraIssues } from "./notify.js";

const file = process.argv[2];
if (!file) { console.error("usage: node server/notify-cli.mjs <audit.json>"); process.exit(1); }
const audit = JSON.parse(readFileSync(file, "utf8"));

const tasks = [];
if (process.env.SLACK_WEBHOOK) {
  tasks.push(sendSlack(process.env.SLACK_WEBHOOK, audit).then((r) => console.log("Slack:", r)).catch((e) => console.error("Slack ERR:", e.message)));
}
if (process.env.JIRA_BASE) {
  const cfg = { baseUrl: process.env.JIRA_BASE, email: process.env.JIRA_EMAIL, apiToken: process.env.JIRA_TOKEN, projectKey: process.env.JIRA_PROJECT, withPriority: process.env.JIRA_PRIORITY === "on" };
  tasks.push(createJiraIssues(cfg, audit, { minSeverity: process.env.JIRA_MIN_SEVERITY || "high" }).then((r) => console.log("Jira:", JSON.stringify(r, null, 2))).catch((e) => console.error("Jira ERR:", e.message)));
}
if (!tasks.length) { console.error("Rien a faire: definir SLACK_WEBHOOK et/ou JIRA_BASE+JIRA_EMAIL+JIRA_TOKEN+JIRA_PROJECT"); process.exit(1); }
await Promise.all(tasks);
