// Panoptic SEO KING - lane GEO: visibilite dans les moteurs de reponse IA.
//
// La question n'est plus "est-ce que je ressors dans les 10 liens bleus" mais
// "est-ce que ma phrase est reprise dans la reponse". Ce sont deux problemes
// differents: on peut etre premier sur Google et invisible dans ChatGPT.
//
// Cinq composantes notees, alignees sur la grille GEO du referentiel:
//   citabilite 25 | lisibilite structurelle 20 | contenu multi-modal 15
//   autorite et marque 20 | accessibilite technique 20

import { answerBlocks, statDensity, definitionPatterns, freshnessSignals, readability, detectLang, isQuestion, wordsOf } from "../text.js";
import { isAllowed, CRAWLERS } from "../robots.js";

export const id = "geo";

export function run(ctx) {
  const { scope, deep, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["geo"], url: scope.url, ...r });

  const pages = graph.crawledPages().filter((p) => !p.noindex && p.text);
  const home = graph.get(scope.url);
  const lang = detectLang(home?.text || "").lang || "fr";
  const components = {};

  // --- 1. Accessibilite technique (20) --------------------------------------------------
  // Le contenu existe-t-il pour un fetcher qui n'execute pas JavaScript, et les
  // moteurs de reponse ont-ils le droit de le lire ?
  const parsed = deep?.robots?.parsed;
  const aiSearchBots = CRAWLERS.filter((c) => c.kind === "ai-search");
  let aiBlocked = 0;
  if (parsed) {
    for (const bot of aiSearchBots) if (!isAllowed(parsed, bot.ua, "/").allowed) aiBlocked++;
  }
  const homeWords = wordsOf(home?.text || "").length;
  const ssrOk = homeWords >= 300;
  components.technical = clamp(
    100
    - (aiBlocked / Math.max(1, aiSearchBots.length)) * 60
    - (ssrOk ? 0 : 40)
    - (deep?.llms?.present ? 0 : 10)
  );

  // --- 2. llms.txt: presence ET qualite --------------------------------------------------
  const llms = deep?.llms;
  if (llms?.state === "observed" && !llms.present) {
    F({
      rule: "no-llms-txt", severity: "medium", effort: 0.3,
      title: "llms.txt absent",
      proof: `GET ${origin}/llms.txt -> ${llms.status}. Ce fichier est la carte que les moteurs de reponse lisent en premier pour comprendre l'offre et les pages qui font autorite.`,
      fix: "Publier /llms.txt: un titre H1 de marque, un resume d'une phrase, puis les liens vers les pages cles avec une description par lien.",
      verifiability: "self-evident",
    });
  } else if (llms?.present) {
    const q = llmsQuality(llms.raw, origin);
    if (q.score < 60) {
      F({
        rule: "llms-txt-thin", severity: "low", effort: 0.2,
        title: "llms.txt present mais peu exploitable",
        proof: `${q.lines} ligne(s), ${q.links} lien(s), ${q.describedLinks} lien(s) decrits, ${q.words} mots.${q.missing.length ? " Manque: " + q.missing.join(", ") + "." : ""}`,
        fix: "Structurer llms.txt: # Nom de marque, > resume en une phrase, puis des sections ## avec des liens markdown decrits.",
        verifiability: "self-evident",
      });
    } else {
      strengths.push(`llms.txt structure et exploitable (${q.links} liens decrits)`);
    }
  }

  // --- 3. Citabilite au niveau passage (25) ------------------------------------------------
  // Un moteur de reponse ne cite pas une page, il cite un PASSAGE. On mesure donc
  // ce qui est extractible tel quel: blocs question/reponse autoportants, faits
  // chiffres, definitions.
  let totalQuestions = 0, totalCitable = 0, totalStats = 0, totalDefs = 0;
  const perPageCitability = [];
  for (const p of pages) {
    const ab = answerBlocks(p.headings || [], p.text);
    const sd = statDensity(p.text);
    const defs = definitionPatterns(p.text);
    totalQuestions += ab.total;
    totalCitable += ab.citable;
    totalStats += sd.stats;
    totalDefs += defs.length;
    perPageCitability.push({ p, ab, sd, defs });
  }
  const contentPages = perPageCitability.filter(({ p }) => wordsOf(p.text).length > 250);

  components.citability = clamp(
    (totalCitable > 0 ? 40 : 0)
    + Math.min(25, totalCitable * 5)
    + Math.min(20, totalStats * 2)
    + Math.min(15, totalDefs * 3)
  );

  if (contentPages.length && totalQuestions === 0) {
    F({
      rule: "no-answer-blocks", severity: "medium", effort: 0.6,
      title: "Aucun bloc question/reponse: rien a citer directement",
      proof: `${contentPages.length} page(s) de contenu analysee(s), aucun titre interrogatif de niveau h2/h3. Les moteurs de reponse extraient des passages delimites par un titre-question suivi d'une reponse courte.`,
      fix: "Ajouter des h2/h3 formules en question, chacun suivi d'une reponse autoportante de 15 a 70 mots.",
      verifiability: "self-evident",
    });
  } else if (totalQuestions > 0 && totalCitable === 0) {
    const example = perPageCitability.find(({ ab }) => ab.blocks.some((b) => b.found && !b.citable));
    const bad = example?.ab.blocks.find((b) => b.found && !b.citable);
    F({
      rule: "answers-not-citable", severity: "medium", effort: 0.5,
      title: `${totalQuestions} question(s) posee(s), aucune reponse de longueur citable`,
      url: example?.p.url,
      proof: bad ? `"${bad.question.slice(0, 60)}" -> reponse de ${bad.answerWords} mots. La fenetre exploitable est 15-70 mots: en dessous il n'y a pas de reponse, au-dessus le moteur resume au lieu de citer.` : `${totalQuestions} questions detectees.`,
      fix: "Faire suivre chaque titre-question d'un paragraphe de reponse autonome de 15 a 70 mots, avant tout developpement.",
      verifiability: "self-evident",
    });
  } else if (totalCitable) {
    strengths.push(`${totalCitable} bloc(s) question/reponse de longueur directement citable`);
  }

  if (contentPages.length && totalStats < 3) {
    F({
      rule: "low-stat-density", severity: "low", effort: 0.5,
      title: "Tres peu de faits chiffres: contenu peu citable",
      proof: `${totalStats} donnee(s) chiffree(s) avec unite sur ${contentPages.length} page(s) de contenu. Un moteur de reponse privilegie ce qui est precis et verifiable: "rapide" ne se cite pas, "en 90 secondes" se cite.`,
      fix: "Remplacer les qualificatifs par des mesures: duree, nombre, pourcentage, prix, date.",
      verifiability: "sampled",
    });
  } else if (totalStats >= 8) strengths.push(`${totalStats} faits chiffres exploitables comme citations`);

  // --- 4. Lisibilite structurelle (20) ---------------------------------------------------
  const readableScores = [];
  let longSentencePages = 0;
  for (const p of pages) {
    const r = readability(p.text, lang);
    if (r.score == null) continue;
    readableScores.push(r.score);
    if (r.longSentences >= 3) longSentencePages++;
  }
  const avgRead = readableScores.length ? Math.round(readableScores.reduce((a, b) => a + b, 0) / readableScores.length) : null;
  const structured = pages.filter((p) => (p.headings || []).filter((h) => h.level >= 2).length >= 3).length;
  components.readability = clamp(
    (avgRead == null ? 60 : Math.min(60, avgRead))
    + (pages.length ? (structured / pages.length) * 40 : 0)
  );

  if (avgRead != null && avgRead < 35) {
    F({
      rule: "low-readability", severity: "medium", effort: 0.6,
      title: `Lisibilite faible (${avgRead}/100): phrases difficiles a extraire`,
      proof: `Score moyen ${avgRead}/100 sur ${readableScores.length} page(s) (${lang === "en" ? "Flesch Reading Ease" : "Kandel-Moles"}). ${longSentencePages} page(s) contiennent au moins 3 phrases de plus de 35 mots.`,
      fix: "Raccourcir les phrases. Un moteur de reponse cite une phrase entiere ou rien: une phrase de 40 mots est inutilisable.",
      verifiability: "sampled",
      dimensions: ["geo", "content"],
    });
  } else if (avgRead != null && avgRead >= 50) strengths.push(`Lisibilite correcte (${avgRead}/100), phrases extractibles`);

  const flat = pages.filter((p) => wordsOf(p.text).length > 600 && (p.headings || []).filter((h) => h.level >= 2).length < 3);
  if (flat.length) {
    F({
      rule: "unstructured-long-content", severity: "medium", effort: 0.4,
      title: `${flat.length} page(s) longue(s) sans decoupage en sections`,
      url: flat[0].url,
      proof: flat.slice(0, 4).map((p) => `${short(p.url)}: ${wordsOf(p.text).length} mots pour ${(p.headings || []).filter((h) => h.level >= 2).length} titre(s) de section`).join(" | ") + ". Sans titres intermediaires, il n'y a pas de passage delimite a citer.",
      fix: "Decouper en sections de 150 a 300 mots, chacune sous un h2 ou h3 explicite.",
      verifiability: "self-evident",
    });
  }

  // --- 5. Fraicheur et multi-modal (15) ---------------------------------------------------
  const fresh = freshnessSignals(home?.html || "", home?.text || "");
  const hasTables = pages.some((p) => /<table\b/i.test(p.html || ""));
  const hasLists = pages.filter((p) => /<(ul|ol)\b/i.test(p.html || "")).length;
  const hasMedia = pages.some((p) => /<(video|audio|iframe)\b/i.test(p.html || ""));
  components.multimodal = clamp(
    (hasLists ? 40 : 0) + (hasTables ? 25 : 0) + (hasMedia ? 15 : 0) + (fresh.hasAny ? 20 : 0)
  );

  if (!fresh.hasAny) {
    F({
      rule: "no-freshness-signal", severity: "low", effort: 0.3,
      title: "Aucune date visible: fraicheur du contenu indeterminee",
      proof: "Ni <time datetime>, ni date en toutes lettres sur l'accueil. Les moteurs de reponse preferent citer une source datee, et affichent souvent la date a cote de la citation.",
      fix: "Afficher une date de publication et de derniere mise a jour, avec l'attribut datetime machine-lisible.",
      verifiability: "self-evident",
    });
  } else strengths.push("Dates machine-lisibles presentes (signal de fraicheur)");

  if (!hasTables && !hasLists) {
    F({
      rule: "no-structured-blocks", severity: "low", effort: 0.4,
      title: "Ni liste ni tableau: aucun bloc de donnees a extraire",
      proof: "Aucun <ul>, <ol> ou <table> dans les pages analysees. Listes et tableaux sont les formats les plus souvent repris tels quels dans une reponse IA.",
      fix: "Convertir les enumerations en listes et les comparaisons en tableaux.",
      verifiability: "self-evident",
    });
  }

  // --- Autorite et marque: delegue a la lane entite ----------------------------------------
  components.authority = ctx.entityScore ?? null;

  // --- Readiness par plateforme ---------------------------------------------------------
  const platforms = platformReadiness({ parsed, ssrOk, homeWords, llms: llms?.present, citable: totalCitable, schema: ctx.schema, deep });
  ctx.geoPlatforms = platforms;
  const blockedPlatforms = platforms.filter((p) => p.status === "bloque");
  if (blockedPlatforms.length) {
    F({
      rule: "ai-platform-blocked", severity: "high", effort: 0.2,
      title: `${blockedPlatforms.length} plateforme(s) de reponse IA ne peuvent pas citer le site`,
      proof: blockedPlatforms.map((p) => `${p.platform}: ${p.reason}`).join(" | "),
      fix: "Autoriser les crawlers de reponse temps reel dans robots.txt. C'est distinct de l'autorisation d'entrainement.",
      verifiability: "cross-checked",
    });
  }

  const geoScore = Math.round(
    (components.citability * 25 + components.readability * 20 + components.multimodal * 15
      + (components.authority ?? components.citability) * 20 + components.technical * 20) / 100
  );
  ctx.geo = { score: geoScore, components, platforms, totals: { questions: totalQuestions, citable: totalCitable, stats: totalStats, definitions: totalDefs, avgReadability: avgRead } };

  return { findings: out, strengths };
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// Qualite d'un llms.txt selon la convention: un H1 de marque, un resume en blockquote,
// des sections ##, des liens markdown decrits.
function llmsQuality(raw = "", origin) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const links = [...raw.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  const describedLinks = links.filter((m) => /:\s*\S/.test(raw.slice(m.index + m[0].length, m.index + m[0].length + 80))).length;
  const missing = [];
  if (!/^#\s+\S/m.test(raw)) missing.push("titre H1");
  if (!/^>\s+\S/m.test(raw)) missing.push("resume en blockquote");
  if (!/^##\s+\S/m.test(raw)) missing.push("sections ##");
  if (!links.length) missing.push("liens vers les pages cles");
  const words = (raw.match(/\S+/g) || []).length;
  const score = clamp(
    (/^#\s+\S/m.test(raw) ? 20 : 0) + (/^>\s+\S/m.test(raw) ? 20 : 0)
    + (/^##\s+\S/m.test(raw) ? 15 : 0) + Math.min(30, links.length * 6)
    + Math.min(15, describedLinks * 5)
  );
  return { score, lines: lines.length, links: links.length, describedLinks, words, missing };
}

// Etat par plateforme. Chaque ligne dit ce qui bloque, pas juste un feu tricolore.
function platformReadiness({ parsed, ssrOk, homeWords, llms, citable, schema, deep }) {
  const can = (ua) => (parsed ? isAllowed(parsed, ua, "/").allowed : true);
  const rows = [];
  const jsNote = ssrOk ? null : `contenu rendu cote client (${homeWords} mots dans le HTML servi)`;

  const build = (platform, uas, extras = []) => {
    const blocked = uas.filter((u) => !can(u));
    const reasons = [];
    if (blocked.length) reasons.push(`${blocked.join(", ")} bloque(s) dans robots.txt`);
    if (jsNote) reasons.push(jsNote);
    reasons.push(...extras.filter(Boolean));
    return {
      platform,
      crawlers: uas,
      status: blocked.length ? "bloque" : reasons.length ? "partiel" : "pret",
      reason: reasons.length ? reasons.join("; ") : "crawlers autorises et contenu present dans le HTML servi",
    };
  };

  rows.push(build("Google AI Overviews", ["Googlebot"], [citable ? null : "aucun bloc question/reponse citable"]));
  rows.push(build("ChatGPT Search", ["OAI-SearchBot", "ChatGPT-User"], [llms ? null : "llms.txt absent"]));
  rows.push(build("Perplexity", ["PerplexityBot", "Perplexity-User"], [citable ? null : "aucun bloc question/reponse citable"]));
  rows.push(build("Microsoft Copilot", ["Bingbot"], [
    // Copilot se sert de l'index Bing: la soumission IndexNow est le levier propre.
    deep?.robots?.parsed?.sitemaps?.length ? null : "aucun sitemap declare pour l'indexation Bing",
  ]));
  rows.push(build("Claude", ["Claude-User"], []));
  rows.push(build("Gemini", ["Googlebot", "Google-Extended"], []));
  return rows;
}
