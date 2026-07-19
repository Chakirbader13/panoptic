// Panoptic - fonction Netlify: ouvrir une PR depuis un resultat d'audit.
// Stateless: le client renvoie le resultat d'audit + owner/repo. Le token vient de
// l'env GITHUB_TOKEN (a definir dans les variables Netlify). Sans token -> plan (dry-run).
import { openAuditPR } from "../../server/github.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }
  const { result, owner, repo, dryRun } = body || {};
  if (!result || !result.findings) return json({ error: "resultat d'audit requis" }, 400);
  try {
    const r = await openAuditPR({ token: process.env.GITHUB_TOKEN, owner, repo, audit: result, dryRun });
    return json(r);
  } catch (e) { return json({ error: e.message }, 400); }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export const config = { path: "/api/pr" };
