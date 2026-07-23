// Panoptic - integrations Slack + Jira depuis un resultat d'audit. Zero dependance (fetch).
// Deux surfaces:
//   - Slack  : Incoming Webhook (aucune OAuth), message Block Kit = synthese + top findings.
//   - Jira   : REST API v3 (Basic auth email:token), 1 ticket par finding critique/eleve (borne).
// Builders PURS (buildSlackMessage / buildJiraIssue) testables sans reseau; senders separes.

const eur = (n) => Math.round(n || 0).toLocaleString("fr-FR");
const SEV_EMOJI = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const bySeverity = (arr) => [...arr].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
const loc = (f) => (f.location?.file ? `${f.location.file}:${f.location.line}` : (f.location?.url || ""));
const cleanHost = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------- SLACK ----------

// Construit le payload Block Kit (objet pur). Ne fait aucune requete.
export function buildSlackMessage(audit, { siteUrl = "https://panopticaudit.com" } = {}) {
  const s = audit.summary || {};
  const score = s.weightedScore ?? audit.score ?? 0;
  const emoji = score >= 80 ? "✅" : score >= 50 ? "⚠️" : "🚨";
  const sev = s.bySeverity || {};
  const sevLine = ["critical", "high", "medium", "low", "info"]
    .filter((k) => sev[k]).map((k) => `${SEV_EMOJI[k]} ${sev[k]} ${k}`).join("   ") || "0 finding";
  const risk = (s.riskLow || s.riskHigh) ? `${eur(s.riskLow)} - ${eur(s.riskHigh)} €${s.calibrated ? "" : " (est.)"}` : "n/a";

  const top = bySeverity(audit.findings || []).slice(0, 5).map((f) => {
    const l = loc(f);
    return `${SEV_EMOJI[f.severity] || "•"} *${f.title}*${l ? `  \`${l}\`` : ""}`;
  });

  const host = cleanHost(audit.target);
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `${emoji} Audit Panoptic — ${host}`, emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Score*\n${score}/100` },
      { type: "mrkdwn", text: `*Findings*\n${(audit.findings || []).length}` },
      { type: "mrkdwn", text: `*Effort*\n${s.effortDays ?? "?"} j-h` },
      { type: "mrkdwn", text: `*Risque estimé*\n${risk}` },
    ] },
    { type: "context", elements: [{ type: "mrkdwn", text: sevLine }] },
  ];
  if (top.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Priorités*\n${top.join("\n")}` } });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${siteUrl}|Panoptic> · code + production · correctifs dans l'Audit complet` }] });

  return { text: `Audit Panoptic ${host} : ${score}/100, ${(audit.findings || []).length} findings`, blocks };
}

// Envoie le message vers un Incoming Webhook Slack. Retourne {ok, status}.
export async function sendSlack(webhookUrl, audit, opts = {}) {
  if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
    throw new Error("URL de webhook Slack invalide (attendu https://hooks.slack.com/...)");
  }
  const payload = buildSlackMessage(audit, opts);
  const res = await fetch(webhookUrl, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Slack a repondu ${res.status}: ${body.slice(0, 200)}`);
  return { ok: true, status: res.status, findings: (audit.findings || []).length };
}

// ---------- JIRA ----------

// Description Atlassian Document Format (ADF) minimale a partir d'un finding.
function jiraADF(f, siteUrl) {
  const l = loc(f);
  const rows = [
    ["Gravité", f.severity + (f.cwe ? ` · ${f.cwe}` : "")],
    l ? ["Localisation", l] : null,
    f.evidence?.proof ? ["Preuve", String(f.evidence.proof).slice(0, 500)] : null,
    ["Impact estimé", f.business ? `${eur(f.business.low)} - ${eur(f.business.high)} € (est.)` : "n/a"],
    ["Effort", `${f.effort ?? "?"} j-h`],
    ["Correctif", "Détail dans l'Audit complet Panoptic, ou appliqué par notre équipe."],
  ].filter(Boolean);
  const content = rows.map(([k, v]) => ({
    type: "paragraph",
    content: [{ type: "text", text: `${k}: `, marks: [{ type: "strong" }] }, { type: "text", text: String(v) }],
  }));
  content.push({
    type: "paragraph",
    content: [{ type: "text", text: "Généré par Panoptic", marks: [{ type: "link", attrs: { href: siteUrl } }] }],
  });
  return { type: "doc", version: 1, content };
}

// Construit les champs d'un ticket Jira (objet pur). issuetype/priority mappes.
export function buildJiraIssue(f, { projectKey, siteUrl = "https://panopticaudit.com" }) {
  const PRIO = { critical: "Highest", high: "High", medium: "Medium", low: "Low", info: "Lowest" };
  const host = cleanHost(f.location?.url || "");
  return {
    fields: {
      project: { key: projectKey },
      summary: `[Panoptic] ${f.title}`.slice(0, 250),
      description: jiraADF(f, siteUrl),
      issuetype: { name: "Task" },
      labels: ["panoptic", `panoptic-${f.agent || "audit"}`, `sev-${f.severity}`].filter(Boolean),
      ...(host ? {} : {}),
      _priorityName: PRIO[f.severity] || "Medium", // pose dans priority si le projet l'autorise (voir sender)
    },
  };
}

/**
 * Cree des tickets Jira pour les findings critiques + eleves (borne, anti-flood).
 * @param {{baseUrl:string, email:string, apiToken:string, projectKey:string, withPriority?:boolean}} cfg
 * @param {object} audit
 * @param {{max?:number, minSeverity?:string, siteUrl?:string}} opts
 */
export async function createJiraIssues(cfg, audit, opts = {}) {
  const { baseUrl, email, apiToken, projectKey } = cfg;
  if (!baseUrl || !email || !apiToken || !projectKey) {
    throw new Error("Config Jira incomplete (baseUrl, email, apiToken, projectKey requis)");
  }
  const host = baseUrl.replace(/\/$/, "");
  const auth = "Basic " + Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64");
  const max = opts.max ?? 15;
  const floor = SEV_RANK[opts.minSeverity ?? "high"];
  const targets = bySeverity((audit.findings || []).filter((f) => (SEV_RANK[f.severity] ?? 9) <= floor)).slice(0, max);

  const created = [];
  const errors = [];
  for (const f of targets) {
    const issue = buildJiraIssue(f, { projectKey, siteUrl: opts.siteUrl });
    const prio = issue.fields._priorityName; delete issue.fields._priorityName;
    if (cfg.withPriority) issue.fields.priority = { name: prio };
    const res = await fetch(`${host}/rest/api/3/issue`, {
      method: "POST",
      headers: { authorization: auth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(issue),
    });
    const body = await res.text();
    if (res.ok) {
      let j; try { j = JSON.parse(body); } catch { j = {}; }
      created.push({ key: j.key, title: f.title, url: j.key ? `${host}/browse/${j.key}` : null });
    } else {
      errors.push({ title: f.title, status: res.status, error: body.slice(0, 200) });
    }
  }
  return { created, errors, considered: targets.length, skippedBelowSeverity: (audit.findings || []).length - targets.length };
}
