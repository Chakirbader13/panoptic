// Panoptic SEO KING - mesure des citations dans les moteurs de reponse IA.
//
// Ce module fait ce que la lane GEO ne peut PAS faire: au lieu de deduire une aptitude
// a etre cite, il pose reellement les questions aux moteurs et regarde qui est cite.
//
// Trois precautions qui font la difference entre une mesure et une impression:
//   - ECHANTILLON ANNONCE. On dit toujours combien de prompts, sur quels moteurs, a
//     quelle date. Une citation mesuree sur 8 prompts n'est pas une part de marche.
//   - PART DE VOIX RELATIVE. Le chiffre utile n'est pas "on est cite 2 fois", c'est
//     "sur les memes questions, ce concurrent est cite 6 fois".
//   - AUCUNE EXTRAPOLATION. Si un fournisseur echoue, il est exclu du calcul et
//     signale, jamais remplace par une moyenne des autres.

import { availableProviders, keyFor, domainOf } from "./providers.js";

const CONCURRENCY = 2;      // ce sont des appels payants: on ne martele pas
const TIMEOUT = 30000;

// Domaines qui ne sont jamais des "concurrents" au sens utile: agregateurs, reseaux,
// encyclopedies. Les compter fausserait la part de voix.
const NEUTRAL = /^(wikipedia\.org|fr\.wikipedia\.org|en\.wikipedia\.org|youtube\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|reddit\.com|quora\.com|medium\.com|github\.com|google\.com|bing\.com|amazon\.[a-z.]+|wikidata\.org)$/i;

/**
 * @param prompts  [{id, kind, text, intent}]
 * @param opts     { siteDomain, brand, env, maxCalls }
 */
export async function measureCitations(prompts, { siteDomain, brand, category, topicTerms = [], env = process.env, maxCalls = 24 } = {}) {
  const avail = availableProviders(env).filter((p) => p.available);
  if (!avail.length) {
    return {
      state: "not_measured",
      reason: "aucune cle de moteur de reponse configuree",
      providersKnown: availableProviders(env).map((p) => ({ id: p.provider.id, label: p.provider.label, envVars: p.provider.envKeys })),
    };
  }

  // Budget: chaque prompt coute un appel PAR fournisseur.
  const perProvider = Math.max(1, Math.floor(maxCalls / avail.length));
  const used = prompts.slice(0, perProvider);

  const jobs = [];
  for (const { provider } of avail) {
    for (const prompt of used) jobs.push({ provider, prompt });
  }

  const results = await mapLimit(jobs, CONCURRENCY, async ({ provider, prompt }) => {
    const key = keyFor(provider, env);
    const t0 = performance.now();
    const r = await provider.ask(prompt.text, { key, timeout: TIMEOUT });
    return {
      providerId: provider.id, providerLabel: provider.label, model: provider.model,
      prompt, ms: Math.round(performance.now() - t0), ...r,
    };
  });

  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const brandRe = brand ? new RegExp(escapeRe(brand).replace(/\s+/g, "\\s+"), "i") : null;
  const site = domainOf(siteDomain);

  // Signaux qui prouvent qu'une reponse parle bien de CE site et pas d'un homonyme.
  // Indispensable: beaucoup de marques sont des mots courants ("Panoptic", "Orange",
  // "Apple", "Sonar"). Compter chaque occurrence du mot comme une mention de la marque
  // fabriquerait un taux de notoriete qui ne veut rien dire.
  const topicRe = buildTopicRegex(category, topicTerms);

  // --- Observations par appel ------------------------------------------------------
  const observations = ok.map((r) => {
    const answer = r.answer || "";
    const cited = (r.citedDomains || []).includes(site);
    const nameAppears = brandRe ? brandRe.test(answer) : false;
    // Une mention ne compte que si la reponse traite bien du sujet du site, ou
    // qu'elle cite son domaine. Sinon c'est un homonyme.
    const onTopic = cited || (topicRe ? topicRe.test(answer) : true);
    return {
      providerId: r.providerId, providerLabel: r.providerLabel,
      promptId: r.prompt.id, promptKind: r.prompt.kind, prompt: r.prompt.text,
      cited,
      mentioned: nameAppears && onTopic,
      nameAppears,
      ambiguous: nameAppears && !onTopic,
      citedDomains: r.citedDomains || [],
      answerExcerpt: excerptAround(answer, brandRe) || answer.slice(0, 220),
      ms: r.ms,
    };
  });

  // --- Agregats --------------------------------------------------------------------
  const n = observations.length;
  const citedCount = observations.filter((o) => o.cited).length;
  const mentionCount = observations.filter((o) => o.mentioned).length;
  const ambiguousCount = observations.filter((o) => o.ambiguous).length;

  // Part de voix: frequence de citation de chaque domaine sur LES MEMES questions.
  const domainFreq = new Map();
  for (const o of observations) {
    for (const d of new Set(o.citedDomains)) {
      if (NEUTRAL.test(d)) continue;
      domainFreq.set(d, (domainFreq.get(d) || 0) + 1);
    }
  }
  const ranking = [...domainFreq.entries()]
    .map(([domain, count]) => ({ domain, count, share: n ? Math.round((count / n) * 100) : 0, isSite: domain === site }))
    .sort((a, b) => b.count - a.count);
  const sitePosition = ranking.findIndex((r) => r.isSite);
  // Sont "devant" les seuls domaines STRICTEMENT plus cites. Compter les ex aequo
  // ferait dire "68 sources citees plus souvent que vous" alors que 67 d'entre elles
  // sont citees exactement autant: le chiffre serait spectaculaire et faux.
  const siteCount = sitePosition >= 0 ? ranking[sitePosition].count : 0;
  const strictlyAhead = ranking.filter((r) => !r.isSite && r.count > siteCount);
  const tied = ranking.filter((r) => !r.isSite && r.count === siteCount).length;

  const byProvider = {};
  for (const { provider } of avail) {
    const obs = observations.filter((o) => o.providerId === provider.id);
    const errs = failed.filter((f) => f.providerId === provider.id);
    byProvider[provider.id] = {
      label: provider.label, model: provider.model,
      calls: obs.length, errors: errs.length,
      errorSample: errs[0]?.error || null,
      cited: obs.filter((o) => o.cited).length,
      mentioned: obs.filter((o) => o.mentioned).length,
    };
  }

  return {
    state: n ? "observed" : "not_measured",
    reason: n ? null : `tous les appels ont echoue: ${failed[0]?.error || "inconnu"}`,
    siteDomain: site,
    brand: brand || null,
    // L'echantillon est une donnee de premiere classe: sans lui, les taux ci-dessous
    // ne veulent rien dire.
    sample: {
      prompts: used.length,
      providers: avail.map((p) => p.provider.label),
      calls: results.length,
      successful: n,
      failed: failed.length,
    },
    citationRate: n ? Math.round((citedCount / n) * 100) : null,
    // Ne compte QUE les mentions dont on a pu verifier qu'elles parlent du bon sujet.
    mentionRate: n ? Math.round((mentionCount / n) * 100) : null,
    citedCount, mentionCount,
    // Le nom de marque apparait mais la reponse traite d'autre chose: signe d'une
    // marque homonyme d'un mot courant. C'est un constat en soi, pas du bruit.
    ambiguousCount,
    ambiguousRate: n ? Math.round((ambiguousCount / n) * 100) : null,
    ambiguousSample: observations.filter((o) => o.ambiguous).slice(0, 3).map((o) => ({ prompt: o.prompt, excerpt: o.answerExcerpt })),
    topicSignals: [category, ...topicTerms].filter(Boolean).slice(0, 8),
    ranking: ranking.slice(0, 12),
    sitePosition: sitePosition >= 0 ? sitePosition + 1 : null,
    siteCount,
    aheadCount: strictlyAhead.length,
    tiedCount: tied,
    competitorsAhead: strictlyAhead.slice(0, 8),
    topSources: ranking.slice(0, 8),
    byProvider,
    observations,
    promptsUsed: used,
  };
}

// Extrait la phrase qui contient la marque: c'est la preuve citable, bien plus utile
// que les 200 premiers caracteres de la reponse.
function excerptAround(answer, brandRe) {
  if (!brandRe || !answer) return null;
  const m = brandRe.exec(answer);
  if (!m) return null;
  const start = Math.max(0, answer.lastIndexOf(".", m.index) + 1);
  const endDot = answer.indexOf(".", m.index + m[0].length);
  const end = endDot > 0 ? endDot + 1 : Math.min(answer.length, m.index + 200);
  return answer.slice(start, end).trim().slice(0, 300);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Regex de "sujet": au moins un signal thematique du site doit apparaitre pour qu'une
// occurrence du nom de marque soit attribuee a ce site.
function buildTopicRegex(category, topicTerms) {
  const parts = [];
  for (const c of String(category || "").split(/\s+/)) if (c.length >= 4) parts.push(escapeRe(c));
  for (const t of topicTerms) if (String(t).length >= 4) parts.push(escapeRe(String(t)));
  const uniq = [...new Set(parts)];
  if (!uniq.length) return null;
  return new RegExp(`\\b(${uniq.join("|")})`, "i");
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}
