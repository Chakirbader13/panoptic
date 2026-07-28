// Panoptic SEO KING - extraction en UNE passe, pour pouvoir jeter le HTML.
//
// A 30 pages on peut garder le HTML de tout le monde en memoire. A 2000 pages, 100 Ko
// par page font 200 Mo de chaines brutes, plus le texte extrait, plus les structures
// derivees: l'instance tombe en OOM avant la fin de l'audit.
//
// Regle: on lit chaque page UNE fois, on en sort tout ce dont une lane pourra avoir
// besoin, puis l'appelant libere le HTML. Consequence assumee: ce qui n'est pas extrait
// ici est perdu. Toute nouvelle regle qui a besoin d'un signal brut doit l'ajouter ici,
// pas relire le HTML plus tard.
//
// Deuxieme contrainte, moins evidente: on n'a pas de parseur DOM, donc l'extraction est
// une serie de regex sur de grandes chaines, en synchrone. A forte concurrence c'est
// l'EVENT LOOP qui lache en premier, avant la memoire: les fetch en vol expirent parce
// que le thread est occupe a scanner du HTML. D'ou le plafond MAX_SCAN.

import { headings, textOf, metaMap, linkRels, robotsDirectives, htmlLang, images as extractImages, links as extractLinks, titles } from "./html.js";
import { shingles, contentTokens, wordsOf, statDensity, readability, freshnessSignals, answerBlocks, detectLang, definitionPatterns } from "./text.js";
import { signature } from "./minhash.js";

// Au-dela, on tronque: aucune page legitime n'a besoin de 800 Ko de HTML pour etre
// jugee, et scanner 5 Mo de HTML genere bloque le thread pendant des secondes.
const MAX_SCAN = 800_000;
const MAX_TEXT_KEEP = 12_000;      // extrait de texte conserve par page
const MAX_LINKS_KEEP = 400;
const MAX_IMAGES_KEEP = 120;
const MAX_JSONLD_KEEP = 40_000;    // les blocs JSON-LD sont petits, on les garde
const TOP_TERMS = 60;

/**
 * Extrait tous les faits utiles d'une page. Ne conserve JAMAIS le HTML complet:
 * c'est l'appelant qui decide, selon la taille de l'audit, s'il en garde une copie.
 */
export function extractFacts(url, html = "", { status = 200, origin, lang, keepFullText = false } = {}) {
  const src = html.length > MAX_SCAN ? html.slice(0, MAX_SCAN) : html;
  const truncated = html.length > MAX_SCAN;

  const hs = headings(src);
  const text = textOf(src);
  const metas = metaMap(src);
  const rels = linkRels(src);
  const rd = robotsDirectives(src);
  const allTitles = titles(src);

  const canonRels = rels.filter((r) => r.rel.split(/\s+/).includes("canonical"));
  const alternates = rels
    .filter((r) => r.rel.split(/\s+/).includes("alternate") && r.hreflang)
    .map((r) => ({ hreflang: r.hreflang, href: safeAbs(r.href, url) }));

  const links = extractLinks(src, url, origin || originOf(url));
  const internal = links.filter((l) => l.internal && l.abs).slice(0, MAX_LINKS_KEEP);
  const external = links.filter((l) => !l.internal && l.abs);

  const detectedLang = lang || detectLang(text).lang || "fr";
  const words = wordsOf(text).length;

  // Metriques derivees calculees MAINTENANT, tant qu'on a le texte complet.
  // Une fois le texte tronque, elles ne seraient plus calculables correctement.
  const derived = {
    words,
    stats: statDensity(text),
    readability: readability(text, detectedLang),
    freshness: freshnessSignals(src, text),
    answers: answerBlocks(hs, text),
    definitions: definitionPatterns(text).length,
    lang: detectedLang,
  };

  // Empreinte de contenu: permet de comparer 2000 pages entre elles sans conserver
  // 2000 textes complets.
  const shingleSet = shingles(text, 5, detectedLang);
  const sketch = signature(shingleSet);
  const topTerms = topTermsOf(text, detectedLang);

  const jsonldRaw = (src.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []);
  const jsonld = capJoin(jsonldRaw, MAX_JSONLD_KEEP);

  const scriptBytes = (src.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join("").length;

  return {
    url, status,
    title: allTitles[0] || null,
    titleCount: allTitles.length,
    desc: metas.name.description || null,
    // URL ABSOLUE des l'extraction. Le navigateur resout les URLs relatives tout seul:
    // sans normalisation ici, comparer le HTML brut au DOM rendu annoncerait "la
    // canonical a change pendant le rendu" sur tout site qui la declare en relatif.
    canonical: canonRels[0]?.href ? safeAbs(canonRels[0].href, url) : null,
    canonicalRaw: canonRels[0]?.href || null,
    canonicalCount: canonRels.length,
    noindex: rd.noindex,
    nofollow: rd.nofollow,
    robotsDirectives: rd,
    lang: htmlLang(src),
    charset: metas.charset,
    metas,
    headings: hs,
    h1: hs.filter((h) => h.level === 1 && !h.hidden).length,
    alternates,
    internalLinks: internal.map((l) => ({ abs: l.abs, anchor: l.effectiveAnchor, rel: l.rel, source: l.anchorSource })),
    externalLinks: external.slice(0, 60).map((l) => ({ href: l.href, rel: l.rel })),
    externalLinkCount: external.length,
    // Vue combinee attendue par les lanes contenu et e-commerce (href + ancre bruts).
    allLinks: links.slice(0, MAX_LINKS_KEEP).map((l) => ({
      href: l.href, abs: l.abs, internal: l.internal, effectiveAnchor: l.effectiveAnchor, rel: l.rel,
    })),
    images: extractImages(src).slice(0, MAX_IMAGES_KEEP),
    jsonld,
    words,
    derived,
    sketch,
    topTerms,
    textSample: keepFullText ? text : text.slice(0, MAX_TEXT_KEEP),
    textLength: text.length,
    bytes: html.length,
    scriptBytes,
    htmlTruncated: truncated,
    template: urlTemplate(url),
  };
}

// Termes les plus frequents, poids brut. Sert a calculer un cosinus approche sur les
// seules paires candidates, sans conserver les textes.
function topTermsOf(text, lang) {
  const toks = contentTokens(text, lang);
  if (!toks.length) return [];
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  return [...tf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS)
    .map(([term, n]) => [term, n / toks.length]);
}

function capJoin(list, maxChars) {
  const out = [];
  let total = 0;
  for (const s of list) {
    if (total + s.length > maxChars) break;
    out.push(s);
    total += s.length;
  }
  return out;
}

// Gabarit d'URL = TYPE de page, pas identite de page.
//
// Regle: le dernier segment d'un chemin d'au moins deux niveaux est un identifiant de
// ressource, quelle que soit sa forme (numero, uuid, slug editorial). Les segments
// parents, eux, decrivent la section et sont conserves.
//   /produit/ref-1000            -> /produit/{leaf}
//   /guide/audit-technique-2026  -> /guide/{leaf}
//   /blog/article-7              -> /blog/{leaf}
//   /securite                    -> /securite        (page de premier niveau: son
//                                                     chemin EST son identite)
//
// Le piege evite ici: normaliser uniquement les segments qui "ressemblent" a un id
// (chiffres, uuid) laisse 800 articles a slug editorial dans 800 gabarits distincts.
// Le moteur croit alors voir 800 types de pages et repartit son budget de crawl a
// parts egales entre eux, ce qui affame completement une section de 1500 fiches.
export function urlTemplate(url) {
  let path;
  try { const u = new URL(url); path = u.pathname; } catch { path = String(url); }
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return "/";
  if (segs.length === 1) return "/" + normalizeSegment(segs[0], true);
  const parents = segs.slice(0, -1).map((s) => normalizeSegment(s, false));
  return "/" + parents.join("/") + "/{leaf}";
}

// Un segment parent qui est manifestement un identifiant est normalise aussi, sinon
// /categorie/12/produit/xyz et /categorie/13/produit/abc paraitraient differents.
function normalizeSegment(s, isOnly) {
  if (/^\d+$/.test(s)) return "{n}";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "{uuid}";
  if (/^[0-9a-f]{16,}$/i.test(s)) return "{hash}";
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return "{date}";
  if (!isOnly && /-\d+$/.test(s)) return s.replace(/-\d+$/, "-{n}");
  return s;
}

function safeAbs(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}
function originOf(url) {
  try { return new URL(url).origin; } catch { return ""; }
}

// Cosinus approche entre deux pages a partir de leurs seuls topTerms, ponderes par un
// IDF calcule sur le corpus retenu. Suffisant pour departager des paires deja
// selectionnees par le LSH, et sans conserver aucun texte.
export function approxCosine(aTerms, bTerms, df, docCount) {
  if (!aTerms?.length || !bTerms?.length) return 0;
  const idf = (t) => Math.log(1 + docCount / (1 + (df.get(t) || 0)));
  const va = new Map(), vb = new Map();
  let na = 0, nb = 0;
  for (const [t, w] of aTerms) { const v = w * idf(t); va.set(t, v); na += v * v; }
  for (const [t, w] of bTerms) { const v = w * idf(t); vb.set(t, v); nb += v * v; }
  na = Math.sqrt(na) || 1; nb = Math.sqrt(nb) || 1;
  let dot = 0;
  for (const [t, v] of va) { const o = vb.get(t); if (o) dot += (v / na) * (o / nb); }
  return Math.round(dot * 1000) / 1000;
}

// Termes partages les plus contributifs: la preuve lisible d'une cannibalisation.
export function sharedTopTerms(aTerms, bTerms, limit = 8) {
  const b = new Map(bTerms);
  return aTerms
    .filter(([t]) => b.has(t))
    .map(([t, w]) => [t, w * b.get(t)])
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([t]) => t);
}
