// Panoptic SEO KING - derivation DETERMINISTE du jeu de prompts.
//
// Point cle: les prompts ne sont ni ecrits a la main ni tires d'une liste generique.
// Ils sont derives du site audite lui-meme (sa marque, ses sections, ses propres
// titres interrogatifs, ses termes les plus distinctifs). Deux consequences:
//   - deux audits du meme site posent exactement les memes questions, donc les
//     mesures sont comparables dans le temps;
//   - on mesure la visibilite sur les questions que le site PRETEND traiter, pas sur
//     un panier de mots-cles arbitraire qui flatterait ou punirait au hasard.

const T = {
  fr: {
    what: (b) => `Qu'est-ce que ${b} ?`,
    review: (b) => `${b} : avis, qualite et fiabilite`,
    best: (c) => `Quelles sont les meilleures solutions pour ${c} ?`,
    how: (c) => `Comment choisir une solution pour ${c} ?`,
    alt: (b, c) => `Quelles sont les alternatives a ${b} pour ${c} ?`,
  },
  en: {
    what: (b) => `What is ${b}?`,
    review: (b) => `${b}: reviews, quality and reliability`,
    best: (c) => `What are the best solutions for ${c}?`,
    how: (c) => `How do you choose a solution for ${c}?`,
    alt: (b, c) => `What are the alternatives to ${b} for ${c}?`,
  },
  de: {
    what: (b) => `Was ist ${b}?`,
    review: (b) => `${b}: Bewertungen, Qualitat und Zuverlassigkeit`,
    best: (c) => `Was sind die besten Losungen fur ${c}?`,
    how: (c) => `Wie wahlt man eine Losung fur ${c}?`,
    alt: (b, c) => `Welche Alternativen zu ${b} gibt es fur ${c}?`,
  },
  es: {
    what: (b) => `Que es ${b}?`,
    review: (b) => `${b}: opiniones, calidad y fiabilidad`,
    best: (c) => `Cuales son las mejores soluciones para ${c}?`,
    how: (c) => `Como elegir una solucion para ${c}?`,
    alt: (b, c) => `Cuales son las alternativas a ${b} para ${c}?`,
  },
  it: {
    what: (b) => `Che cos'e ${b}?`,
    review: (b) => `${b}: recensioni, qualita e affidabilita`,
    best: (c) => `Quali sono le migliori soluzioni per ${c}?`,
    how: (c) => `Come scegliere una soluzione per ${c}?`,
    alt: (b, c) => `Quali sono le alternative a ${b} per ${c}?`,
  },
  nl: {
    what: (b) => `Wat is ${b}?`,
    review: (b) => `${b}: beoordelingen, kwaliteit en betrouwbaarheid`,
    best: (c) => `Wat zijn de beste oplossingen voor ${c}?`,
    how: (c) => `Hoe kies je een oplossing voor ${c}?`,
    alt: (b, c) => `Wat zijn de alternatieven voor ${b} voor ${c}?`,
  },
};

/**
 * @param ctx { brand, category, lang, graph }
 * @param limit nombre maximal de prompts (chaque prompt coute un appel PAR fournisseur)
 */
export function derivePrompts({ brand, category, lang = "fr", graph, limit = 8 }) {
  const t = T[lang] || T.fr;
  const out = [];
  const push = (kind, text, intent) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    if (!clean || out.some((p) => p.text.toLowerCase() === clean.toLowerCase())) return;
    out.push({ id: `p${out.length + 1}`, kind, text: clean, intent });
  };

  // 1. L'entite. Si une IA ne sait pas repondre a "qu'est-ce que X", la marque
  //    n'existe pas pour elle, et tout le reste est secondaire.
  if (brand) {
    push("marque", t.what(brand), "L'IA connait-elle l'entite et cite-t-elle son site ?");
    push("reputation", t.review(brand), "Que dit l'IA de la marque, et sur quelles sources ?");
  }

  // 2. La categorie: la vraie question commerciale. C'est la que la marque est
  //    recommandee ou remplacee par un concurrent.
  if (category) {
    push("categorie", t.best(category), "La marque est-elle citee parmi les references de sa categorie ?");
    push("consideration", t.how(category), "La marque apparait-elle a l'etape de comparaison ?");
    if (brand) push("alternative", t.alt(brand, category), "Qui l'IA propose-t-elle a la place ?");
  }

  // 3. Les questions que le site pose lui-meme. Ce sont exactement celles sur
  //    lesquelles il revendique de faire autorite: s'il n'est pas cite dessus,
  //    le contenu est ecrit pour personne.
  const questions = ownQuestions(graph);
  for (const q of questions) {
    if (out.length >= limit) break;
    push("question", q, "Le site est-il cite sur une question qu'il traite explicitement ?");
  }

  return out.slice(0, limit);
}

// Titres interrogatifs h2/h3 du site, dedoublonnes, les plus courts d'abord
// (une question courte est une vraie question, une longue est souvent un titre
// marketing deguise).
function ownQuestions(graph) {
  if (!graph) return [];
  const seen = new Set();
  const qs = [];
  for (const p of graph.crawledPages()) {
    for (const h of p.headings || []) {
      if (h.level < 2 || h.level > 3 || h.hidden || !h.text) continue;
      const txt = h.text.trim();
      if (!txt.endsWith("?") || txt.length < 12 || txt.length > 110) continue;
      const k = txt.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      qs.push(txt);
    }
  }
  return qs.sort((a, b) => a.length - b.length).slice(0, 12);
}

// Categorie du site: la ou le site la declare lui-meme, c'est-a-dire le segment de
// son <title> d'accueil qui suit le nom de marque.
//   "Panoptic - Audit de site complet : 15 experts..." -> "audit de site complet"
//
// Trois approches ont ete essayees et jetees avant celle-ci, parce qu'elles
// produisaient toutes une categorie plausible mais fausse:
//   - le terme dominant du corpus donnait "audits" (requete vide);
//   - l'extraction d'un groupe nominal dans la prose donnait "auditeurs analysent"
//     (un morceau de verbe: sans analyse grammaticale on ne sait pas faire);
//   - la repetition inter-pages donnait "report zero", parce qu'un site multilingue
//     fait repeter le gabarit de navigation et non le vocabulaire metier.
//
// Une categorie fausse produit des questions qui ne veulent rien dire, donc une
// mesure de citation qui ne veut rien dire. On prefere N'EN DONNER AUCUNE: la
// fonction renvoie null et l'appelant se rabat sur les questions du site lui-meme.
export function deriveCategory(graph, brand, lang = "fr") {
  if (!graph) return null;
  const home = graph.get(graph.home);
  const title = home?.title;
  if (!title) return null;

  const stop = FUNCTION_WORDS[lang] || FUNCTION_WORDS.fr;
  const brandTokens = new Set(String(brand || "").toLowerCase().split(/\W+/).filter(Boolean));

  // 1. Segments du title, marque retiree.
  const segments = String(title)
    .split(/\s+[|\u2013\u2014-]\s+/)
    .map((x) => x.trim())
    .filter((x) => {
      const t = tokens(x);
      return t.length > 0 && !t.every((w) => brandTokens.has(w));
    });
  if (!segments.length) return null;

  // 2. Premiere proposition seulement: apres un ":" ou une virgule commence en
  //    general l'argumentaire, pas la categorie.
  const head = segments[0].split(/[:,;(]/)[0];
  const toks = tokens(head).filter((t) => !brandTokens.has(t));

  // 3. On coupe des qu'un chiffre apparait ("15 experts" n'est pas une categorie).
  const cut = [];
  for (const t of toks) {
    if (/\d/.test(t)) break;
    cut.push(t);
    if (cut.length >= 4) break;
  }
  while (cut.length && stop.has(cut[cut.length - 1])) cut.pop();
  while (cut.length && stop.has(cut[0])) cut.shift();

  // 4. Garde de qualite: au moins deux mots dont deux pleins. En dessous, on n'a pas
  //    une categorie, on a un fragment.
  const content = cut.filter((t) => !stop.has(t) && t.length >= 3);
  if (cut.length < 2 || content.length < 2) return null;
  return cut.join(" ");
}

// Mots outils par langue: un groupe de mots qui commence ou finit par l'un d'eux
// n'est pas une categorie ("de site", "le plus").
const FUNCTION_WORDS = {
  fr: new Set("le la les un une des du de et ou a au aux en sur pour par avec sans plus tres tout tous votre vos notre nos son sa ses ce cet cette qui que quoi dont est sont".split(" ")),
  en: new Set("the a an and or of to in on for with without more most all your our its that which is are best top".split(" ")),
  de: new Set("der die das ein eine und oder von zu in auf fur mit ohne mehr alle ihre unsere ist sind".split(" ")),
  es: new Set("el la los las un una y o de a en sobre para con sin mas todo su nuestro es son mejor".split(" ")),
  it: new Set("il lo la i gli le un una e o di a in su per con senza piu tutto vostro nostro e sono".split(" ")),
  nl: new Set("de het een en of van naar in op voor met zonder meer alle uw onze is zijn beste".split(" ")),
};

function tokens(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .match(/[a-z0-9][a-z0-9'-]*/g) || [];
}

function pluralize(word, lang) {
  if (/s$|x$/.test(word)) return word;
  if (["fr", "es", "en"].includes(lang)) return word + "s";
  if (lang === "it") return word;
  if (lang === "nl") return word + "en";
  return word;
}
