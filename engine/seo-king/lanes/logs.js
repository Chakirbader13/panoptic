// Panoptic SEO KING - lane logs serveur (conditionnelle).
//
// C'est la seule source qui dit ce que les moteurs ont REELLEMENT fait, au lieu de ce
// qu'ils devraient faire. Le crawl simule, la Search Console resume et lisse, les logs
// constatent. Cinq choses n'existent que la:
//   1. le budget d'exploration reellement depense, et sur quoi il est gaspille;
//   2. les orphelines ACTIVES, que Google revisite alors que le site les a oubliees;
//   3. les 5xx furtifs, qui n'apparaissent que sous la charge d'un moteur;
//   4. les pages declarees au sitemap qu'aucun moteur n'est venu chercher;
//   5. le passage effectif des crawlers de moteurs de reponse IA.
//
// Le point 5 est ce qui relie cette lane au reste du produit: la lane citations mesure
// si le site est CITE, celle-ci mesure si les robots qui alimentent ces moteurs sont
// seulement PASSES. Un site jamais visite par GPTBot ne sera jamais cite par ChatGPT,
// et aucune optimisation de contenu n'y changera quoi que ce soit.

import { streamLog } from "../logs/parse.js";
import { createAggregator, crossReference, topStatuses } from "../logs/analyze.js";
import { verifySample, BOTS } from "../logs/bots.js";
import { existsSync } from "node:fs";

export const id = "logs";

export async function run(ctx) {
  const { scope, graph, deep, options = {} } = ctx;
  const out = [];
  const strengths = [];
  const F = (r) => out.push({ dimensions: ["technical"], url: scope.url, ...r });

  const file = options.logFile || scope.logFile || null;
  if (!file) {
    return { findings: out, strengths, skipped: "aucun fichier de logs fourni (option --logs)" };
  }
  if (!existsSync(file)) {
    F({
      rule: "logs-file-missing", severity: "info", effort: 0,
      title: "Fichier de logs introuvable",
      proof: `Chemin fourni: ${file}. Aucune analyse de logs n'a donc eu lieu.`,
      fix: "Verifier le chemin du fichier. Formats acceptes: Combined/NCSA, JSON par ligne, W3C etendu, gzippe ou non.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths, skipped: "fichier introuvable" };
  }

  // --- Lecture en flux -------------------------------------------------------------
  const agg = createAggregator();
  let stats;
  try {
    stats = await streamLog(file, (e) => agg.add(e), { maxLines: options.logMaxLines || 5_000_000 });
  } catch (e) {
    F({
      rule: "logs-unreadable", severity: "info", effort: 0,
      title: "Logs illisibles",
      proof: `${String(e.message || e).slice(0, 180)}. Aucun chiffre n'est publie plutot qu'un chiffre faux.`,
      fix: "Fournir un export non corrompu, au format Combined, JSON par ligne ou W3C.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths };
  }

  const r = agg.result();
  if (!stats.parsed) {
    F({
      rule: "logs-format-unrecognized", severity: "info", effort: 0,
      title: "Format de logs non reconnu",
      proof: `${stats.lines} ligne(s) lues, aucune exploitable. Formats supportes: Combined/NCSA, JSON par ligne, W3C etendu.`,
      fix: "Exporter les logs dans l'un de ces formats.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths };
  }

  const period = stats.firstTime && stats.lastTime
    ? `${new Date(stats.firstTime).toISOString().slice(0, 10)} au ${new Date(stats.lastTime).toISOString().slice(0, 10)}`
    : "periode non datee";
  const days = stats.firstTime && stats.lastTime ? Math.max(1, Math.round((stats.lastTime - stats.firstTime) / 86400000)) : null;
  const base = `${stats.parsed.toLocaleString("fr-FR")} requetes analysees (${period}, format ${stats.format})`;

  if (!r.totals.botEntries) {
    F({
      rule: "logs-no-bot-traffic", severity: "medium", effort: 0.2,
      title: "Aucun passage de robot dans les logs fournis",
      proof: `${base}. Aucune requete identifiee comme provenant d'un moteur de recherche ou de reponse. Soit l'extrait est trop court, soit les robots n'atteignent pas ce serveur (CDN qui absorbe leur trafic en amont).`,
      fix: "Fournir un extrait plus long, ou exporter les logs depuis le CDN plutot que depuis l'origine.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths, skipped: "aucun trafic de robot" };
  }

  // --- Verification des robots: le user-agent est declaratif ------------------------
  const verdicts = await verifySample(r.byBot, { perBot: 3 });
  ctx.logVerdicts = verdicts;
  const spoofed = Object.entries(verdicts).filter(([, v]) => v.verdict === "usurpe");
  if (spoofed.length) {
    const [botId, v] = spoofed[0];
    const bot = r.byBot[botId];
    F({
      rule: "spoofed-bot-traffic", severity: "medium", effort: 0.3,
      title: `Trafic usurpant ${bot.label}: ${bot.hits.toLocaleString("fr-FR")} requete(s)`,
      proof: `${base}. Les IP les plus actives se declarant ${bot.label} echouent au double controle DNS: ${v.samples.map((s) => `${s.ip} (${s.reason || s.state})`).join(", ")}. Ce trafic n'est PAS le moteur; le compter fausserait toute mesure de budget d'exploration.`,
      fix: "Filtrer ou limiter ce trafic. Il consomme des ressources sans aucune contrepartie d'indexation.",
      verifiability: "cross-checked",
      dimensions: ["technical"],
    });
  }
  const authentic = Object.entries(verdicts).filter(([, v]) => v.verdict === "authentique").map(([id]) => r.byBot[id]?.label).filter(Boolean);
  if (authentic.length) strengths.push(`Passage authentifie par double controle DNS: ${authentic.join(", ")}`);

  // --- Croisement avec ce que l'audit sait du site -----------------------------------
  const sitemapUrls = (deep?.sitemapEntries || []).map((e) => e.loc);
  const x = crossReference(r, graph, sitemapUrls);
  ctx.logs = { stats, totals: r.totals, byBot: summarizeBots(r.byBot), cross: x, verdicts, period, days };

  // --- 1. Budget d'exploration gaspille ------------------------------------------------
  if (x.engineTotals.hits > 50 && x.wasteRatio >= 30) {
    const t = x.engineTotals;
    F({
      rule: "crawl-budget-waste", severity: x.wasteRatio >= 60 ? "high" : "medium", effort: 0.6,
      title: `${x.wasteRatio}% du budget d'exploration part dans des URL sans valeur`,
      proof: `${base}. Sur ${t.hits.toLocaleString("fr-FR")} visites de moteur: ${t.params} sur des URL a parametres, ${t.redirects} sur des redirections, ${t.notFound} sur des 404. Un crawler d'audit ignore poliment ces URL: seuls les logs les revelent.`,
      fix: "Bloquer les parametres inutiles dans robots.txt, canonicaliser les variantes a facettes, et corriger les redirections en chaine.",
      verifiability: "cross-checked",
      dimensions: ["technical", "architecture"],
    });
  } else if (x.engineTotals.hits > 50) {
    strengths.push(`Budget d'exploration sain: ${100 - x.wasteRatio}% des visites de moteur portent sur des pages utiles`);
  }

  // --- 2. Orphelines ACTIVES ------------------------------------------------------------
  if (x.activeOrphans.length) {
    F({
      rule: "active-orphan-pages", severity: "medium", effort: 0.5,
      title: `${x.activeOrphans.length} URL visitees par les moteurs mais inconnues du site`,
      proof: `${base}. Ni au sitemap, ni dans le maillage interne, ni trouvees au crawl, et pourtant explorees: ${x.activeOrphans.slice(0, 5).map((o) => `${o.path} (${o.hits}x)`).join(", ")}. Ce sont presque toujours d'anciennes URL jamais redirigees.`,
      fix: "Rediriger en 301 vers l'equivalent actuel, ou renvoyer un 410 si le contenu a disparu pour de bon.",
      verifiability: "cross-checked",
      dimensions: ["architecture"],
    });
  }

  // --- 3. Erreurs serveur furtives --------------------------------------------------------
  const with5xx = Object.values(r.byBot).filter((b) => b.serverErrors > 0);
  if (with5xx.length) {
    const worst = with5xx.sort((a, b) => b.serverErrors - a.serverErrors)[0];
    F({
      rule: "stealth-server-errors", severity: "high", effort: 0.5,
      title: `${worst.serverErrors} erreur(s) serveur servie(s) a ${worst.label}`,
      proof: `${base}. Statuts renvoyes a ${worst.label}: ${topStatuses(worst.statuses).join(", ")}. Le crawl d'audit, plus lent et moins parallele, ne les declenche pas: elles n'apparaissent que sous la charge reelle d'un moteur.`,
      fix: "Correler ces horodatages avec les journaux applicatifs. Une 5xx servie a un moteur fait chuter la frequence d'exploration.",
      verifiability: "cross-checked",
    });
  }

  // --- 4. Declarees au sitemap, jamais explorees ---------------------------------------------
  if (x.neverCrawled.length && x.sitemapCount > 0) {
    F({
      rule: "sitemap-never-crawled", severity: "medium", effort: 0.4,
      title: `${x.neverCrawled.length} URL du sitemap qu'aucun moteur n'est venu chercher`,
      proof: `${base}. Declarees mais jamais visitees sur la periode: ${x.neverCrawled.slice(0, 5).join(", ")}. Couverture d'exploration du sitemap: ${x.coverage}%.`,
      fix: "Rapprocher ces pages de l'accueil et leur donner des liens internes: une URL que rien ne lie est exploree en dernier, voire jamais.",
      verifiability: "cross-checked",
      dimensions: ["architecture"],
    });
  } else if (x.coverage != null && x.coverage >= 90) {
    strengths.push(`${x.coverage}% des URL du sitemap ont ete explorees par un moteur sur la periode`);
  }

  // --- 5. Les crawlers de moteurs de reponse IA sont-ils seulement passes ? -----------------
  const aiBots = Object.values(r.byBot).filter((b) => b.kind === "ai-search" || b.kind === "ai-train");
  const aiSearch = aiBots.filter((b) => b.kind === "ai-search");
  if (!aiBots.length) {
    F({
      rule: "ai-crawlers-never-came", severity: "high", effort: 0.8,
      title: "Aucun crawler de moteur de reponse IA n'est passe sur la periode",
      proof: `${base}. Aucune visite de GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot ni Google-Extended. Un site que ces robots ne visitent pas ne peut pas etre cite par les moteurs qu'ils alimentent, quel que soit son contenu.`,
      fix: "Verifier que robots.txt ne les bloque pas, que le serveur ne filtre pas leurs plages d'IP, et publier un llms.txt pour signaler les pages a explorer.",
      verifiability: "cross-checked",
      dimensions: ["geo"],
      indicator: "premiere visite d'un crawler de reponse dans les logs du mois suivant",
    });
  } else {
    const list = aiBots.sort((a, b) => b.hits - a.hits).map((b) => `${b.label} ${b.hits}x`).join(", ");
    strengths.push(`Crawlers IA actifs sur la periode: ${list}`);
    if (!aiSearch.length) {
      F({
        rule: "ai-search-crawlers-absent", severity: "medium", effort: 0.5,
        title: "Seuls des robots d'entrainement IA passent, aucun robot de reponse en direct",
        proof: `${base}. Presents: ${aiBots.map((b) => b.label).join(", ")}. Absents: les crawlers qui alimentent les reponses en temps reel (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User). Etre collecte pour l'entrainement n'est pas etre cite dans une reponse.`,
        fix: "Verifier robots.txt: beaucoup de sites bloquent sans le vouloir les robots de reponse en croyant ne bloquer que l'entrainement.",
        verifiability: "cross-checked",
        dimensions: ["geo"],
      });
    }
  }

  // --- Gabarits qui absorbent le budget --------------------------------------------------------
  const hog = x.topTemplates.find((t) => t.hits > x.engineTotals.hits * 0.3 && t.template.includes("{"));
  if (hog && x.engineTotals.hits > 100) {
    F({
      rule: "template-crawl-hog", severity: "medium", effort: 0.5,
      title: `Un seul gabarit d'URL absorbe ${Math.round((hog.hits / Math.max(1, r.totals.botEntries)) * 100)}% des visites de robot`,
      proof: `${base}. Gabarit ${hog.template}: ${hog.hits.toLocaleString("fr-FR")} visites, ${hog.errors} en erreur. Les autres sections du site se partagent le reste.`,
      fix: "Verifier que ce gabarit merite ce budget. Si ce sont des facettes ou des variantes, les canonicaliser ou les fermer a l'exploration.",
      verifiability: "cross-checked",
      dimensions: ["architecture"],
    });
  }

  if (r.pathsTruncated) {
    F({
      rule: "logs-partial-coverage", severity: "info", effort: 0,
      title: "Analyse de logs partielle: trop d'URL distinctes",
      proof: `Plus de 50 000 chemins differents rencontres. Les comptes portent sur les premiers vus, pas sur la totalite. Les taux restent representatifs, les listes d'exemples ne sont pas exhaustives.`,
      fix: "Fournir un extrait plus cible (une section, une periode plus courte) pour une analyse exhaustive.",
      verifiability: "self-evident",
    });
  }

  return { findings: out, strengths };
}

function summarizeBots(byBot) {
  const out = {};
  for (const [id, b] of Object.entries(byBot)) {
    out[id] = {
      label: b.label, kind: b.kind, hits: b.hits, bytes: b.bytes,
      uniquePaths: b.paths.size, uniqueIps: b.ips.size,
      params: b.params, errors: b.errors, notFound: b.notFound, serverErrors: b.serverErrors, redirects: b.redirects,
      first: b.first, last: b.last,
      statuses: [...b.statuses.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 5),
    };
  }
  return out;
}
