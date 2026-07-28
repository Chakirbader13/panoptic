// Panoptic SEO KING - score KING: un chiffre, neuf sous-scores, zero zone d'ombre.
//
// Trois principes non negociables:
//   1. Seuls les findings VERIFIES comptent. Un finding rejete par la couche
//      adversariale n'influence pas le score.
//   2. Un axe qu'on n'a pas pu mesurer vaut "n/a", jamais 100. Son poids est
//      redistribue sur les axes reellement mesures, et on le dit.
//   3. Les poids sont publies dans le rapport. Un score dont on ne peut pas
//      reconstituer le calcul est une opinion, pas une mesure.

export const DIMENSIONS = [
  { key: "technical", label: "Sante technique", weight: 16 },
  { key: "content", label: "Contenu et E-E-A-T", weight: 17 },
  { key: "geo", label: "Visibilite dans les moteurs IA", weight: 18 },
  { key: "onpage", label: "On-page et metadonnees", weight: 11 },
  { key: "performance", label: "Performance (Core Web Vitals)", weight: 10 },
  { key: "schema", label: "Donnees structurees", weight: 8 },
  { key: "sxo", label: "Adequation a l'intention", weight: 8 },
  { key: "architecture", label: "Architecture (sitemap, maillage, hreflang)", weight: 8 },
  { key: "entity", label: "Entite et autorite", weight: 4 },
];

// Penalites par severite, et plafond cumule par axe pour eviter qu'une nuee de
// findings mineurs pese autant qu'un blocage reel.
const PENALTY = {
  critical: { each: 25, cap: Infinity },
  high: { each: 12, cap: 60 },
  medium: { each: 5, cap: 30 },
  low: { each: 2, cap: 10 },
  info: { each: 0, cap: 0 },
};

export const BANDS = [
  { min: 90, band: "KING", meaning: "Competitif sur tous les axes. Le travail restant est de la maintenance et du rythme de publication." },
  { min: 75, band: "Solide", meaning: "Aucun blocage. Les gains viennent maintenant du contenu et de l'autorite, plus des correctifs." },
  { min: 60, band: "Challenger", meaning: "Fondamentaux en place, plusieurs points eleves brident encore les resultats." },
  { min: 40, band: "Expose", meaning: "Au moins une defaillance structurelle. La corriger avant d'investir dans le contenu." },
  { min: 0, band: "Bloque", meaning: "L'indexation ou la citation est cassee. Rien d'autre ne compte tant que ce n'est pas resolu." },
];

/**
 * @param findings  findings verifies et dedoublonnes (rejetes deja exclus)
 * @param context   { geo, coverage, ranAgents, deep }
 */
export function kingScore(findings, context = {}) {
  const verified = findings.filter((f) => f.check?.verdict !== "rejected");
  const subs = [];

  for (const dim of DIMENSIONS) {
    const own = verified.filter((f) => dimensionsOf(f).includes(dim.key));
    const measurable = isMeasurable(dim.key, context, own);

    if (!measurable.ok) {
      subs.push({ ...dim, score: null, count: own.length, measured: false, reason: measurable.reason });
      continue;
    }

    // Deduction par severite, plafonnee par palier.
    const bySev = {};
    for (const f of own) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
    let deduction = 0;
    const detail = [];
    for (const [sev, cfg] of Object.entries(PENALTY)) {
      const n = bySev[sev] || 0;
      if (!n) continue;
      const raw = n * cfg.each;
      const applied = Math.min(raw, cfg.cap);
      deduction += applied;
      if (applied) detail.push(`${n} ${sev} -${applied}`);
    }
    // La lane GEO produit sa propre note composite: on prend la plus severe des deux,
    // parce qu'une absence de citabilite ne se traduit pas toujours en findings.
    let score = Math.max(0, Math.round(100 - deduction));
    if (dim.key === "geo" && context.geo?.score != null) {
      score = Math.min(score, context.geo.score);
      detail.push(`plafonne par la note de citabilite ${context.geo.score}`);
    }
    if (dim.key === "entity" && context.entityScore != null) {
      score = Math.min(score, context.entityScore);
    }
    subs.push({ ...dim, score, count: own.length, measured: true, bySeverity: bySev, detail: detail.join(", ") || "aucun finding" });
  }

  // Redistribution proportionnelle du poids des axes non mesures.
  const measured = subs.filter((s) => s.measured);
  const measuredWeight = measured.reduce((a, s) => a + s.weight, 0);
  const lostWeight = subs.filter((s) => !s.measured).reduce((a, s) => a + s.weight, 0);
  const total = measuredWeight
    ? Math.round(measured.reduce((a, s) => a + s.score * (s.weight / measuredWeight), 0))
    : null;

  const band = BANDS.find((b) => total != null && total >= b.min) || BANDS[BANDS.length - 1];
  const coverage = Math.round((measuredWeight / 100) * 100);

  return {
    score: total,
    band: band.band,
    meaning: band.meaning,
    // Honnetete: le score porte sa propre couverture. Un 82 sur 96% des axes
    // n'est pas la meme affirmation qu'un 82 sur 60%.
    coverage,
    redistributed: lostWeight > 0,
    lostWeight,
    weights: Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.weight])),
    subscores: subs,
    unmeasured: subs.filter((s) => !s.measured).map((s) => ({ key: s.key, label: s.label, weight: s.weight, reason: s.reason })),
    geo: context.geo || null,
    findingsCounted: verified.filter((f) => dimensionsOf(f).some((d) => DIMENSIONS.some((x) => x.key === d))).length,
  };
}

// Un finding sans dimension explicite retombe sur une correspondance par agent,
// pour que les agents historiques (perf) alimentent quand meme leur axe.
const AGENT_FALLBACK = { seo: ["technical"], geo: ["geo"], perf: ["performance"], content: ["content"] };

export function dimensionsOf(f) {
  if (Array.isArray(f.dimensions) && f.dimensions.length) return f.dimensions;
  return AGENT_FALLBACK[f.agent] || [];
}

// Un axe est mesurable si la source qui l'alimente a reellement tourne.
// Cette fonction est la garantie qu'on ne donne jamais 100 a ce qu'on n'a pas regarde.
function isMeasurable(key, context, own) {
  const ran = new Set(context.ranAgents || []);
  if (key === "performance" && !ran.has("perf")) {
    return { ok: false, reason: "agent performance non execute sur cet audit" };
  }
  if (key === "entity") {
    // L'autorite OFF-PAGE (backlinks, mentions) demande un index de liens externe.
    // On mesure l'entite on-site, et on dit explicitement ce qui manque.
    if (context.entityScore == null && !own.length) {
      return { ok: false, reason: "entite non evaluee (accueil indisponible)" };
    }
  }
  if (key === "geo" && !ran.has("geo")) {
    return { ok: false, reason: "agent GEO non execute sur cet audit" };
  }
  if (!ran.has("seo") && ["technical", "onpage", "schema", "architecture", "sxo"].includes(key)) {
    return { ok: false, reason: "agent SEO non execute sur cet audit" };
  }
  return { ok: true };
}

// Ce que le score NE couvre pas, a afficher tel quel dans le rapport.
//
// Cette liste est DYNAMIQUE depuis que le moteur sait consommer des sources externes:
// annoncer "positions non mesurees" alors que la Search Console est branchee serait
// aussi faux que l'inverse. notMeasuredFor() ne renvoie que ce qui manque REELLEMENT
// pour cet audit-la.
export function notMeasuredFor(ctx = {}) {
  const out = [];
  const has = (x) => Boolean(x);
  if (!has(ctx.backlinks)) out.push(BASE_NOT_MEASURED.offpage);
  else if (ctx.backlinks?.sample) {
    out.push({
      key: "offpage-discovery",
      label: "Decouverte de liens entrants non declares",
      reason: `${ctx.backlinks.sample.checked} lien(s) fournis ont ete verifies en direct, mais aucun index du web ne permet d'en decouvrir d'autres.`,
      unlocks: "Profil de liens complet, comparaison concurrentielle, detection d'attaques de liens.",
    });
  }
  if (!has(ctx.positions)) out.push(BASE_NOT_MEASURED.serp);
  else {
    out.push({
      key: "serp-competitors",
      label: "Positions des concurrents",
      reason: "La Search Console ne donne que les donnees du site audite.",
      unlocks: "Part de voix, comparaison de positions, requetes ou un concurrent passe devant.",
    });
  }
  if (!has(ctx.citations)) out.push(BASE_NOT_MEASURED.citations);
  if (!has(ctx.logs)) out.push(BASE_NOT_MEASURED.logs);
  return out;
}

const BASE_NOT_MEASURED = {
  offpage: {
    key: "offpage",
    label: "Autorite off-page (backlinks, mentions de marque)",
    reason: "Aucun export de liens entrants fourni. Panoptic verifie des liens declares, il n'en decouvre pas.",
    unlocks: "Etat reel des liens declares: disparus, en nofollow, sur des pages desindexees.",
  },
  serp: {
    key: "serp",
    label: "Positions et volumes de recherche reels",
    reason: "Search Console non connectee a cet audit.",
    unlocks: "Pages a portee de main, titles tronques qui coutent des clics, pages sans aucune impression.",
  },
  citations: {
    key: "citations",
    label: "Citations effectives dans les reponses IA",
    reason: "Mesure des citations non activee (necessite une cle de moteur de reponse).",
    unlocks: "Taux de citation par moteur, concurrents cites a votre place, homonymie de marque.",
  },
  logs: {
    key: "logs",
    label: "Exploration reelle par les moteurs",
    reason: "Aucun fichier de logs serveur fourni.",
    unlocks: "Budget d'exploration gaspille, orphelines actives, 5xx furtifs, passage effectif des crawlers IA.",
  },
};

// Conserve pour compatibilite: liste statique du cas ou rien n'est branche.
export const NOT_MEASURED = [
  {
    key: "offpage",
    label: "Autorite off-page (backlinks, mentions de marque)",
    reason: "Demande un index de liens externe (Moz, Ahrefs, Common Crawl) non connecte a cet audit.",
    unlocks: "Profil de liens entrants, autorite de domaine, mentions non liees.",
  },
  {
    key: "serp",
    label: "Positions et volumes de recherche reels",
    reason: "Demande une source SERP ou la Search Console du site.",
    unlocks: "Cannibalisation confirmee par les positions, part de voix, requetes reellement servies.",
  },
  {
    key: "citations",
    label: "Citations effectives dans les reponses IA",
    reason: "Demande un suivi de citations par plateforme.",
    unlocks: "Taux de citation par moteur, requetes ou la marque est citee ou ignoree.",
  },
];
