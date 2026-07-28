// Panoptic SEO KING - adaptateurs vers les moteurs de reponse IA.
//
// C'est le seul endroit du moteur qui appelle un service externe payant. Trois regles:
//   1. RIEN sans cle. Aucun fournisseur ne s'active sans sa variable d'environnement.
//      Un audit sans cle ne produit pas moins de constats: il en produit AUCUN sur cet
//      axe, et le dit. On ne simule jamais une citation.
//   2. Aucune cle n'entre dans un finding, un artefact ou un log.
//   3. Une reponse d'IA est STOCHASTIQUE. Tout ce qui sort d'ici est une OBSERVATION
//      datee, pas une derivation reproductible comme le reste du moteur. Les lanes
//      qui la consomment doivent la presenter comme telle.

const UA = "PanopticAudit/1.0 (+https://panopticaudit.com)";

async function postJson(url, body, { headers = {}, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "user-agent": UA, ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* reponse non JSON */ }
    if (!res.ok) return { error: `HTTP ${res.status}${json?.error?.message ? ": " + json.error.message : ""}` };
    if (!json) return { error: "reponse illisible" };
    return { json };
  } catch (e) {
    return { error: e.name === "AbortError" ? "delai depasse" : e.message };
  } finally {
    clearTimeout(to);
  }
}

// Domaine nu, pour comparer des citations entre elles sans se faire piEger par le
// www, le protocole ou un chemin.
export function domainOf(urlOrHost = "") {
  let s = String(urlOrHost).trim().toLowerCase();
  if (!s) return null;
  try {
    if (!/^https?:\/\//.test(s)) {
      // Gemini renvoie souvent le domaine nu comme titre de source.
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return s.replace(/^www\./, "");
      s = "https://" + s;
    }
    return new URL(s).host.replace(/^www\./, "");
  } catch { return null; }
}

export const PROVIDERS = [
  {
    id: "perplexity",
    label: "Perplexity",
    // Perplexity renvoie de VRAIES URLs de citation: c'est la mesure la plus directe
    // dont on dispose, aucune heuristique n'est necessaire pour attribuer une source.
    envKeys: ["PANOPTIC_PERPLEXITY_KEY", "PERPLEXITY_API_KEY"],
    model: "sonar",
    async ask(prompt, { key, timeout }) {
      const { json, error } = await postJson("https://api.perplexity.ai/chat/completions", {
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
      }, { headers: { authorization: `Bearer ${key}` }, timeout });
      if (error) return { error };
      const answer = json.choices?.[0]?.message?.content || "";
      const urls = Array.isArray(json.citations) ? json.citations : [];
      const sources = (json.search_results || []).map((s) => ({ url: s.url, title: s.title }));
      const all = [...urls, ...sources.map((s) => s.url)].filter(Boolean);
      return {
        answer,
        citedDomains: [...new Set(all.map(domainOf).filter(Boolean))],
        citedUrls: [...new Set(all)],
        sources,
      };
    },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    // Gemini ancre ses reponses sur la recherche Google. Les URLs de sources sont des
    // redirections opaques vertexaisearch: inexploitables telles quelles. En revanche
    // le TITRE de la source est le domaine, ce qui suffit pour l'attribution.
    envKeys: ["PANOPTIC_GEMINI_KEY", "GEMINI_API_KEY"],
    model: "gemini-3-flash-preview",
    async ask(prompt, { key, timeout }) {
      const { json, error } = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(key)}`,
        { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] },
        { timeout }
      );
      if (error) return { error };
      const cand = json.candidates?.[0];
      if (!cand) return { error: "aucune reponse" };
      const answer = (cand.content?.parts || []).map((p) => p.text || "").join("");
      const chunks = cand.groundingMetadata?.groundingChunks || [];
      const domains = chunks.map((c) => domainOf(c.web?.title)).filter(Boolean);
      return {
        answer,
        citedDomains: [...new Set(domains)],
        citedUrls: [],   // redirections opaques: on n'expose pas d'URL trompeuse
        sources: chunks.map((c) => ({ url: null, title: c.web?.title })).filter((s) => s.title),
        queries: cand.groundingMetadata?.webSearchQueries || [],
      };
    },
  },
];

// Fournisseurs reellement utilisables dans cet environnement. On ne renvoie jamais la
// cle elle-meme, seulement le fait qu'elle existe.
export function availableProviders(env = process.env) {
  return PROVIDERS.map((p) => {
    const found = p.envKeys.find((k) => env[k] && String(env[k]).trim().length > 8);
    return { provider: p, envVar: found || null, available: Boolean(found) };
  });
}

export function keyFor(provider, env = process.env) {
  const k = provider.envKeys.find((k) => env[k] && String(env[k]).trim().length > 8);
  return k ? String(env[k]).trim() : null;
}
