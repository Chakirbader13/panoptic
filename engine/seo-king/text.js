// Panoptic SEO KING - primitives textuelles deterministes.
//
// Tout ce qui, dans les outils du marche, passe par un LLM ou une API payante et
// devient donc non reproductible: similarite semantique, cannibalisation, lisibilite,
// citabilite. Ici c'est de l'arithmetique: meme entree, meme sortie, verifiable.

const STOP = {
  fr: "au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous c d j l a m n s t y ete etee etees etes etais etait etant suis es est sommes etes sont serai seras sera serons serez seront avoir ai as avons avez ont aurai auras aura aurons aurez auront plus tres tout tous toute toutes aussi comme donc alors si sans sous entre chez apres avant depuis pendant vers cela cette cet",
  en: "a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with from your you we our us have has had can could would should about more most other some what when where which who why how all any each",
  de: "der die das den dem des ein eine einer eines einem einen und oder aber wenn dann als auch noch nur schon sehr von zu mit auf fur bei nach aus im in ist sind war waren wird werden haben hat hatte kann konnen soll sollte man sich nicht kein keine",
  es: "el la los las un una unos unas y o pero si de del al en con por para sin sobre entre desde hasta que se su sus lo le les es son era eran ser estar hay muy mas ya no ni tambien como cuando donde porque",
  it: "il lo la i gli le un uno una di del della dei delle e o ma se da in con per tra fra su non che chi cui si sono era erano essere avere piu molto anche come quando dove perche gia",
  nl: "de het een en of maar als dan van voor met op aan bij naar uit in is zijn was waren worden wordt heeft hebben kan kunnen moet moeten niet geen ook nog al zeer meer dit dat deze die er om te",
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(/\s+/))]));

export function tokenize(text = "") {
  return (String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9][a-z0-9'-]{1,}/g) || []);
}

export function contentTokens(text, lang = "fr") {
  const stop = STOPSETS[lang] || STOPSETS.fr;
  return tokenize(text).filter((t) => t.length > 2 && !stop.has(t) && !/^\d+$/.test(t));
}

// --- Similarite ----------------------------------------------------------------------
// TF-IDF + cosinus sur un corpus de pages. Sert a la cannibalisation: deux pages qui
// visent la meme intention ont un vecteur de termes quasi colineaire.
export function buildTfIdf(docs, lang = "fr") {
  const tokenized = docs.map((d) => contentTokens(d, lang));
  const df = new Map();
  for (const toks of tokenized) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length || 1;
  return tokenized.map((toks) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const idf = Math.log(1 + N / (1 + (df.get(t) || 0)));
      const w = (c / toks.length) * idf;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) { const o = big.get(t); if (o) dot += w * o; }
  return Math.round(dot * 1000) / 1000;
}

// Termes qui contribuent le plus a la ressemblance entre deux pages: la preuve
// lisible d'une cannibalisation ("ces deux pages se disputent ces 6 mots").
export function sharedTerms(a, b, limit = 8) {
  const out = [];
  for (const [t, w] of a) { const o = b.get(t); if (o) out.push([t, w * o]); }
  return out.sort((x, y) => y[1] - x[1]).slice(0, limit).map(([t]) => t);
}

// Shingles de n mots + Jaccard: detecte le contenu DUPLIQUE (copie litterale),
// la ou le cosinus detecte le contenu REDONDANT (meme sujet, mots differents).
export function shingles(text, n = 5, lang = "fr") {
  const toks = contentTokens(text, lang);
  const set = new Set();
  for (let i = 0; i + n <= toks.length; i++) set.add(toks.slice(i, i + n).join(" "));
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) if (big.has(s)) inter++;
  return Math.round((inter / (a.size + b.size - inter)) * 1000) / 1000;
}

// --- Langue ---------------------------------------------------------------------------
// Detection par mots vides: robuste sur du texte court, et suffisante pour verifier
// qu'une page /de/ est bien en allemand (erreur i18n classique: la traduction manque
// et la page sert du francais sous une URL allemande).
export function detectLang(text = "") {
  const toks = tokenize(text).slice(0, 600);
  if (toks.length < 20) return { lang: null, confidence: 0, reason: "texte trop court" };
  const scores = {};
  for (const [lang, set] of Object.entries(STOPSETS)) {
    scores[lang] = toks.filter((t) => set.has(t)).length / toks.length;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [lang, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  return { lang, confidence: Math.round((top - second) * 100) / 100, ratio: Math.round(top * 100) / 100, scores };
}

// --- Lisibilite -----------------------------------------------------------------------
function syllables(word, lang) {
  const w = word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (lang === "en") {
    const m = w.replace(/e$/, "").match(/[aeiouy]+/g);
    return Math.max(1, m ? m.length : 1);
  }
  // Langues romanes/germaniques: groupes de voyelles.
  const m = w.match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}

// Flesch pour l'anglais, Kandel-Moles (adaptation francaise de Flesch) sinon.
// Ce n'est pas de la note de style: une page illisible est une page mal citee,
// parce qu'un moteur de reponse extrait des phrases, pas des paragraphes.
export function readability(text = "", lang = "fr") {
  const sentences = (text.match(/[^.!?\n]+[.!?]+/g) || []).filter((s) => s.trim().split(/\s+/).length > 2);
  const words = (text.match(/[\p{L}][\p{L}'-]*/gu) || []);
  if (sentences.length < 3 || words.length < 40) return { score: null, reason: "texte trop court pour un score fiable" };
  const asl = words.length / sentences.length;
  const asw = words.reduce((s, w) => s + syllables(w, lang), 0) / words.length;
  const score = lang === "en"
    ? 206.835 - 1.015 * asl - 84.6 * asw
    : 207 - 1.015 * asl - 73.6 * asw;
  const longSentences = sentences.filter((s) => s.trim().split(/\s+/).length > 35).length;
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    formula: lang === "en" ? "Flesch Reading Ease" : "Kandel-Moles (Flesch adapte FR)",
    avgSentenceWords: Math.round(asl * 10) / 10,
    avgSyllables: Math.round(asw * 100) / 100,
    sentences: sentences.length,
    longSentences,
  };
}

// --- Citabilite -----------------------------------------------------------------------
// Ce qu'un moteur de reponse peut extraire tel quel. Chaque signal est comptable.
const QUESTION_RE = /^(qu(?:'|e |i |and |oi)|comment|pourquoi|combien|ou |quel|quelle|quels|quelles|est-ce|faut-il|peut-on|what|how|why|when|where|which|who|is |are |can |does |do |should |wie |was |warum |wann |como|por que|que |cual|come|perche|cosa|hoe|wat|waarom)/i;

export function isQuestion(heading = "") {
  const h = heading.trim();
  return h.endsWith("?") || QUESTION_RE.test(h);
}

// Densite de faits chiffres: un moteur de reponse cite en priorite ce qui est
// verifiable et precis. "rapide" ne se cite pas, "en 90 secondes" se cite.
export function statDensity(text = "") {
  const words = wordsOf(text).length || 1;
  // Deux familles d'unites, parce qu'elles ne se terminent pas pareil. Les unites
  // SYMBOLIQUES (%, €, $) ne sont pas des caracteres de mot: leur coller un \b final
  // exige d'etre suivies d'une lettre, ce qui ne se produit jamais en texte reel
  // ("10 % des"). Ce detail faisait silencieusement ignorer TOUS les prix et
  // pourcentages, c'est-a-dire exactement les faits les plus cites.
  const SYMBOLS = "%|€|\\$|£|¥";
  const WORDS = "EUR|USD|CHF|GBP|ms|km|kg|Go|Mo|Ko|To"
    + "|secondes?|seconds?|minutes?|heures?|hours?|jours?|days?|semaines?|weeks?|mois|months?|ans?|annees?|years?"
    + "|milliards?|millions?|milliers?|billions?|thousands?"
    + "|fois|times|x|points?|pts?"
    + "|clients?|utilisateurs?|users?|entreprises?|sites?|pages?|agents?|domaines?|langues?|projets?|avis|reviews?";
  const numberFirst = new RegExp(`\\b\\d[\\d\\s.,]*\\s*(?:(?:${WORDS})\\b|(?:${SYMBOLS}))`, "gi");
  // Forme anglo-saxonne ou le symbole precede: "$49", "£1,200".
  const symbolFirst = new RegExp(`(?:${SYMBOLS})\\s*\\d[\\d\\s.,]*`, "gi");
  const stats = (text.match(numberFirst) || []).length + (text.match(symbolFirst) || []).length;
  const years = (text.match(/\b(19|20)\d{2}\b/g) || []).length;
  return { stats, years, per100Words: Math.round(((stats + years) / words) * 10000) / 100 };
}

// Blocs "reponse directe": un titre interrogatif suivi d'une reponse courte et
// autoportante. C'est l'unite de citation des moteurs de reponse.
export function answerBlocks(headings = [], text = "") {
  const blocks = [];
  const questions = headings.filter((h) => h.level >= 2 && isQuestion(h.text));
  for (const q of questions) {
    const idx = text.indexOf(q.text);
    if (idx < 0) { blocks.push({ question: q.text, answerWords: null, found: false }); continue; }
    const after = text.slice(idx + q.text.length, idx + q.text.length + 700).trim();
    const firstPara = after.split(/\n/).find((p) => p.trim().length > 30) || after.slice(0, 300);
    const n = wordsOf(firstPara).length;
    blocks.push({
      question: q.text,
      answerWords: n,
      found: true,
      // 15-70 mots: assez pour repondre, assez court pour etre repris tel quel.
      citable: n >= 15 && n <= 70,
      snippet: firstPara.slice(0, 160),
    });
  }
  return { total: questions.length, blocks, citable: blocks.filter((b) => b.citable).length };
}

// Definitions autoportantes: "X est un/une ...". Format prefere des extraits.
export function definitionPatterns(text = "") {
  const re = /\b([A-ZÀ-Ý][\p{L}0-9 -]{2,40})\s+(?:est|sont|designe|signifie|is|are|means|refers to|ist|sind|es|son|e'|is een|zijn)\s+(?:un|une|le|la|les|des|a|an|the|ein|eine|el|los|il|lo|een)\b/gu;
  return [...text.matchAll(re)].slice(0, 20).map((m) => m[1].trim());
}

export function wordsOf(text = "") {
  return String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

// Densite d'un terme: sert a detecter le bourrage (au-dela de ~4% c'est un signal
// de sur-optimisation, pas d'expertise).
export function termDensity(text, term) {
  const toks = tokenize(text);
  if (!toks.length) return 0;
  const parts = tokenize(term);
  if (!parts.length) return 0;
  let hits = 0;
  for (let i = 0; i + parts.length <= toks.length; i++) {
    if (parts.every((p, j) => toks[i + j] === p)) hits++;
  }
  return Math.round((hits / toks.length) * 10000) / 100;
}

// Dates visibles dans le texte (fraicheur percue par un moteur de reponse).
export function freshnessSignals(html = "", text = "") {
  const isoDates = [...html.matchAll(/datetime\s*=\s*["'](\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1]);
  const textDates = (text.match(/\b(?:0?[1-9]|[12]\d|3[01])\s+(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2}\b/gi) || []);
  const years = [...new Set((text.match(/\b20[12]\d\b/g) || []))].sort();
  return { isoDates: [...new Set(isoDates)], textDates: [...new Set(textDates)].slice(0, 5), years, hasAny: isoDates.length + textDates.length > 0 };
}
