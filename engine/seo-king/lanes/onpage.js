// Panoptic SEO KING - lane on-page et metadonnees.
// Particularite: on mesure les titres et descriptions en PIXELS, pas en caracteres.
// Google tronque en pixels. Un title de 58 caracteres peut etre coupe en plein
// mot-cle, un title de 66 caracteres peut tenir entier. Compter les caracteres,
// c'est ce que fait tout le marche, et c'est faux.

import { fit } from "../pixels.js";
import { headingSkips } from "../html.js";

export const id = "onpage";

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["onpage"], url: scope.url, ...r });
  const pages = graph.crawledPages().filter((p) => !p.noindex);

  // --- Titles ------------------------------------------------------------------------
  const noTitle = pages.filter((p) => !p.title);
  if (noTitle.length) {
    F({
      rule: "missing-title", severity: "high", effort: 0.2,
      title: `Balise <title> absente sur ${noTitle.length} page(s) indexable(s)`,
      proof: noTitle.slice(0, 8).map((p) => short(p.url)).join(", "),
      fix: "Un title unique et descriptif par page, mot-cle principal en debut.",
      verifiability: "self-evident",
    });
  }

  const truncatedTitles = [];
  const shortTitles = [];
  for (const p of pages) {
    if (!p.title) continue;
    const f = fit(p.title, "title", "desktop");
    p.titleFit = f;
    if (f.truncated) truncatedTitles.push({ p, f });
    else if (f.underUsed) shortTitles.push({ p, f });
  }
  if (truncatedTitles.length) {
    const worst = truncatedTitles.sort((a, b) => b.f.width - a.f.width)[0];
    F({
      rule: "title-truncated-pixels", severity: "medium", effort: 0.3,
      title: `${truncatedTitles.length} title(s) tronque(s) dans les resultats Google`,
      url: worst.p.url,
      proof: `Mesure en pixels (Arial 20px, limite desktop ${worst.f.limit}px). Exemple ${short(worst.p.url)}: ${worst.f.width}px, affiche "${worst.f.visible}", coupe "${worst.f.cutOff}".`,
      fix: `Ramener chaque title sous ${worst.f.limit}px de large. Placer le mot-cle avant la coupure, pas apres.`,
      verifiability: "self-evident",
    });
  }
  if (shortTitles.length) {
    F({
      rule: "title-underused", severity: "low", effort: 0.3,
      title: `${shortTitles.length} title(s) exploitent moins de 55% de la place disponible`,
      proof: shortTitles.slice(0, 5).map(({ p, f }) => `${short(p.url)}: ${f.width}px / ${f.limit}px (${f.fillRatio}%) "${p.title}"`).join(" | "),
      fix: "Etendre le title avec un qualificatif utile (benefice, ville, categorie). L'emplacement est deja paye.",
      verifiability: "self-evident",
    });
  }

  // Doublons: deux pages avec le meme title se cannibalisent dans les SERP.
  for (const g of duplicates(pages, "title")) {
    F({
      rule: "duplicate-title", severity: "medium", effort: 0.3,
      title: `Title identique sur ${g.pages.length} pages: "${g.value.slice(0, 60)}"`,
      proof: g.pages.map((u) => short(u)).join(", "),
      fix: "Differencier chaque title sur l'intention propre de la page.",
      verifiability: "self-evident",
      dimensions: ["onpage", "architecture"],
    });
  }
  if (pages.length && !noTitle.length && !truncatedTitles.length) {
    strengths.push(`Les ${pages.length} titles tiennent entierement dans la largeur SERP`);
  }

  // --- Meta descriptions ----------------------------------------------------------------
  const noDesc = pages.filter((p) => !p.desc);
  if (noDesc.length) {
    F({
      rule: "missing-meta-desc", severity: "medium", effort: 0.3,
      title: `Meta description absente sur ${noDesc.length} page(s)`,
      proof: noDesc.slice(0, 8).map((p) => short(p.url)).join(", ") + ". Google fabrique alors un extrait depuis le corps de la page, sans controle editorial.",
      fix: "Rediger une description qui promet un benefice concret et contient le mot-cle.",
      verifiability: "self-evident",
    });
  }
  const truncDesc = pages.filter((p) => p.desc && fit(p.desc, "description", "desktop").truncated);
  if (truncDesc.length) {
    const ex = truncDesc[0];
    const f = fit(ex.desc, "description", "desktop");
    F({
      rule: "meta-desc-truncated", severity: "low", effort: 0.3,
      title: `${truncDesc.length} meta description(s) tronquee(s) en SERP`,
      proof: `Exemple ${short(ex.url)}: ${f.width}px pour une limite de ${f.limit}px, coupe a "...${f.cutOff.slice(0, 40)}".`,
      fix: "Placer l'argument decisif et l'appel a l'action dans les premiers 900px.",
      verifiability: "self-evident",
    });
  }
  for (const g of duplicates(pages, "desc")) {
    F({
      rule: "duplicate-meta-desc", severity: "low", effort: 0.3,
      title: `Meta description identique sur ${g.pages.length} pages`,
      proof: `"${g.value.slice(0, 70)}..." sur ${g.pages.map((u) => short(u)).join(", ")}`,
      fix: "Une description par page, alignee sur sa promesse propre.",
      verifiability: "self-evident",
    });
  }

  // --- Hierarchie de titres --------------------------------------------------------------
  // Ce n'est pas de la cosmetique: la hierarchie est ce qui permet de decouper une page
  // en passages autonomes, donc citables par un moteur de reponse.
  for (const p of pages) {
    if (!p.headings?.length) continue;
    const visible = p.headings.filter((h) => !h.hidden);
    const h1s = visible.filter((h) => h.level === 1);
    if (h1s.length === 0) {
      F({
        rule: "missing-h1", severity: "medium", effort: 0.2,
        title: "Aucun <h1> visible sur la page", url: p.url,
        proof: `${short(p.url)}: ${visible.length} titres, aucun de niveau 1. Premier titre: h${visible[0]?.level} "${visible[0]?.text?.slice(0, 50) || ""}".`,
        fix: "Un h1 unique qui reprend la promesse de la page.",
        verifiability: "self-evident",
      });
    } else if (h1s.length > 1) {
      F({
        rule: "multiple-h1", severity: "low", effort: 0.3,
        title: `${h1s.length} balises <h1> sur la meme page`, url: p.url,
        proof: `${short(p.url)}: ${h1s.map((h) => `"${h.text.slice(0, 35)}"`).join(", ")}`,
        fix: "Garder un seul h1. Les autres deviennent des h2.",
        verifiability: "inconclusive",
        reason: "Des sections mutuellement exclusives (onglets, responsive) peuvent n'exposer qu'un h1 a la fois.",
      });
    }
    const empties = visible.filter((h) => h.empty);
    if (empties.length) {
      F({
        rule: "empty-headings", severity: "low", effort: 0.2,
        title: `${empties.length} titre(s) vide(s) dans la structure`, url: p.url,
        proof: `${short(p.url)}: ${empties.length} balise(s) h${empties.map((e) => e.level).join("/h")} sans texte. Elles cassent le decoupage en passages.`,
        fix: "Supprimer les balises de titre vides ou leur donner un texte.",
        verifiability: "self-evident",
      });
    }
    const skips = headingSkips(visible);
    if (skips.length > 1) {
      F({
        rule: "heading-skips", severity: "low", effort: 0.3,
        title: `${skips.length} sauts de niveau dans la hierarchie de titres`, url: p.url,
        proof: `${short(p.url)}: ` + skips.slice(0, 3).map((s) => `h${s.from} -> h${s.to} ("${s.text}")`).join(", "),
        fix: "Descendre les niveaux un a un. Un moteur de reponse s'appuie sur cette hierarchie pour delimiter un passage.",
        verifiability: "self-evident",
        dimensions: ["onpage", "geo"],
      });
    }
  }

  // --- Open Graph et Twitter ----------------------------------------------------------
  const home = graph.get(scope.url);
  const props = home?.metas?.property || {};
  const names = home?.metas?.name || {};
  const missingOg = ["og:title", "og:description", "og:image", "og:url"].filter((k) => !props[k]);
  if (missingOg.length === 4) {
    F({
      rule: "missing-og", severity: "medium", effort: 0.2,
      title: "Open Graph absent: tout partage social affiche un lien nu",
      proof: "Aucune balise og: sur l'accueil. Les partages LinkedIn, WhatsApp, Slack et Facebook n'auront ni titre, ni visuel.",
      fix: "Ajouter og:title, og:description, og:image (1200x630), og:url, og:type.",
      verifiability: "self-evident",
    });
  } else if (missingOg.length) {
    F({
      rule: "incomplete-og", severity: "low", effort: 0.2,
      title: `Open Graph incomplet: ${missingOg.join(", ")} manquant(s)`,
      proof: `Presents: ${Object.keys(props).filter((k) => k.startsWith("og:")).join(", ") || "aucun"}.`,
      fix: `Completer ${missingOg.join(", ")}.`,
      verifiability: "self-evident",
    });
  } else strengths.push("Open Graph complet sur l'accueil (titre, description, image, url)");

  // og:image en URL relative: la moitie des plateformes ne la resout pas.
  if (props["og:image"] && !/^https?:\/\//i.test(props["og:image"])) {
    F({
      rule: "og-image-relative", severity: "medium", effort: 0.1,
      title: "og:image declaree en URL relative",
      proof: `og:image = "${props["og:image"]}". La specification Open Graph impose une URL absolue; plusieurs plateformes n'affichent alors aucun visuel.`,
      fix: `Utiliser l'URL absolue: ${origin}${props["og:image"].startsWith("/") ? "" : "/"}${props["og:image"]}`,
      verifiability: "self-evident",
    });
  }
  if (!names["twitter:card"] && Object.keys(props).some((k) => k.startsWith("og:"))) {
    F({
      rule: "missing-twitter-card", severity: "low", effort: 0.1,
      title: "twitter:card absent",
      proof: "Open Graph present mais aucune balise twitter:card: X/Twitter affiche une vignette reduite.",
      fix: '<meta name="twitter:card" content="summary_large_image">',
      verifiability: "self-evident",
    });
  }

  // --- Images ---------------------------------------------------------------------------
  let totalImg = 0, noAlt = 0, noDims = 0;
  const noAltExamples = [];
  for (const p of pages) {
    for (const img of p.images || []) {
      totalImg++;
      if (!img.hasAltAttr) { noAlt++; if (noAltExamples.length < 5) noAltExamples.push(`${short(p.url)} ${String(img.src).slice(0, 50)}`); }
      if (!img.width || !img.height) noDims++;
    }
  }
  if (noAlt) {
    F({
      rule: "images-missing-alt", severity: "low", effort: 0.4,
      title: `${noAlt}/${totalImg} image(s) sans attribut alt`,
      proof: noAltExamples.join(" | ") + ". Une image sans alt n'est ni indexee ni decrite aux lecteurs d'ecran.",
      fix: 'Decrire le contenu de l\'image. Pour une image purement decorative, alt="" explicite est correct.',
      verifiability: "self-evident",
      dimensions: ["onpage"],
    });
  }
  if (noDims && totalImg) {
    F({
      rule: "images-missing-dimensions", severity: "low", effort: 0.3,
      title: `${noDims}/${totalImg} image(s) sans width/height explicites`,
      proof: "Sans dimensions, le navigateur ne reserve pas la place: le contenu saute au chargement (CLS).",
      fix: "Ajouter width et height (ou aspect-ratio en CSS) sur chaque image.",
      verifiability: "self-evident",
      dimensions: ["onpage", "performance"],
    });
  }
  if (totalImg && !noAlt) strengths.push(`Les ${totalImg} images analysees portent un attribut alt`);

  return { findings: out, strengths };
}

function duplicates(pages, key) {
  const map = new Map();
  for (const p of pages) {
    const v = p[key];
    if (!v) continue;
    const k = String(v).trim().toLowerCase();
    if (!map.has(k)) map.set(k, { value: v, pages: [] });
    map.get(k).pages.push(p.url);
  }
  return [...map.values()].filter((g) => g.pages.length > 1);
}
