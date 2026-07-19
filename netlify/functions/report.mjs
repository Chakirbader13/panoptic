// Panoptic - fonction Netlify: rend le rapport HTML editorial a partir d'un resultat.
// Stateless: le client (console) renvoie le resultat d'audit, on renvoie le HTML complet
// (imprimable en PDF). Reutilise le meme generateur que le serveur Node.
import { renderReport } from "../../server/report.js";

export default async (req) => {
  if (req.method !== "POST") return new Response("POST requis", { status: 405 });
  let result;
  try { result = (await req.json()).result; } catch { return new Response("JSON invalide", { status: 400 }); }
  if (!result || !result.findings) return new Response("resultat d'audit requis", { status: 400 });
  const html = renderReport(result);
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
};

export const config = { path: "/api/report" };
