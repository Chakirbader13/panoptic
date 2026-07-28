// Panoptic SEO KING - lane ecart HTML brut / DOM rendu.
//
// Le web s'est coupe en deux et les outils d'audit ne l'ont pas suivi:
//   - Googlebot EXECUTE le JavaScript. Ce qu'il indexe, c'est le DOM rendu.
//   - Les crawlers des moteurs de reponse (GPTBot, PerplexityBot, ClaudeBot) ne
//     l'executent PAS. Ce qu'ils lisent, c'est le HTML brut servi par le serveur.
//
// Un site peut donc etre parfait pour Google et invisible pour ChatGPT, sans qu'aucun
// audit mono-vue ne le voie. Cette lane compare les deux etats et traduit chaque ecart
// en PUBLIC CONCERNE, pas en jargon: "visible par Google, invisible pour les moteurs
// de reponse" est une phrase que le client peut arbitrer.
//
// Piege traite explicitement: le navigateur normalise le HTML en silence (URLs
// relatives resolues en absolu, entites decodees, balises reparees). Comparer les
// chaines brutes annoncerait un changement sur tout site normal. On ne compare donc
// que des donnees deja normalisees a l'extraction, et JAMAIS du texte brut.
//
// Ce qui n'est PAS un defaut: qu'une application monopage ait plus de texte apres
// rendu. C'est la definition meme du rendu client. On le chiffre en contexte, on ne
// le compte pas comme une faute.

export const id = "render-delta";

export function run(ctx) {
  const { scope, graph, render } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["technical"], url: scope.url, ...r });

  if (!render) return { findings: out, strengths, skipped: "rendu navigateur non demande sur cet audit" };
  if (!render.available) {
    F({
      rule: "render-not-available", severity: "info", effort: 0,
      title: "Ecart HTML brut / DOM rendu non mesure (navigateur indisponible)",
      proof: `${render.reason || "Playwright absent de cet environnement"}. L'audit ne peut donc pas dire ce que Googlebot voit en plus des moteurs de reponse IA.`,
      fix: "Lancer l'audit sur un environnement disposant de Chromium pour obtenir la comparaison.",
      verifiability: "inconclusive",
    });
    return { findings: out, strengths, skipped: "navigateur indisponible" };
  }

  const pairs = graph.list().filter((n) => n.rendered && n.raw);
  if (!pairs.length) return { findings: out, strengths, skipped: "aucune page rendue a comparer" };

  const sampleNote = `Compare sur ${pairs.length} page(s) rendue(s) dans Chromium.`;

  // --- 1. Donnees structurees injectees par JavaScript ---------------------------------
  // L'ecart le plus sous-estime. Un moteur de reponse deduit mal la nature d'une page
  // sans balisage: si le JSON-LD n'arrive qu'apres rendu, l'entite disparait pour lui,
  // alors que Google la voit parfaitement et que tout semble donc normal.
  const jsonldJsOnly = pairs.filter((n) => typeSet(n.raw).size === 0 && typeSet(n.rendered).size > 0);
  if (jsonldJsOnly.length) {
    const ex = jsonldJsOnly[0];
    F({
      rule: "jsonld-js-only", severity: "high", effort: 0.5,
      url: ex.url,
      title: `Donnees structurees injectees par JavaScript sur ${jsonldJsOnly.length} page(s)`,
      proof: `${sampleNote} ${short(ex.url)}: aucun bloc JSON-LD dans le HTML servi, ${[...typeSet(ex.rendered)].join(", ")} apres rendu. Google les lit, les moteurs de reponse IA n'executent pas JavaScript et ne les verront jamais.`,
      fix: "Emettre le JSON-LD directement dans le HTML servi (rendu serveur ou pre-rendu) plutot que via un gestionnaire de balises.",
      verifiability: "cross-checked",
      dimensions: ["schema", "geo"],
      audience: "moteurs de reponse IA",
    });
  }

  // --- 2. Canonical qui change entre le brut et le rendu ---------------------------------
  // Le plus dangereux cote Google: deux URL canoniques contradictoires font hesiter
  // l'indexation, et la page reste en "detectee, non indexee".
  const canonChanged = pairs.filter((n) => n.raw.canonical && n.rendered.canonical && n.raw.canonical !== n.rendered.canonical);
  if (canonChanged.length) {
    const ex = canonChanged[0];
    F({
      rule: "canonical-mismatch-render", severity: "critical", effort: 0.3,
      url: ex.url,
      title: `Canonical differente avant et apres rendu sur ${canonChanged.length} page(s)`,
      proof: `${sampleNote} ${short(ex.url)}: HTML servi -> ${ex.raw.canonical}, DOM rendu -> ${ex.rendered.canonical}. Les deux valeurs sont normalisees en absolu, l'ecart n'est donc pas un artefact de resolution d'URL. Face a deux canoniques contradictoires, Google choisit seul, ou n'indexe pas.`,
      fix: "N'emettre la canonical qu'a un seul endroit, cote serveur. Ne jamais la reecrire en JavaScript.",
      verifiability: "cross-checked",
      audience: "moteurs de recherche",
    });
  }

  const canonJsOnly = pairs.filter((n) => !n.raw.canonical && n.rendered.canonical);
  if (canonJsOnly.length) {
    F({
      rule: "canonical-js-only", severity: "high", effort: 0.3,
      url: canonJsOnly[0].url,
      title: `Canonical posee uniquement par JavaScript sur ${canonJsOnly.length} page(s)`,
      proof: `${sampleNote} Exemple ${short(canonJsOnly[0].url)}: aucune canonical dans le HTML servi, ${canonJsOnly[0].rendered.canonical} apres rendu. Le signal depend alors du bon deroulement du rendu.`,
      fix: "Emettre la canonical cote serveur, dans le HTML initial.",
      verifiability: "cross-checked",
      audience: "moteurs de recherche",
    });
  }

  // --- 3. Titre et description ------------------------------------------------------------
  // Piege classique des applications monopage: le HTML servi porte le titre du shell,
  // identique sur toutes les URL. Google le corrige au rendu, les moteurs de reponse
  // voient un site entier ou chaque page s'appelle pareil.
  const titleChanged = pairs.filter((n) => norm(n.raw.title) !== norm(n.rendered.title) && n.rendered.title);
  if (titleChanged.length) {
    const rawTitles = new Set(titleChanged.map((n) => norm(n.raw.title)));
    const shellShared = titleChanged.length > 1 && rawTitles.size === 1;
    const ex = titleChanged[0];
    F({
      rule: shellShared ? "shell-title-shared" : "title-js-only",
      severity: shellShared ? "high" : "medium",
      effort: 0.4,
      url: ex.url,
      title: shellShared
        ? `Toutes les pages servent le meme titre avant rendu ("${ex.raw.title || "(vide)"}")`
        : `Titre reecrit par JavaScript sur ${titleChanged.length} page(s)`,
      proof: `${sampleNote} ${short(ex.url)}: HTML servi -> "${ex.raw.title || "(vide)"}", DOM rendu -> "${ex.rendered.title}".`
        + (shellShared ? ` Les ${titleChanged.length} pages comparees partagent ce meme titre dans le HTML servi: pour un crawler qui n'execute pas JavaScript, le site n'a qu'une seule page.` : ""),
      fix: "Rendre le titre cote serveur pour chaque URL.",
      verifiability: "cross-checked",
      dimensions: ["onpage", "geo"],
      audience: "moteurs de reponse IA",
    });
  }

  const descJsOnly = pairs.filter((n) => !norm(n.raw.desc) && norm(n.rendered.desc));
  if (descJsOnly.length) {
    F({
      rule: "meta-desc-js-only", severity: "low", effort: 0.3,
      title: `Meta description ajoutee par JavaScript sur ${descJsOnly.length} page(s)`,
      proof: `${sampleNote} Exemple ${short(descJsOnly[0].url)}: absente du HTML servi, presente apres rendu.`,
      fix: "Emettre la meta description cote serveur.",
      verifiability: "cross-checked",
      dimensions: ["onpage", "geo"],
      audience: "moteurs de reponse IA",
    });
  }

  // --- 4. Maillage interne qui n'existe qu'apres rendu ---------------------------------------
  // Si la navigation est construite en JavaScript, un crawler qui ne rend pas ne
  // decouvre jamais les pages profondes: elles n'existent pas pour lui.
  let rawLinks = 0, renderedLinks = 0;
  const linkGap = [];
  for (const n of pairs) {
    const a = linkSet(n.raw), b = linkSet(n.rendered);
    rawLinks += a.size; renderedLinks += b.size;
    const onlyRendered = [...b].filter((u) => !a.has(u));
    if (onlyRendered.length >= 5 && onlyRendered.length > a.size) linkGap.push({ n, onlyRendered });
  }
  if (linkGap.length) {
    const ex = linkGap[0];
    F({
      rule: "internal-links-js-only", severity: "high", effort: 0.6,
      url: ex.n.url,
      title: `Maillage interne construit en JavaScript sur ${linkGap.length} page(s)`,
      proof: `${sampleNote} ${short(ex.n.url)}: ${linkSet(ex.n.raw).size} lien(s) interne(s) dans le HTML servi contre ${linkSet(ex.n.rendered).size} apres rendu. Exemples decouvrables seulement apres rendu: ${ex.onlyRendered.slice(0, 4).map(short).join(", ")}.`,
      fix: "Servir les liens de navigation en HTML (balises <a href>), quitte a les enrichir ensuite en JavaScript.",
      verifiability: "cross-checked",
      dimensions: ["architecture", "geo"],
      audience: "moteurs de reponse IA",
    });
  }

  // --- 5. Directive d'indexation injectee au rendu ---------------------------------------------
  // Le cas le plus vicieux: la page est indexable dans le HTML servi et se desindexe
  // toute seule apres rendu. Aucun audit sans navigateur ne peut le voir.
  const noindexInjected = pairs.filter((n) => !n.raw.noindex && n.rendered.noindex);
  if (noindexInjected.length) {
    F({
      rule: "noindex-injected-by-js", severity: "critical", effort: 0.3,
      url: noindexInjected[0].url,
      title: `${noindexInjected.length} page(s) deviennent noindex APRES execution du JavaScript`,
      proof: `${sampleNote} ${short(noindexInjected[0].url)}: aucune directive noindex dans le HTML servi, noindex present dans le DOM rendu. Google rend la page avant d'indexer: il verra le noindex et la retirera.`,
      fix: "Retirer l'injection de noindex cote client, ou l'assumer aussi cote serveur si la desindexation est voulue.",
      verifiability: "cross-checked",
      audience: "moteurs de recherche",
    });
  }

  // --- 6. Volume de contenu: CONTEXTE, pas defaut ------------------------------------------------
  // Une application monopage a forcement plus de texte apres rendu. Ce n'est pas une
  // faute, c'est son fonctionnement. On le chiffre pour que le lecteur sache de quel
  // cote du web il se trouve, et on n'en fait jamais une severite.
  const totalRaw = pairs.reduce((s, n) => s + (n.raw.words || 0), 0);
  const totalRendered = pairs.reduce((s, n) => s + (n.rendered.words || 0), 0);
  const ratio = totalRendered ? Math.round((totalRaw / totalRendered) * 100) : 100;
  ctx.renderDelta = {
    pages: pairs.length, rawWords: totalRaw, renderedWords: totalRendered, visibleRatio: ratio,
    rawLinks, renderedLinks,
    jsonldJsOnly: jsonldJsOnly.length, canonChanged: canonChanged.length,
    titleChanged: titleChanged.length, linkGap: linkGap.length, noindexInjected: noindexInjected.length,
  };

  if (ratio < 40) {
    F({
      rule: "content-mostly-js", severity: "info", effort: 0,
      title: `Seuls ${ratio}% du contenu sont presents avant execution du JavaScript`,
      proof: `${sampleNote} ${totalRaw} mots dans le HTML servi contre ${totalRendered} apres rendu. Google rend et voit tout; les moteurs de reponse IA lisent le HTML servi et ne voient que cette fraction.`,
      fix: "Constat de contexte, pas un defaut en soi: c'est le fonctionnement normal d'une application monopage. Il devient un probleme si la visibilite dans les moteurs de reponse compte pour vous.",
      verifiability: "cross-checked",
      dimensions: ["geo"],
      audience: "moteurs de reponse IA",
    });
  } else if (ratio >= 90) {
    strengths.push(`${ratio}% du contenu est present dans le HTML servi: lisible par les crawlers qui n'executent pas JavaScript`);
  }

  if (!jsonldJsOnly.length && !canonChanged.length && !linkGap.length && !noindexInjected.length && ratio >= 90) {
    strengths.push("Aucun signal SEO ne depend de l'execution du JavaScript");
  }

  return { findings: out, strengths };
}

// --- Comparaisons sur donnees NORMALISEES uniquement -----------------------------------
// Types Schema.org declares, pas les chaines JSON-LD: le navigateur reformate le
// contenu des balises script, un diff textuel serait un generateur de faux positifs.
function typeSet(facts) {
  const out = new Set();
  for (const block of facts.jsonld || []) {
    for (const m of String(block).matchAll(/"@type"\s*:\s*"([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

// URLs internes absolues, deja resolues a l'extraction des deux cotes.
function linkSet(facts) {
  return new Set((facts.internalLinks || []).map((l) => l.abs).filter(Boolean));
}

// Repliage typographique avant comparaison. Sans lui, un site qui remplace ses
// apostrophes droites par des apostrophes typographiques au rendu serait signale comme
// "titre reecrit par JavaScript": techniquement vrai, semantiquement vide, donc du
// bruit. On ne veut signaler que les reecritures qui CHANGENT le sens.
function norm(s) {
  return String(s || "")
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")      // apostrophes courbes
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')       // guillemets
    .replace(/[\u2013\u2014\u2212]/g, "-")             // tirets longs
    .replace(/\u2026/g, "...")                         // points de suspension
    .replace(/[\u00a0\u202f\u2009]/g, " ")             // espaces insecables
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
