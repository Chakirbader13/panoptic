// Panoptic - fonction Netlify: badge SVG embarquable a /badge/:id.svg.
// "Panoptic <score>/100" avec couleur par score. Les proprietaires de site l'affichent
// (comme un badge de build): backlink vers le rapport public + preuve sociale.
import { getStore } from "@netlify/blobs";

const color = (n) => (n >= 80 ? "#2fa968" : n >= 50 ? "#c99a2e" : "#d9534f");

// Largeur approximative d'un texte en px (police systeme ~6.2px/char a 11px).
const w = (s) => Math.ceil(String(s).length * 6.2) + 12;

function svg(score) {
  const label = "Panoptic";
  const value = `${score}/100`;
  const lw = w(label), vw = w(value), total = lw + vw, h = 28;
  const fill = color(score);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${label}: ${value}">
  <linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-opacity=".1"/><stop offset="1" stop-opacity=".2"/></linearGradient>
  <rect rx="5" width="${total}" height="${h}" fill="#0c0f0d"/>
  <rect rx="5" x="${lw}" width="${vw}" height="${h}" fill="${fill}"/>
  <rect rx="5" width="${total}" height="${h}" fill="url(#g)"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="12">
    <circle cx="14" cy="14" r="5" fill="none" stroke="#4ff0a3" stroke-width="1.6"/><circle cx="14" cy="14" r="1.8" fill="#4ff0a3"/>
    <text x="${lw / 2 + 8}" y="18" fill="#e6ece7">${label}</text>
    <text x="${lw + vw / 2}" y="18" fill="#04140c" font-weight="bold">${value}</text>
  </g>
</svg>`;
}

export default async (req) => {
  const raw = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  const id = raw.replace(/\.svg$/i, "");
  const svgHeaders = { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=1800" };
  if (!/^[a-z0-9]{4,16}$/.test(id)) return new Response(svg(0), { status: 200, headers: svgHeaders });

  let rec;
  try {
    const store = getStore({ name: "panoptic-reports", consistency: "strong" });
    rec = await store.get(id, { type: "json" });
  } catch { rec = null; }
  const score = rec ? (rec.summary?.weightedScore ?? rec.score ?? 0) : 0;
  return new Response(svg(score), { status: 200, headers: svgHeaders });
};

export const config = { path: "/badge/:id" };
