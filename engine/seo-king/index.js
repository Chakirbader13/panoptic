// Panoptic SEO KING - orchestration des lanes.
//
// Contrat de lane: une fonction pure run(ctx) -> { findings, strengths, skipped? }.
// Une lane NE FETCH JAMAIS. Elle lit le contexte partage (scope de la recon, resultat
// de la deep-recon, graphe d'evidence). C'est ce qui garantit qu'un audit ne
// declenche qu'une seule vague de requetes quel que soit le nombre de lanes.
//
// Les agents "seo" et "geo" de Panoptic sont des facades sur ce module: ils
// partagent une execution unique memoisee et se repartissent les findings par
// dimension principale. Les 15 agents et l'UI restent inchanges.

import { deepReconShared } from "./deep-recon.js";
import { buildGraph, attachRendered, sameSite } from "./graph.js";
import { renderShared } from "./render.js";
import { browserAllowed } from "../scanners/browser.js";

import * as technical from "./lanes/technical.js";
import * as onpage from "./lanes/onpage.js";
import * as schema from "./lanes/schema.js";
import * as sitemap from "./lanes/sitemap.js";
import * as hreflang from "./lanes/hreflang.js";
import * as linking from "./lanes/linking.js";
import * as content from "./lanes/content.js";
import * as entity from "./lanes/entity.js";
import * as sxo from "./lanes/sxo.js";
import * as local from "./lanes/local.js";
import * as ecommerce from "./lanes/ecommerce.js";
import * as geo from "./lanes/geo.js";
import * as citations from "./lanes/citations.js";
import * as renderDelta from "./lanes/render-delta.js";
import * as logs from "./lanes/logs.js";
import * as positions from "./lanes/positions.js";
import * as backlinks from "./lanes/backlinks.js";

// Ordre significatif: schema alimente entite, entite alimente la note GEO, et la
// mesure de citations passe en dernier parce qu'elle reutilise la marque et la
// categorie deduites en amont.
// local, ecommerce et citations sont CONDITIONNELLES: elles se taisent (avec un
// motif) quand le site n'a ni realite physique, ni vente en ligne, ni cle de moteur
// de reponse configuree.
const LANES = [technical, onpage, schema, sitemap, hreflang, linking, content, local, ecommerce, entity, sxo, renderDelta, logs, positions, backlinks, geo, citations];

// Dimension principale -> agent proprietaire du finding dans le rapport.
const GEO_OWNED = new Set(["geo", "entity"]);
export function ownerOf(finding) {
  const first = (finding.dimensions || [])[0];
  return GEO_OWNED.has(first) ? "geo" : "seo";
}

// Execution unique, partagee par les deux facades qui tournent en parallele.
export function runShared(scope, options = {}) {
  if (!scope.__seoKingPromise) scope.__seoKingPromise = execute(scope, options);
  return scope.__seoKingPromise;
}

// Lecture du resultat deja calcule, sans jamais en declencher un. La synthese de
// l'orchestrateur s'en sert pour composer le score KING: si les agents seo/geo
// n'ont pas tourne, elle recoit null et le dit au lieu de noter a l'aveugle.
export function readShared(scope) {
  return scope?.__seoKingResult || null;
}

async function execute(scope, options) {
  const t0 = performance.now();
  if (!scope.reachable) {
    return { findings: [], strengths: [], lanes: [], skipped: "production injoignable", king: null, stats: {} };
  }

  const deep = await deepReconShared(scope, options.deep);
  const graph = buildGraph(scope, deep);

  // Rendu navigateur: on execute le JavaScript sur un echantillon representatif pour
  // pouvoir dire ce que Googlebot voit EN PLUS des moteurs de reponse IA, qui eux ne
  // rendent pas. Gate sur browserAllowed (capacite premium, ~1 Go de Chromium).
  let render = null;
  if (options.render !== false && browserAllowed(scope)) {
    const targets = renderTargets(graph, scope, options.renderPages || 8);
    if (targets.length) {
      render = await renderShared(scope, targets, {
        maxPages: options.renderPages || 8,
        auth: scope.auth || null,
      });
      render.attached = attachRendered(graph, render, scope.origin);
    }
  }

  const ctx = { scope, deep, graph, options, render, alias: detectAlias(graph, scope) };

  const findings = [];
  const strengths = [];
  const lanes = [];

  for (const lane of LANES) {
    const t = performance.now();
    let result;
    try {
      // Les lanes sont synchrones sauf celles qui interrogent un service externe
      // (citations): on attend systematiquement, ce qui couvre les deux cas.
      result = await lane.run(ctx);
    } catch (e) {
      lanes.push({ id: lane.id, error: e.message, ms: Math.round(performance.now() - t) });
      continue;
    }
    for (const f of result.findings || []) findings.push({ ...f, lane: lane.id, owner: ownerOf(f) });
    for (const s of result.strengths || []) strengths.push({ lane: lane.id, text: s });
    lanes.push({
      id: lane.id,
      findings: (result.findings || []).length,
      strengths: (result.strengths || []).length,
      skipped: result.skipped || null,
      ms: Math.round(performance.now() - t),
    });
  }

  const out = {
    findings, strengths, lanes,
    geo: ctx.geo || null,
    citations: ctx.citations || null,
    // Noeuds du graphe: permet aux tests et au rapport d'inspecter les deux vues
    // (HTML servi / DOM rendu) sans reconstruire le graphe.
    __nodes: graph.nodes,
    render: render ? { available: render.available, stats: render.stats, attached: render.attached, reason: render.reason, error: render.error } : null,
    renderDelta: ctx.renderDelta || null,
    logs: ctx.logs || null,
    positions: ctx.positions || null,
    backlinks: ctx.backlinks || null,
    entityScore: ctx.entityScore ?? null,
    platforms: ctx.geoPlatforms || null,
    crawlerMatrix: ctx.crawlerMatrix || null,
    coverage: deep?.coverage || {},
    budget: deep?.budget || null,
    stats: {
      pages: graph.crawledPages().length,
      nodes: graph.nodes.size,
      lanes: lanes.length,
      requests: deep?.budget?.requests ?? 0,
      ms: Math.round(performance.now() - t0),
    },
  };
  out.alias = ctx.alias;
  scope.__seoKingResult = out;
  return out;
}

// Pages a rendre: l'accueil, puis UN representant par type de page. Rendre deux fiches
// produit du meme gabarit coute deux secondes pour repeter le meme diagnostic; rendre
// une page de chaque type revele les gabarits ou le JavaScript casse quelque chose.
function renderTargets(graph, scope, cap) {
  const pages = graph.crawledPages().filter((p) => p.status === 200);
  const out = [];
  const seen = new Set();
  const home = graph.get(scope.url);
  if (home) { out.push(home.url); seen.add(home.template || home.url); }
  for (const p of pages) {
    if (out.length >= cap) break;
    const t = p.template || p.path || p.url;
    if (seen.has(t) || out.includes(p.url)) continue;
    seen.add(t);
    out.push(p.url);
  }
  return out;
}

// Detection du schema "domaine alias": toutes les pages se canonicalisent vers UN
// SEUL autre domaine. C'est une configuration deliberee et courante (alias de
// marque, domaine de preproduction Netlify, migration en cours), pas un defaut.
// Sans cette detection, l'audit crie au blocage critique sur un site parfaitement
// configure, et enchaine avec des faux positifs hreflang et sitemap en cascade.
// Nuance importante: si seulement UNE PARTIE des pages part ailleurs, ce n'est plus
// un alias, c'est une fuite d'indexation, et la severite critique reste justifiee.
function detectAlias(graph, scope) {
  const pages = graph.crawledPages().filter((p) => !p.noindex && p.canonicalNormalized);
  if (pages.length < 2) return null;
  const foreign = pages.filter((p) => !sameSite(p.canonicalNormalized, scope.origin));
  if (foreign.length < 2) return null;

  const origins = new Set();
  for (const p of foreign) {
    try { origins.add(new URL(p.canonicalNormalized).origin); } catch { /* ignore */ }
  }
  if (origins.size !== 1) return null;
  const ratio = foreign.length / pages.length;
  if (ratio < 0.8) return null;

  return {
    canonicalOrigin: [...origins][0],
    pages: foreign.length,
    total: pages.length,
    ratio: Math.round(ratio * 100),
  };
}
