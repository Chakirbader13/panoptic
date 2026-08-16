// Panoptic - fonction Netlify: rapport PUBLIC partageable a /r/:id.
// Lit le blob sauvegarde par /api/share, rend le rapport diagnostic (correctifs
// verrouilles) + balises Open Graph (apercu social riche) + bandeau viral (badge a
// embarquer, CTA scanner son site). Chaque partage ramene du trafic.
import { getStore } from "@netlify/blobs";
import { renderReport } from "../../server/report.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default async (req) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!id || !/^[a-z0-9]{4,16}$/.test(id)) return new Response("rapport introuvable", { status: 404 });

  let rec;
  try {
    const store = getStore({ name: "panoptic-reports", consistency: "strong" });
    rec = await store.get(id, { type: "json" });
  } catch { rec = null; }
  if (!rec || !rec.findings) return new Response("rapport introuvable ou expire", { status: 404 });

  const host = String(rec.target || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const score = rec.summary?.weightedScore ?? rec.score ?? 0;
  const n = (rec.findings || []).length;
  const base = "https://panopticaudit.com";

  // Rapport diagnostic (offre gratuite: correctifs verrouilles).
  let html = renderReport(rec, { tier: "free" });

  // Injection Open Graph + bandeau viral dans le <head> et apres le <body>.
  const og = `
<link rel="canonical" href="${base}/r/${esc(id)}">
<meta property="og:type" content="website">
<meta property="og:title" content="Audit Panoptic de ${esc(host)} - ${score}/100">
<meta property="og:description" content="${n} constats verifies sur 15 domaines (securite, SEO, performance, accessibilite, RGPD, conversion). Scannez votre site gratuitement.">
<meta property="og:image" content="${base}/benchmark/og.png">
<meta property="og:url" content="${base}/r/${esc(id)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<\/head>/i, og + "\n</head>");

  const banner = `
<div style="position:fixed;left:0;right:0;bottom:0;background:#070a08;border-top:1px solid #1e6b47;color:#f2f5f2;font:14px/1.5 -apple-system,system-ui,sans-serif;padding:12px 20px;display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;z-index:99" class="viral">
  <span style="color:#a4aea7">Rapport genere par <b style="color:#4ff0a3">Panoptic</b> - l'audit de site complet, code + production.</span>
  <a href="${base}/console/?url=${encodeURIComponent(rec.target)}" style="background:#4ff0a3;color:#04140c;font-weight:600;text-decoration:none;padding:9px 18px;border-radius:100px">Scanner mon site</a>
</div>
<style>@media print{.viral{display:none}} body{padding-bottom:64px}</style>`;
  html = html.replace(/<\/body>/i, banner + "\n</body>");

  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
};

export const config = { path: "/r/:id" };
