// Panoptic - Agent Performance / Core Web Vitals (signaux mesurables sans navigateur).
import { makeFinding, httpGet, elements, attr } from "../shared.js";

export async function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const H = scope.home.headers;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("perf", "technique", { ...r, url }));

  // Poids du document HTML
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > 150_000) F({ rule: "heavy-html", severity: "medium", effort: 0.4, gain_eur: 2000, title: `Document HTML lourd (${Math.round(bytes / 1024)} Ko)`, fix: "Reduire le HTML: pagination, lazy content, moins de markup inline.", proof: `${bytes} octets.`, impact: "LCP degrade" });

  // Compression
  const enc = H["content-encoding"] || "";
  if (!/gzip|br|zstd/i.test(enc)) F({ rule: "no-compression", severity: "medium", effort: 0.1, gain_eur: 1500, title: "Reponse non compressee (ni gzip ni brotli)", fix: "Activer Brotli/gzip au niveau serveur ou CDN.", proof: `content-encoding: ${enc || "(absent)"}` });

  // Cache
  const cc = H["cache-control"] || "";
  if (!cc || /no-store|no-cache/i.test(cc)) F({ rule: "weak-cache", severity: "low", effort: 0.2, gain_eur: 800, title: "Pas de cache HTTP efficace sur le document", fix: "Definir Cache-Control adapte (assets immutables, HTML court).", proof: `cache-control: ${cc || "(absent)"}` });

  // Scripts bloquants (approx: <script src> sans defer/async dans le head)
  const headHtml = (html.split(/<\/head>/i)[0] || html);
  const blocking = elements(headHtml, "script").filter((s) => /src=/i.test(s) && !/defer|async|type=["']module["']/i.test(s));
  if (blocking.length > 0) F({ rule: "render-blocking-js", severity: "medium", effort: 0.3, gain_eur: 1800, title: `${blocking.length} script(s) bloquant(s) dans le <head>`, fix: "Ajouter defer/async ou deplacer en fin de body.", proof: `${blocking.length} script(s) sans defer/async.`, impact: "INP/LCP" });

  // Feuilles CSS bloquantes
  const cssBlock = elements(headHtml, "link").filter((l) => /rel=["']stylesheet["']/i.test(l)).length;
  if (cssBlock > 4) F({ rule: "many-css", severity: "low", effort: 0.3, gain_eur: 600, title: `${cssBlock} feuilles CSS externes bloquent le rendu`, fix: "Regrouper le CSS critique inline, differer le reste.", proof: `${cssBlock} <link stylesheet>.` });

  // Images sans dimensions (CLS)
  const imgs = elements(html, "img");
  const noDim = imgs.filter((i) => attr(i, "width") === null || attr(i, "height") === null).length;
  if (noDim > 0) F({ rule: "img-no-dims", severity: "low", effort: 0.3, gain_eur: 700, title: `${noDim}/${imgs.length} images sans dimensions (CLS)`, fix: "Definir width/height ou aspect-ratio pour reserver l'espace.", proof: `${noDim} img sans dimensions.`, impact: "CLS" });

  // Lazy loading absent sur images multiples
  const lazy = imgs.filter((i) => /loading=["']lazy["']/i.test(i)).length;
  if (imgs.length > 5 && lazy === 0) F({ rule: "no-lazy", severity: "low", effort: 0.2, gain_eur: 500, title: "Aucune image en lazy loading", fix: "Ajouter loading='lazy' aux images sous la ligne de flottaison.", proof: `${imgs.length} images, 0 lazy.` });

  // TTFB mesure (2e requete, chronometree)
  const t0 = performance.now();
  const probe = await httpGet(url, { timeout: 8000 });
  const ttfb = Math.round(performance.now() - t0);
  if (!probe.error && ttfb > 800) F({ rule: "high-ttfb", severity: "medium", effort: 0.5, gain_eur: 1500, title: `TTFB eleve (~${ttfb} ms)`, fix: "Ajouter un CDN, du cache serveur, reduire le temps de generation.", proof: `Temps de reponse ~${ttfb} ms.`, impact: "LCP" });

  return { findings, stats: { htmlKo: Math.round(bytes / 1024), imgs: imgs.length, ttfb } };
}
