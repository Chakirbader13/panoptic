// Panoptic - fonction Netlify: pousse un resultat d'audit vers Slack et/ou Jira.
// Stateless: le client renvoie {result, slack?, jira?}. Les integrations font partie
// de l'offre continue -> gatees. PANOPTIC_NOTIFY=on (ou creds serveur) pour activer.
import { sendSlack, createJiraIssues } from "../../server/notify.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);

  // Offre gratuite = diagnostic. Alertes Slack / tickets Jira = offre continue (190 EUR/mois).
  if (process.env.PANOPTIC_NOTIFY !== "on") {
    return json({ error: "Les alertes Slack et tickets Jira font partie de l'offre continue. Voir https://panopticaudit.com/#prix" }, 402);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }
  const { result, slack, jira } = body || {};
  if (!result || !result.findings) return json({ error: "resultat d'audit requis" }, 400);

  const out = {};
  try {
    if (slack?.webhookUrl) out.slack = await sendSlack(slack.webhookUrl, result);
    if (jira?.baseUrl) out.jira = await createJiraIssues(jira, result, { minSeverity: jira.minSeverity, max: jira.max });
    if (!out.slack && !out.jira) return json({ error: "aucune integration fournie (slack.webhookUrl ou jira.baseUrl)" }, 400);
    return json({ ok: true, ...out });
  } catch (e) { return json({ error: e.message, ...out }, 502); }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export const config = { path: "/api/notify" };
