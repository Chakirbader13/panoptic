// Panoptic - fonction Netlify: PARTAGE d'un rapport de scan.
// Boucle de croissance: le client poste son resultat d'audit, on le stocke (Netlify
// Blobs) sous un id court et on renvoie une URL publique + le code du badge embarquable.
// Chaque scan gratuit devient un point de contact (partage social, backlink via badge).
import { getStore } from "@netlify/blobs";
import { rateLimit } from "./_guard.mjs";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function shortId() {
  let s = "";
  const b = new Uint8Array(9); crypto.getRandomValues(b);
  for (const x of b) s += ALPHABET[x % 36];
  return s;
}

// On ne stocke QUE l'essentiel a l'affichage (rapport diagnostic + score), jamais les
// correctifs (offre payante). Borne la taille des blobs et respecte le gating.
function slim(result) {
  const strip = ({ fix, ...rest }) => rest;   // pas de correctifs dans le partage
  return {
    target: result.target,
    score: result.score,
    summary: result.summary,
    agents: result.agents,
    findings: (result.findings || []).map(strip),
    generatedAt: result.generatedAt || new Date().toISOString(),
    tier: "free",
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  // Anti-abus: meme quota que les scans (evite le remplissage de blobs).
  const rl = await rateLimit(req);
  if (!rl.ok) return json({ error: "Trop de partages, reessayez plus tard." }, 429, { "retry-after": String(rl.retryAfter) });

  let result;
  try { result = (await req.json()).result; } catch { return json({ error: "JSON invalide" }, 400); }
  if (!result || !result.findings || !result.target) return json({ error: "resultat d'audit requis" }, 400);

  const id = shortId();
  try {
    const store = getStore({ name: "panoptic-reports", consistency: "strong" });
    await store.setJSON(id, slim(result));
  } catch (e) {
    return json({ error: "stockage indisponible: " + e.message }, 502);
  }

  const base = "https://panopticaudit.com";
  return json({
    id,
    url: `${base}/r/${id}`,
    badgeUrl: `${base}/badge/${id}.svg`,
    badgeEmbed: `<a href="${base}/r/${id}"><img src="${base}/badge/${id}.svg" alt="Audit Panoptic" height="28"></a>`,
  }, 201);
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra } });
}

export const config = { path: "/api/share" };
