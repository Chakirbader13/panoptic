// Panoptic - ouverture de pull request depuis un audit. GitHub REST via fetch, zero dependance.
// Sur: n'AJOUTE que des fichiers (rapport + remediations add-only), ne modifie/supprime rien.
// L'appel reel exige un token; sans token -> dry-run (retourne le plan sans rien pousser).
import { buildFixBundle } from "./fixbundle.js";

const API = "https://api.github.com";

function gh(token) {
  return async (method, path, body) => {
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "PanopticAudit/1.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
    return { ok: res.ok, status: res.status, json };
  };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

// Fichiers de remediation add-only generes a partir des findings (sous-ensemble sur).
function remediationFiles(audit) {
  const files = {};
  const rules = new Set((audit.findings || []).map((f) => f.rule));
  if (rules.has("no-robots")) {
    files["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${audit.target.replace(/\/$/, "")}/sitemap.xml\n`;
  }
  return files;
}

// Construit le plan de PR (branche, fichiers, titre, corps). Pur, sans reseau.
export function buildPrPlan(audit) {
  const bundle = buildFixBundle(audit);
  const branch = `panoptic/audit-${slug(audit.id || audit.target)}`;
  const files = { "PANOPTIC_AUDIT.md": bundle.body, ...remediationFiles(audit) };
  return { branch, title: bundle.title, body: bundle.body, files, stats: bundle.stats };
}

/**
 * Ouvre (ou simule) une PR. Action a effet de bord: n'est jamais appelee automatiquement.
 * @param {{token?:string, owner:string, repo:string, audit:object, dryRun?:boolean}} o
 */
export async function openAuditPR({ token, owner, repo, audit, dryRun }) {
  const plan = buildPrPlan(audit);
  if (dryRun || !token) {
    return { dryRun: true, ...plan, note: token ? "dry-run demande" : "aucun token: plan seulement (definir GITHUB_TOKEN pour ouvrir la PR)" };
  }
  if (!owner || !repo) throw new Error("owner et repo requis");

  const api = gh(token);
  const repoInfo = await api("GET", `/repos/${owner}/${repo}`);
  if (!repoInfo.ok) throw new Error(`repo introuvable ou token invalide (${repoInfo.status})`);
  const base = repoInfo.json.default_branch;

  const ref = await api("GET", `/repos/${owner}/${repo}/git/ref/heads/${base}`);
  if (!ref.ok) throw new Error(`branche de base introuvable (${ref.status})`);
  const baseSha = ref.json.object.sha;

  // Cree la branche (ignore l'erreur si elle existe deja).
  await api("POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${plan.branch}`, sha: baseSha });

  // Ajoute chaque fichier (add-only: si le fichier existe deja, on saute pour ne rien ecraser).
  const written = [];
  for (const [path, content] of Object.entries(plan.files)) {
    const exists = await api("GET", `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${plan.branch}`);
    if (exists.ok) continue; // ne jamais ecraser un fichier existant
    const put = await api("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      message: `Panoptic: ${path}`, content: b64(content), branch: plan.branch,
    });
    if (put.ok) written.push(path);
  }

  const pr = await api("POST", `/repos/${owner}/${repo}/pulls`, { title: plan.title, head: plan.branch, base, body: plan.body });
  if (!pr.ok) throw new Error(`creation PR echouee (${pr.status}): ${pr.json?.message || ""}`);

  return { dryRun: false, url: pr.json.html_url, number: pr.json.number, branch: plan.branch, filesWritten: written, base };
}
