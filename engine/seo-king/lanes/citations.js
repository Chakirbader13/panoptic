// Panoptic SEO KING - lane citations IA (mesure reelle, conditionnelle).
//
// La lane GEO repond a "ce site est-il CITABLE". Celle-ci repond a "ce site est-il
// CITE". Ce sont deux questions differentes et seule la seconde est une mesure.
//
// Elle ne se declenche que si l'operateur a configure des cles de moteur de reponse
// ET demande explicitement la mesure: ce sont des appels payants, ils ne doivent
// jamais partir par surprise sur un scan gratuit.
//
// Statut epistemique assume: contrairement au reste du moteur, ces constats ne sont
// pas reproductibles a l'identique (une IA ne repond pas deux fois pareil). Ils sont
// donc emis en "sampled", avec l'echantillon et la date dans la preuve, et jamais
// presentes comme une verite stable.

import { derivePrompts, deriveCategory } from "../citations/prompts.js";
import { measureCitations } from "../citations/measure.js";
import { availableProviders } from "../citations/providers.js";
import { extractBlocks, validate, findNode } from "../jsonld.js";

export const id = "citations";

export async function run(ctx) {
  const { scope, graph, options = {} } = ctx;
  const out = [];
  const strengths = [];
  const F = (r) => out.push({ dimensions: ["geo"], url: scope.url, ...r });

  const env = options.env || process.env;
  const known = availableProviders(env);
  const usable = known.filter((p) => p.available);
  const enabled = options.citations === true || options.citations === "on";

  if (!enabled) {
    return {
      findings: out, strengths,
      skipped: usable.length
        ? "mesure des citations non demandee sur cet audit (appels payants, activation explicite requise)"
        : "mesure des citations non demandee et aucune cle configuree",
    };
  }

  if (!usable.length) {
    F({
      rule: "citations-not-measured", severity: "info", effort: 0,
      title: "Citations dans les moteurs de reponse IA non mesurees",
      proof: `Aucune cle configuree. Fournisseurs supportes: ${known.map((k) => `${k.provider.label} (${k.provider.envKeys[0]})`).join(", ")}. Sans cle, cet audit ne peut evaluer que l'APTITUDE a etre cite, pas la citation reelle.`,
      fix: "Configurer au moins une cle de moteur de reponse pour transformer l'estimation de citabilite en mesure.",
      verifiability: "inconclusive",
    });
    return { findings: out, strengths, skipped: "aucune cle de moteur de reponse configuree" };
  }

  // --- Marque et categorie, derivees du site lui-meme ---------------------------------
  const home = graph.get(scope.url);
  const brand = deriveBrand(home, scope);
  const lang = home?.derived?.lang || home?.lang?.slice(0, 2) || "fr";
  // La categorie peut etre imposee par l'operateur: c'est une donnee metier, comme
  // les parametres de chiffrage. La derivation automatique n'est qu'un defaut.
  const category = options.category || deriveCategory(graph, brand, lang);

  if (!brand) {
    F({
      rule: "citations-no-brand", severity: "medium", effort: 0.2,
      title: "Impossible d'identifier le nom de marque: mesure de citation non fiable",
      proof: "Ni schema Organization.name, ni og:site_name, ni suffixe de <title> exploitable. Sans nom d'entite stable, on ne peut pas savoir si une IA parle bien de ce site.",
      fix: "Declarer un nom de marque unique dans le schema Organization et og:site_name.",
      verifiability: "cross-checked",
      dimensions: ["geo", "entity"],
    });
    return { findings: out, strengths, skipped: "nom de marque non identifiable" };
  }

  if (!category) {
    // Sans categorie fiable, on ne fabrique pas de question commerciale: une question
    // absurde produirait une mesure absurde. On mesure quand meme la marque et les
    // questions que le site pose lui-meme, et on dit ce qui manque.
    F({
      rule: "citations-category-unknown", severity: "info", effort: 0.1,
      title: "Categorie du site non deductible: mesure limitee a la marque et aux questions du site",
      proof: `Le <title> de l'accueil ne laisse pas apparaitre de categorie exploitable apres le nom de marque. Les questions commerciales ("meilleures solutions pour ...") ne sont donc pas posees.`,
      fix: 'Faire apparaitre la categorie dans le title de l\'accueil ("Marque - <categorie>"), ou la fournir en parametre d\'audit pour mesurer aussi la visibilite commerciale.',
      verifiability: "cross-checked",
    });
  }

  const prompts = derivePrompts({ brand, category, lang, graph, limit: options.citationPrompts || 8 });
  if (!prompts.length) return { findings: out, strengths, skipped: "aucun prompt derivable du site" };

  // Termes thematiques du site: ils servent a verifier qu'une reponse qui prononce le
  // nom de marque parle bien de CE site, et pas d'un homonyme.
  const topicTerms = siteTopicTerms(graph, brand);
  const measured = await measureCitations(prompts, {
    siteDomain: scope.host || scope.origin,
    brand, category, topicTerms,
    env,
    maxCalls: options.citationCalls || 24,
  });
  ctx.citations = measured;

  if (measured.state !== "observed") {
    F({
      rule: "citations-measurement-failed", severity: "info", effort: 0,
      title: "Mesure des citations IA impossible",
      proof: `${measured.reason}. Aucun chiffre n'est publie plutot qu'un chiffre faux.`,
      fix: "Verifier la validite des cles et les quotas des fournisseurs, puis relancer.",
      verifiability: "inconclusive",
    });
    return { findings: out, strengths };
  }

  const s = measured.sample;
  const scopeNote = `Mesure sur ${s.prompts} question(s) derivees du site, ${s.providers.join(" et ")}, ${s.successful} reponse(s) exploitables.`;

  // --- Le constat central: cite ou pas -------------------------------------------------
  if (measured.citationRate === 0) {
    const ahead = measured.competitorsAhead.slice(0, 5).map((c) => `${c.domain} (${c.count})`).join(", ");
    F({
      rule: "never-cited-by-ai",
      severity: measured.mentionRate > 0 ? "high" : "critical",
      effort: 1,
      title: measured.mentionRate > 0
        ? "La marque est evoquee par l'IA mais le site n'est jamais cite comme source"
        : "Le site n'est jamais cite par les moteurs de reponse IA",
      proof: `${scopeNote} Domaine ${measured.siteDomain} cite 0 fois.`
        + (measured.mentionRate > 0 ? ` La marque est pourtant nommee dans ${measured.mentionRate}% des reponses: l'IA la connait mais s'appuie sur d'autres sources.` : "")
        + (ahead ? ` Sources citees a la place: ${ahead}.` : ""),
      fix: measured.mentionRate > 0
        ? "Le probleme n'est pas la notoriete mais la citabilite: publier sur le site les faits chiffres et les reponses courtes que l'IA va chercher ailleurs."
        : "Rendre le contenu extractible (blocs question/reponse courts, faits chiffres, donnees structurees) et verifier l'acces des crawlers de reponse.",
      verifiability: "sampled",
      indicator: "taux de citation sur le meme jeu de questions au prochain audit",
    });
  } else {
    strengths.push(`Site cite dans ${measured.citationRate}% des reponses IA mesurees (${measured.citedCount}/${s.successful})`);
    if (measured.aheadCount > 0) {
      const ahead = measured.competitorsAhead.slice(0, 4).map((c) => `${c.domain} (${c.count}x)`).join(", ");
      F({
        rule: "outranked-in-ai-answers", severity: "medium", effort: 0.8,
        title: `${measured.aheadCount} source(s) citee(s) plus souvent que le site sur ses propres questions`,
        proof: `${scopeNote} ${measured.siteDomain} est cite ${measured.siteCount} fois. Strictement devant: ${ahead}.`
          + (measured.tiedCount ? ` ${measured.tiedCount} autre(s) source(s) sont a egalite.` : ""),
        fix: "Comparer le format des sources citees plus souvent: profondeur, structure des reponses, fraicheur, donnees chiffrees.",
        verifiability: "sampled",
        indicator: "nombre de sources strictement devant au prochain audit",
      });
    }
  }

  // --- Nom de marque ambigu ---------------------------------------------------------------
  // Le nom apparait dans les reponses mais celles-ci parlent d'autre chose. C'est un
  // probleme d'entite, pas de contenu: aucune optimisation de page ne le reglera.
  if (measured.ambiguousCount > 0 && measured.ambiguousCount >= measured.mentionCount) {
    const ex = measured.ambiguousSample[0];
    F({
      rule: "ambiguous-brand-name", severity: "high", effort: 1.5,
      title: `"${brand}" est un mot courant: les IA repondent sur autre chose`,
      proof: `${scopeNote} Le nom apparait dans ${measured.ambiguousRate}% des reponses, mais sans aucun signal du sujet du site (${measured.topicSignals.slice(0, 4).join(", ")}).`
        + (ex ? ` Exemple sur "${ex.prompt}": "${String(ex.excerpt).slice(0, 150)}".` : ""),
      fix: "Ancrer l'entite: toujours associer le nom a sa categorie dans les titres et la definition ("
        + `${brand}, ${category || "votre categorie"}"), declarer Organization avec description et sameAs, et viser les mentions externes qui levent l'ambiguite.`,
      verifiability: "sampled",
      dimensions: ["geo", "entity"],
      indicator: "part des reponses qui associent le nom au bon sujet",
    });
  }

  // --- Marque inconnue de l'IA -----------------------------------------------------------
  const brandPrompts = measured.observations.filter((o) => o.promptKind === "marque");
  if (brandPrompts.length && brandPrompts.every((o) => !o.mentioned && !o.cited) && !measured.ambiguousCount) {
    F({
      rule: "brand-unknown-to-ai", severity: "high", effort: 1.5,
      title: `Les moteurs de reponse ne connaissent pas la marque "${brand}"`,
      proof: `Interroges directement sur "${brandPrompts[0].prompt}", ${[...new Set(brandPrompts.map((o) => o.providerLabel))].join(" et ")} ne nomment pas la marque et ne citent pas son site.`,
      fix: "Construire l'entite avant d'optimiser les pages: definition canonique sur le site, schema Organization avec sameAs vers des profils officiels, presence sur les sources que ces moteurs citent deja.",
      verifiability: "sampled",
      dimensions: ["geo", "entity"],
      indicator: "apparition du nom de marque dans la reponse a la question d'entite",
    });
  } else if (brandPrompts.some((o) => o.mentioned)) {
    strengths.push(`La marque est identifiee par les moteurs de reponse interroges sur son nom`);
  }

  // --- Ecarts entre plateformes ------------------------------------------------------------
  const perProvider = Object.entries(measured.byProvider).filter(([, v]) => v.calls > 0);
  if (perProvider.length > 1) {
    const rates = perProvider.map(([, v]) => ({ label: v.label, rate: Math.round((v.cited / v.calls) * 100) }));
    const best = rates.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = rates.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.rate - worst.rate >= 40) {
      F({
        rule: "ai-platform-gap", severity: "medium", effort: 0.6,
        title: `Visibilite tres inegale selon le moteur: ${best.rate}% sur ${best.label}, ${worst.rate}% sur ${worst.label}`,
        proof: `${scopeNote} ` + rates.map((r) => `${r.label}: ${r.rate}%`).join(", ") + ". Les moteurs ne s'appuient pas sur le meme index ni sur les memes signaux.",
        fix: `Traiter ${worst.label} comme un canal a part: verifier l'acces de son crawler et la presence sur les sources qu'il privilegie.`,
        verifiability: "sampled",
      });
    }
  }

  // Erreurs partielles: on le dit plutot que de laisser croire a une mesure complete.
  const failedProviders = Object.entries(measured.byProvider).filter(([, v]) => v.errors > 0);
  if (failedProviders.length) {
    F({
      rule: "citations-partial-coverage", severity: "info", effort: 0,
      title: `Mesure incomplete: ${failedProviders.length} fournisseur(s) en erreur`,
      proof: failedProviders.map(([, v]) => `${v.label}: ${v.errors} appel(s) en echec (${v.errorSample})`).join(" | ") + ". Les taux publies ne portent que sur les reponses obtenues.",
      fix: "Verifier les quotas et la validite des cles pour obtenir une couverture complete.",
      verifiability: "inconclusive",
    });
  }

  return { findings: out, strengths };
}

// Termes qui caracterisent le sujet du site, pris sur ses propres pages. Sert de
// preuve d'attribution: si une reponse cite le nom de marque sans aucun de ces
// termes, elle ne parle probablement pas de ce site.
function siteTopicTerms(graph, brand) {
  const brandTokens = new Set(String(brand || "").toLowerCase().split(/\W+/).filter(Boolean));
  const df = new Map();
  let docs = 0;
  for (const p of graph.crawledPages()) {
    if (!p.topTerms?.length) continue;
    docs++;
    for (const [t] of p.topTerms.slice(0, 20)) {
      if (brandTokens.has(t) || t.length < 5) continue;
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  if (!docs) return [];
  return [...df.entries()]
    .filter(([, n]) => n >= Math.max(2, docs * 0.35))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);
}

// Nom de marque: meme derivation que la lane entite, pour que les deux parlent de la
// meme chose. Schema d'abord (declaration explicite), puis og:site_name, puis le
// suffixe du title.
function deriveBrand(home, scope) {
  if (!home) return null;
  if (home.html || home.jsonld?.length) {
    const blocks = home.html ? extractBlocks(home.html) : extractBlocks((home.jsonld || []).join("\n"));
    if (blocks.length) {
      const v = validate(blocks, scope.origin);
      const org = findNode(v.nodes, "Organization") || findNode(v.nodes, "LocalBusiness") || findNode(v.nodes, "Corporation");
      if (org?.name) return String(org.name).trim();
    }
  }
  const og = home.metas?.property?.["og:site_name"];
  if (og) return String(og).trim();
  const title = home.title || "";
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (last.length >= 2 && last.length <= 40) return last;
    const first = parts[0].trim();
    if (first.length >= 2 && first.length <= 40) return first;
  }
  return null;
}
