// Panoptic SEO KING - lane maillage interne et cannibalisation.
//
// Deux moteurs deterministes, aucun appel externe:
//   - le graphe de liens (profondeur, autorite interne approchee, ancres);
//   - MinHash + LSH pour rapprocher les pages proches sans comparer toutes les paires,
//     puis deux mesures distinctes sur les seules candidates: le Jaccard dit "ces deux
//     pages contiennent les memes phrases" (duplication), le cosinus TF-IDF dit "ces
//     deux pages visent la meme intention" (cannibalisation).

import { anchorProfile } from "../graph.js";
import { LshIndex } from "../minhash.js";
import { approxCosine, sharedTopTerms } from "../pagefacts.js";

export const id = "linking";

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["architecture"], url: scope.url, ...r });

  const pages = graph.crawledPages().filter((p) => !p.noindex);
  if (pages.length < 2) {
    return { findings: out, strengths, skipped: "une seule page analysee: le maillage interne demande un crawl multi-pages" };
  }

  // --- Profondeur de crawl -------------------------------------------------------------
  const deepPages = pages.filter((p) => p.depth != null && p.depth > 3);
  if (deepPages.length) {
    F({
      rule: "crawl-depth-excessive", severity: "medium", effort: 0.4,
      title: `${deepPages.length} page(s) a plus de 3 clics de l'accueil`,
      proof: deepPages.slice(0, 6).map((p) => `${short(p.url)} (profondeur ${p.depth})`).join(", ") + ". Au-dela de 3 clics, une page recoit peu d'autorite interne et est recrawlee rarement.",
      fix: "Rapprocher ces pages: lien depuis la navigation, un hub thematique, ou une page a forte autorite.",
      verifiability: "cross-checked",
    });
  } else strengths.push("Toutes les pages analysees sont a 3 clics ou moins de l'accueil");

  const unreachable = pages.filter((p) => p.depth == null && p.url !== graph.home);
  if (unreachable.length) {
    F({
      rule: "unreachable-from-home", severity: "high", effort: 0.4,
      title: `${unreachable.length} page(s) inaccessible(s) en suivant les liens depuis l'accueil`,
      proof: unreachable.slice(0, 6).map((p) => short(p.url)).join(", ") + ". Decouvertes par le sitemap ou un lien lateral, mais aucun chemin de navigation n'y mene depuis l'accueil.",
      fix: "Ajouter un chemin de navigation reel vers ces pages.",
      verifiability: "cross-checked",
    });
  }

  // --- Autorite interne ------------------------------------------------------------------
  const ranked = [...pages].sort((a, b) => b.rank - a.rank);
  const weak = pages.filter((p) => p.inLinks.length > 0 && p.inLinks.length <= 1 && p.url !== graph.home);
  if (weak.length >= 2) {
    F({
      rule: "weak-internal-links", severity: "low", effort: 0.3,
      title: `${weak.length} page(s) ne recoivent qu'un seul lien interne`,
      proof: weak.slice(0, 6).map((p) => `${short(p.url)} (${p.inLinks.length} lien, autorite interne ${p.rank})`).join(", "),
      fix: "Multiplier les points d'entree contextuels vers ces pages depuis des contenus proches.",
      verifiability: "cross-checked",
    });
  }
  if (ranked.length > 2) {
    strengths.push(`Autorite interne concentree sur ${short(ranked[0].url)} et ${short(ranked[1].url)}`);
  }

  // --- Qualite des ancres -------------------------------------------------------------------
  let genericTotal = 0, anchorTotal = 0, emptyTotal = 0;
  const genericPages = [];
  for (const p of pages) {
    const prof = anchorProfile(p);
    p.anchorProfile = prof;
    genericTotal += prof.generic;
    anchorTotal += prof.withAnchor;
    emptyTotal += prof.empty;
    if (prof.total >= 3 && prof.genericRatio >= 50) genericPages.push({ p, prof });
  }
  if (genericPages.length) {
    F({
      rule: "generic-anchors", severity: "low", effort: 0.4,
      title: `${genericPages.length} page(s) recoivent surtout des ancres non descriptives`,
      proof: genericPages.slice(0, 4).map(({ p, prof }) => `${short(p.url)}: ${prof.genericRatio}% d'ancres generiques (${prof.top.map(([a, c]) => `"${a}" x${c}`).join(", ")})`).join(" | ") + ". Une ancre generique ne transmet aucun signal semantique.",
      fix: 'Remplacer "en savoir plus" et "cliquez ici" par le sujet reel de la page cible.',
      verifiability: "cross-checked",
    });
  }
  if (emptyTotal > 2) {
    F({
      rule: "empty-anchors", severity: "low", effort: 0.3,
      title: `${emptyTotal} lien(s) interne(s) sans texte ni alt exploitable`,
      proof: "Liens dont l'ancre est vide (icone seule, image sans alt). Ils passent de l'autorite sans dire de quoi la page parle, et sont muets pour les lecteurs d'ecran.",
      fix: "Donner un alt a l'image du lien, ou un aria-label au lien.",
      verifiability: "self-evident",
      dimensions: ["architecture", "onpage"],
    });
  }
  if (anchorTotal && !genericPages.length) strengths.push("Ancres internes descriptives sur l'ensemble des pages analysees");

  // --- Cannibalisation et duplication -----------------------------------------------------
  // Comparer toutes les paires coute O(n^2): gratuit a 30 pages, ruineux a 2000
  // (2 millions de comparaisons). On indexe donc les empreintes MinHash par bandes
  // (LSH) pour ne faire remonter que les paires ayant deja une chance d'etre proches,
  // puis on ne calcule la similarite exacte que sur celles-la.
  const candidates = pages.filter((p) => p.sketch && (p.textLength ?? p.text?.length ?? 0) > 500);
  if (candidates.length >= 2) {
    const byUrl = new Map(candidates.map((p) => [p.url, p]));
    const index = new LshIndex();
    for (const p of candidates) index.add(p.url, p.sketch);

    // Frequence documentaire sur les termes retenus: sert a ponderer le cosinus
    // sans avoir conserve les textes complets.
    const df = new Map();
    for (const p of candidates) {
      for (const [t] of p.topTerms || []) df.set(t, (df.get(t) || 0) + 1);
    }

    const cannibal = [];
    const duplicated = [];
    const pairs = index.candidatePairs({ maxPairs: 3000, minSimilarity: 0.25 });
    for (const { a, b, similarity: jac } of pairs) {
      const pa = byUrl.get(a), pb = byUrl.get(b);
      if (!pa || !pb) continue;
      const cos = approxCosine(pa.topTerms, pb.topTerms, df, candidates.length);
      const pair = { a: pa, b: pb, cos, jac, terms: sharedTopTerms(pa.topTerms || [], pb.topTerms || []) };
      // Duplication litterale: memes sequences de mots. Seuil haut, peu de faux positifs.
      if (jac >= 0.4) duplicated.push(pair);
      // Meme intention, formulations differentes: c'est la cannibalisation.
      else if (cos >= 0.65) cannibal.push(pair);
    }
    ctx.cannibalStats = { candidates: candidates.length, pairsExamined: pairs.length, duplicated: duplicated.length, cannibal: cannibal.length };

    for (const d of duplicated.sort((x, y) => y.jac - x.jac).slice(0, 3)) {
      F({
        rule: "duplicate-content", severity: "high", effort: 0.6,
        title: "Deux pages au contenu quasi identique",
        url: d.a.url,
        proof: `${short(d.a.url)} et ${short(d.b.url)}: ${Math.round(d.jac * 100)}% de sequences de 5 mots en commun (Jaccard estime par MinHash). Google n'en indexera qu'une et choisira laquelle.`,
        fix: "Fusionner les deux pages et rediriger en 301, ou differencier reellement le contenu et canonicaliser vers la version de reference.",
        verifiability: "cross-checked",
        dimensions: ["architecture", "content"],
      });
    }
    for (const c of cannibal.sort((x, y) => y.cos - x.cos).slice(0, 4)) {
      F({
        rule: "keyword-cannibalization", severity: "medium", effort: 0.6,
        title: "Deux pages se disputent la meme intention de recherche",
        url: c.a.url,
        proof: `${short(c.a.url)} et ${short(c.b.url)}: similarite TF-IDF de ${Math.round(c.cos * 100)}% sur les termes ${c.terms.slice(0, 6).join(", ")}. Titles: "${(c.a.title || "").slice(0, 45)}" / "${(c.b.title || "").slice(0, 45)}".`,
        fix: "Choisir la page de reference pour cette intention, specialiser l'autre sur un angle distinct, et lier la seconde vers la premiere.",
        verifiability: "cross-checked",
        dimensions: ["architecture", "sxo"],
      });
    }
    if (!duplicated.length && !cannibal.length) {
      strengths.push(`Aucune cannibalisation detectee sur ${candidates.length} pages de contenu (${pairs.length} paires proches examinees, TF-IDF < 65%)`);
    }
  }

  return { findings: out, strengths };
}
