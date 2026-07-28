// Panoptic SEO KING - lane positions reelles (Search Console, conditionnelle).
//
// Ce que cette lane change: sans elle, l'audit sait qu'un title est tronque mais pas
// si la page a du trafic. Avec elle, il sait que CETTE page recoit 12 000 impressions
// pour 0,8% de clics ET que son title est coupe a 640 pixels. Le premier est un
// constat, le second est un arbitrage.
//
// C'est aussi la seule source qui permet de DEPRIORISER honnetement: une page sans
// aucune impression n'a pas besoin d'etre optimisee, elle a besoin d'exister aux yeux
// du moteur, ce qui est un autre probleme.
//
// Limite affichee: la Search Console ne couvre que le site audite. Aucune comparaison
// concurrentielle n'est possible ici, et on ne la simule pas.

import { fetchSearchAnalytics, aggregateByPage, gscConfigured } from "../gsc/client.js";
import { fit } from "../pixels.js";

export const id = "positions";

export async function run(ctx) {
  const { scope, graph, options = {} } = ctx;
  const out = [];
  const strengths = [];
  const F = (r) => out.push({ dimensions: ["sxo"], url: scope.url, ...r });
  const env = options.env || process.env;

  if (!gscConfigured(env)) {
    return {
      findings: out, strengths,
      skipped: "Search Console non configuree (PANOPTIC_GSC_TOKEN ou PANOPTIC_GSC_SA)",
    };
  }

  const res = await fetchSearchAnalytics({
    origin: scope.origin, host: scope.host, env,
    days: options.gscDays || 90,
    fetchImpl: options.fetchImpl,
    nowMs: options.nowMs,
  });

  if (res.state !== "observed") {
    F({
      rule: "positions-unavailable", severity: "info", effort: 0,
      title: "Positions reelles non recuperees",
      proof: `${res.reason}. Aucune position n'est publiee plutot qu'une estimation.`,
      fix: "Verifier que le compte a acces a la propriete Search Console de ce domaine (prefixe d'URL ou propriete de domaine).",
      verifiability: "inconclusive",
    });
    return { findings: out, strengths };
  }

  const pages = aggregateByPage(res.rows);
  ctx.positions = { property: res.property, period: res.period, pages: pages.slice(0, 50), totals: totals(pages) };
  if (!pages.length) {
    F({
      rule: "positions-no-data", severity: "medium", effort: 0,
      title: "Aucune impression sur la periode",
      proof: `Propriete ${res.property}, du ${res.period.start} au ${res.period.end}: aucune donnee de recherche. Le site n'apparait dans aucun resultat, ou la propriete vient d'etre creee.`,
      fix: "Verifier l'indexation avant toute optimisation: un contenu parfait sur une page non indexee ne rapporte rien.",
      verifiability: "cross-checked",
    });
    return { findings: out, strengths };
  }

  const base = `Search Console, propriete ${res.property}, ${res.period.days} jours (${res.period.start} au ${res.period.end})`;
  const t = ctx.positions.totals;
  strengths.push(`Donnees de position reelles disponibles: ${t.impressions.toLocaleString("fr-FR")} impressions et ${t.clicks.toLocaleString("fr-FR")} clics sur ${pages.length} pages`);

  // --- Le croisement qui n'existe nulle part ailleurs ------------------------------------
  // Un title tronque n'est pas grave en soi. Un title tronque sur une page a forte
  // exposition et faible taux de clic est une perte chiffrable.
  const truncatedHighImpressions = [];
  for (const p of pages.slice(0, 40)) {
    if (p.impressions < 100) continue;
    const node = graph.get(p.page);
    if (!node?.title) continue;
    const f = fit(node.title, "title", "desktop");
    if (!f.truncated) continue;
    const expected = expectedCtr(p.position);
    if (expected && p.ctr < expected * 0.6) {
      truncatedHighImpressions.push({ p, f, node, expected });
    }
  }
  if (truncatedHighImpressions.length) {
    const ex = truncatedHighImpressions.sort((a, b) => b.p.impressions - a.p.impressions)[0];
    F({
      rule: "truncated-title-costing-clicks", severity: "high", effort: 0.3,
      url: ex.p.page,
      title: `${truncatedHighImpressions.length} page(s) tres exposees ont un title tronque et un taux de clic anormalement bas`,
      proof: `${base}. ${shortUrl(ex.p.page, scope.origin)}: ${ex.p.impressions.toLocaleString("fr-FR")} impressions, position moyenne ${ex.p.position}, taux de clic ${(ex.p.ctr * 100).toFixed(1)}% contre ${(ex.expected * 100).toFixed(0)}% attendus a cette position. Son title fait ${ex.f.width}px pour une limite de ${ex.f.limit}px et se coupe sur "${ex.f.cutOff.slice(0, 40)}".`,
      fix: "Reecrire ces titles pour qu'ils tiennent entierement, en placant l'argument decisif avant la coupure. L'exposition est deja acquise, seul le clic manque.",
      verifiability: "cross-checked",
      dimensions: ["sxo", "onpage"],
      indicator: "taux de clic de ces pages au prochain audit",
    });
  }

  // --- Pages a portee de main ------------------------------------------------------------
  const striking = pages.filter((p) => p.position >= 4 && p.position <= 15 && p.impressions >= 100);
  if (striking.length) {
    const top = striking.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
    F({
      rule: "striking-distance-pages", severity: "medium", effort: 0.5,
      url: top[0].page,
      title: `${striking.length} page(s) en position 4 a 15: le gain le plus accessible`,
      proof: `${base}. ` + top.map((p) => `${shortUrl(p.page, scope.origin)} (position ${p.position}, ${p.impressions.toLocaleString("fr-FR")} impressions)`).join(", ") + ". Ces pages sont deja jugees pertinentes par le moteur: les faire progresser coute moins qu'en creer de nouvelles.",
      fix: "Renforcer ces pages en priorite: profondeur du contenu, maillage interne depuis les pages a forte autorite, couverture des questions associees.",
      verifiability: "cross-checked",
    });
  }

  // --- Pages exposees sans aucun clic --------------------------------------------------------
  const noClicks = pages.filter((p) => p.impressions >= 300 && p.clicks === 0);
  if (noClicks.length) {
    F({
      rule: "impressions-without-clicks", severity: "medium", effort: 0.4,
      url: noClicks[0].page,
      title: `${noClicks.length} page(s) vues des centaines de fois sans generer un seul clic`,
      proof: `${base}. ` + noClicks.slice(0, 4).map((p) => `${shortUrl(p.page, scope.origin)} (${p.impressions.toLocaleString("fr-FR")} impressions, position ${p.position}, 0 clic)`).join(", ") + ". Soit la promesse affichee ne correspond pas a la requete, soit la position est trop basse pour etre vue.",
      fix: "Comparer la requete servie et le title affiche: le desaccord entre les deux est la cause la plus frequente.",
      verifiability: "cross-checked",
    });
  }

  // --- Pages du sitemap totalement absentes des resultats -------------------------------------
  const seen = new Set(pages.map((p) => normalize(p.page)));
  const indexable = graph.crawledPages().filter((n) => !n.noindex && n.inSitemap);
  const invisible = indexable.filter((n) => !seen.has(normalize(n.url)));
  if (invisible.length && indexable.length >= 3) {
    F({
      rule: "pages-without-impressions", severity: "medium", effort: 0.5,
      title: `${invisible.length} page(s) declarees au sitemap n'ont jamais ete affichees`,
      proof: `${base}. Aucune impression sur ${res.period.days} jours pour: ${invisible.slice(0, 5).map((n) => shortUrl(n.url, scope.origin)).join(", ")}. Elles sont peut-etre indexees, mais elles ne se positionnent sur rien.`,
      fix: "Traiter d'abord la raison d'exister de ces pages: sans requete cible identifiee, aucune optimisation technique ne les fera apparaitre.",
      verifiability: "cross-checked",
      dimensions: ["sxo", "content"],
    });
  }

  // --- Perimetre ------------------------------------------------------------------------------
  F({
    rule: "positions-own-site-only", severity: "info", effort: 0,
    title: "Positions limitees au site audite",
    proof: "La Search Console ne donne que les donnees du proprietaire. Aucune comparaison concurrentielle n'est possible par ce canal, et cet audit n'en simule pas.",
    fix: "Une source SERP tierce serait necessaire pour comparer aux concurrents, au prix d'une estimation la ou la Search Console donne une mesure.",
    verifiability: "inconclusive",
  });

  return { findings: out, strengths };
}

// Taux de clic attendu par position, ordres de grandeur publics observes sur les SERP.
// Sert de REFERENCE COMPARATIVE, pas de verite: on ne l'affiche jamais comme une
// promesse, seulement pour reperer un ecart anormal.
const CTR_CURVE = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.028, 10: 0.025 };
function expectedCtr(position) {
  if (!position) return null;
  const p = Math.round(position);
  if (p <= 10) return CTR_CURVE[p] || 0.025;
  if (p <= 20) return 0.012;
  return null;
}

function totals(pages) {
  return pages.reduce((s, p) => ({ clicks: s.clicks + p.clicks, impressions: s.impressions + p.impressions }), { clicks: 0, impressions: 0 });
}
function normalize(u) { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/+$/, ""); } catch { return u; } }
function shortUrl(u, origin) { return String(u).replace(origin, "") || "/"; }
