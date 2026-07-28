// Panoptic SEO KING - lane SXO (adequation intention / page).
//
// Une page peut etre techniquement parfaite et ne jamais ranker parce qu'elle ne
// repond pas a l'intention qu'elle vise. Sans donnees SERP, on ne peut pas savoir ce
// que Google classe: on mesure donc la COHERENCE INTERNE, qui est verifiable, et on
// dit clairement ce qu'on ne mesure pas.

import { buildTfIdf, cosine, detectLang, wordsOf, termDensity } from "../text.js";

export const id = "sxo";

// Marqueurs d'intention dans un titre, et ce que la page doit alors contenir.
const INTENTS = [
  { kind: "transactionnel", re: /\b(prix|tarif|tarifs|acheter|commander|devis|abonnement|pricing|buy|order|quote|kaufen|precio|prezzo)\b/i, expects: /(\d+\s*(€|eur|\$|usd|chf)|\b(gratuit|free|sur devis|on request|par mois|\/mois|per month)\b)/i, expectLabel: "un prix, une fourchette ou une mention explicite (gratuit, sur devis)" },
  { kind: "informationnel", re: /\b(comment|pourquoi|qu'est-ce|guide|tutoriel|definition|how to|what is|why|guide|leitfaden|como|guida)\b/i, expects: /<(h2|h3)\b/i, expectLabel: "des sections h2/h3 qui developpent la reponse" },
  { kind: "comparatif", re: /\b(vs|versus|comparatif|comparaison|alternative|alternatives|meilleur|meilleurs|top \d|best|compare)\b/i, expects: /<(table|ul|ol)\b/i, expectLabel: "un tableau ou une liste de comparaison" },
  { kind: "local", re: /\b(a |pres de|autour de|near me|in |dans le|dans la)\s+[A-Z]/, expects: /(adresse|address|\b\d{5}\b|horaires|opening)/i, expectLabel: "une adresse, un code postal ou des horaires" },
];

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["sxo"], url: scope.url, ...r });

  const pages = graph.crawledPages().filter((p) => !p.noindex && p.text);
  if (!pages.length) return { findings: out, strengths, skipped: "aucune page indexable analysable" };
  const lang = detectLang(pages[0].text).lang || "fr";

  // --- Promesse du title contre promesse du h1 ---------------------------------------
  // Mesure volontairement conservatrice. Un TF-IDF sur deux documents de dix mots est
  // statistiquement vide (l'IDF y penalise justement les termes partages), et un h1
  // editorial different du title est un choix legitime, pas un defaut. On ne signale
  // donc que le cas indefendable: le terme central du title est absent du h1 ET du
  // premier paragraphe, donc la page ne parle nulle part de ce qu'elle promet.
  const mismatched = [];
  for (const p of pages) {
    const h1 = (p.headings || []).find((h) => h.level === 1 && !h.hidden && h.text);
    if (!p.title || !h1) continue;
    const key = mainTerm(p.title, lang);
    if (!key || key.length < 4) continue;
    const intro = p.text.slice(0, 400);
    const inH1 = normalize(h1.text).includes(key);
    const inIntro = normalize(intro).includes(key);
    if (!inH1 && !inIntro) mismatched.push({ p, h1: h1.text, key });
  }
  if (mismatched.length) {
    const ex = mismatched[0];
    F({
      rule: "title-h1-mismatch", severity: "low", effort: 0.3,
      title: `${mismatched.length} page(s) ne reprennent leur promesse de title ni en h1 ni en intro`,
      url: ex.p.url,
      proof: `${short(ex.p.url)}: le terme central du title est "${ex.key}" (title: "${ex.p.title}"), absent du h1 ("${ex.h1}") comme des 400 premiers caracteres du texte. Le visiteur clique sur une promesse et ne la retrouve pas.`,
      fix: "Reprendre le terme du title dans le h1 ou des le premier paragraphe. Le title vend, le h1 confirme.",
      verifiability: "cross-checked",
    });
  } else if (pages.length) {
    strengths.push("Chaque page reprend la promesse de son title des le h1 ou l'introduction");
  }

  // --- Le title annonce une intention: la page la sert-elle ? --------------------------
  for (const p of pages) {
    if (!p.title) continue;
    for (const intent of INTENTS) {
      if (!intent.re.test(p.title)) continue;
      const haystack = `${p.text}\n${p.html || ""}`;
      if (intent.expects.test(haystack)) continue;
      F({
        rule: `intent-unserved-${intent.kind}`, severity: "medium", effort: 0.5,
        title: `Page a intention ${intent.kind} sans ${intent.expectLabel}`,
        url: p.url,
        proof: `${short(p.url)}: le title "${p.title}" annonce une intention ${intent.kind}, mais la page ne contient pas ${intent.expectLabel}. L'utilisateur repart chercher ailleurs.`,
        fix: `Ajouter ${intent.expectLabel} sur cette page, ou changer le title s'il ne correspond pas au contenu reel.`,
        verifiability: "self-evident",
      });
      break;   // une seule intention signalee par page
    }
  }

  // --- Le mot-cle du title existe-t-il dans le corps ? ----------------------------------
  const absent = [];
  for (const p of pages) {
    if (!p.title || wordsOf(p.text).length < 150) continue;
    const key = mainTerm(p.title, lang);
    if (!key) continue;
    const d = termDensity(p.text, key);
    p.mainTerm = { term: key, density: d };
    if (d === 0) absent.push({ p, key });
    else if (d > 4) {
      F({
        rule: "keyword-stuffing", severity: "medium", effort: 0.4,
        title: `Sur-optimisation: "${key}" repete a ${d}% du texte`,
        url: p.url,
        proof: `${short(p.url)}: densite de ${d}% pour "${key}" (au-dela de 4%, le signal envoye est la manipulation, pas l'expertise).`,
        fix: "Remplacer les repetitions par des variantes naturelles et des termes du meme champ semantique.",
        verifiability: "self-evident",
        dimensions: ["sxo", "content"],
      });
    }
  }
  if (absent.length) {
    F({
      rule: "title-term-absent-from-body", severity: "low", effort: 0.4,
      title: `${absent.length} page(s) ne reprennent jamais le terme central de leur title`,
      url: absent[0].p.url,
      proof: absent.slice(0, 4).map(({ p, key }) => `${short(p.url)}: "${key}" absent du corps`).join(" | ") + ". Le title promet un sujet que le texte ne traite pas explicitement.",
      fix: "Reprendre le terme dans le h1 et dans le premier paragraphe, ou reformuler le title.",
      verifiability: "self-evident",
    });
  }

  // --- Densite d'information au-dessus de la ligne de flottaison ------------------------
  // Approximation deterministe: les 1500 premiers caracteres du body rendu.
  const home = graph.get(scope.url);
  if (home?.html) {
    const bodyStart = (home.html.split(/<body[^>]*>/i)[1] || home.html).slice(0, 6000);
    const aboveText = bodyStart.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const words = wordsOf(aboveText).length;
    if (words < 25) {
      F({
        rule: "empty-above-the-fold", severity: "medium", effort: 0.5,
        title: "Trop peu de texte en haut de page pour comprendre l'offre",
        proof: `${words} mots dans le premier ecran du HTML servi. Un visiteur venu d'une SERP decide en quelques secondes; un moteur de reponse lit le debut du document en priorite.`,
        fix: "Placer en haut de page une phrase qui dit ce que fait le produit, pour qui, et le benefice concret.",
        verifiability: "self-evident",
        dimensions: ["sxo", "geo"],
      });
    } else strengths.push(`Proposition lisible des le premier ecran (${words} mots)`);
  }

  // Ce que cette lane ne peut PAS mesurer sans source SERP: on le dit plutot que de
  // laisser croire a une couverture complete.
  F({
    rule: "sxo-serp-not-measured", severity: "info", effort: 0,
    title: "Adequation aux SERP reelles non mesuree (aucune source de classement connectee)",
    proof: "Cette lane mesure la coherence interne (title/h1/contenu/intention). Elle ne peut pas verifier ce que Google classe reellement sur ces requetes sans une source de donnees SERP.",
    fix: "Connecter une source SERP ou la Search Console pour completer l'analyse d'intention par les positions reelles.",
    verifiability: "inconclusive",
  });

  return { findings: out, strengths };
}

function normalize(s = "") {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Terme central d'un title: le bigramme ou unigramme le plus significatif hors marque.
function mainTerm(title, lang) {
  const cleaned = String(title).split(/\s+[|–—-]\s+/)[0];
  const [v] = buildTfIdf([cleaned], lang);
  if (!v || !v.size) return null;
  return [...v.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
