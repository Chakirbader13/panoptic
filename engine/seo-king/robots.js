// Panoptic SEO KING - parseur robots.txt conforme RFC 9309.
//
// Pourquoi ce fichier existe: la quasi-totalite des outils d'audit testent robots.txt
// avec une regex du genre /User-agent:\s*GPTBot[\s\S]*?Disallow:\s*\//. C'est faux dans
// au moins quatre cas frequents:
//   1. Un groupe peut avoir PLUSIEURS lignes User-agent (elles partagent les regles).
//   2. Allow gagne sur Disallow quand le motif est plus long (precedence RFC 9309 5.2).
//   3. Les jokers * et l'ancre $ changent completement le resultat.
//   4. Un bot non liste herite du groupe "*", pas de "tout autorise".
// Un faux "GPTBot bloque" fait paniquer un client pour rien. On parse pour de vrai.

// Groupes de regles: { agents: [..], rules: [{ type: "allow"|"disallow", path }] }
export function parseRobots(text = "") {
  const groups = [];
  const sitemaps = [];
  const other = { crawlDelay: {}, unknownDirectives: [] };
  let current = null;
  let lastLineWasAgent = false;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Lignes User-agent consecutives = un seul groupe partage.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;

    if (field === "sitemap") { sitemaps.push(value); continue; }
    if (field === "crawl-delay") {
      if (current) for (const a of current.agents) other.crawlDelay[a] = value;
      continue;
    }
    if (field === "allow" || field === "disallow") {
      // Une regle hors de tout groupe est ignoree par les crawlers (RFC 9309 2.2.1).
      if (!current) { other.unknownDirectives.push(line); continue; }
      current.rules.push({ type: field, path: value });
      continue;
    }
    other.unknownDirectives.push(line);
  }

  return { groups, sitemaps, ...other, empty: groups.length === 0 && sitemaps.length === 0 };
}

// Selection du groupe applicable a un user-agent (RFC 9309 2.2.1):
// correspondance de prefixe insensible a la casse, la plus SPECIFIQUE gagne,
// et "*" ne sert que si aucun groupe nomme ne correspond.
export function groupFor(parsed, userAgent) {
  const ua = String(userAgent).toLowerCase();
  let best = null;
  let bestLen = -1;
  let star = null;
  for (const g of parsed.groups) {
    for (const a of g.agents) {
      if (a === "*") { star = star || g; continue; }
      // La correspondance va dans UN SEUL sens (RFC 9309 2.2.1): le nom du groupe doit
      // etre un prefixe du jeton produit du crawler. "Googlebot-Image" ne doit surtout
      // PAS capter "Googlebot", sinon on applique a l'indexeur principal les regles
      // destinees aux images, et on annonce un blocage qui n'existe pas.
      const match = ua === a || ua.startsWith(a);
      if (match && a.length > bestLen) { best = g; bestLen = a.length; }
    }
  }
  return best || star || null;
}

// Conversion d'un motif robots en regex. * = n'importe quoi, $ = fin d'URL.
function pathToRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") { re += "[\\s\\S]*"; continue; }
    if (ch === "$" && i === pattern.length - 1) { re += "$"; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re);
}

// Longueur du motif hors jokers, utilisee pour la precedence (RFC 9309 2.2.2:
// la regle au motif le PLUS LONG gagne; a egalite, Allow gagne).
function specificity(pattern) {
  return pattern.replace(/\*/g, "").length;
}

// Un user-agent peut-il recuperer ce chemin ? Renvoie la regle decisive pour la preuve.
export function isAllowed(parsed, userAgent, path) {
  const group = groupFor(parsed, userAgent);
  if (!group || group.rules.length === 0) {
    return { allowed: true, rule: null, group: group ? group.agents.join(", ") : null, reason: group ? "groupe sans regle" : "aucun groupe applicable" };
  }
  const target = path.startsWith("/") ? path : "/" + path;
  let winner = null;
  for (const rule of group.rules) {
    // Disallow vide = tout autoriser (RFC 9309 5.1). Ce n'est pas un blocage.
    if (rule.type === "disallow" && rule.path === "") continue;
    if (!pathToRegex(rule.path).test(target)) continue;
    if (!winner) { winner = rule; continue; }
    const s = specificity(rule.path);
    const sw = specificity(winner.path);
    if (s > sw || (s === sw && rule.type === "allow" && winner.type === "disallow")) winner = rule;
  }
  if (!winner) return { allowed: true, rule: null, group: group.agents.join(", "), reason: "aucune regle ne correspond" };
  return {
    allowed: winner.type === "allow",
    rule: `${winner.type === "allow" ? "Allow" : "Disallow"}: ${winner.path || "(vide)"}`,
    group: group.agents.join(", "),
    reason: `regle la plus specifique pour ${userAgent}`,
  };
}

// Les crawlers qui comptent en 2026. `kind` pilote l'interpretation d'un blocage:
//   search   = index de recherche classique (bloquer = disparaitre des resultats)
//   ai-search= moteur de reponse qui cite en direct (bloquer = perdre la citation)
//   ai-train = collecte d'entrainement (bloquer est une DECISION legitime, pas un defaut)
export const CRAWLERS = [
  { ua: "Googlebot", label: "Googlebot", kind: "search", platform: "Google" },
  { ua: "Bingbot", label: "Bingbot", kind: "search", platform: "Bing / Copilot" },
  { ua: "Google-Extended", label: "Google-Extended", kind: "ai-train", platform: "Gemini (entrainement)" },
  { ua: "GPTBot", label: "GPTBot", kind: "ai-train", platform: "OpenAI (entrainement)" },
  { ua: "OAI-SearchBot", label: "OAI-SearchBot", kind: "ai-search", platform: "ChatGPT Search" },
  { ua: "ChatGPT-User", label: "ChatGPT-User", kind: "ai-search", platform: "ChatGPT (navigation)" },
  { ua: "PerplexityBot", label: "PerplexityBot", kind: "ai-search", platform: "Perplexity" },
  { ua: "Perplexity-User", label: "Perplexity-User", kind: "ai-search", platform: "Perplexity (navigation)" },
  { ua: "ClaudeBot", label: "ClaudeBot", kind: "ai-train", platform: "Anthropic (entrainement)" },
  { ua: "Claude-User", label: "Claude-User", kind: "ai-search", platform: "Claude (navigation)" },
  { ua: "Applebot-Extended", label: "Applebot-Extended", kind: "ai-train", platform: "Apple Intelligence" },
  { ua: "CCBot", label: "CCBot", kind: "ai-train", platform: "Common Crawl" },
  { ua: "meta-externalagent", label: "meta-externalagent", kind: "ai-train", platform: "Meta AI" },
  { ua: "Amazonbot", label: "Amazonbot", kind: "ai-train", platform: "Amazon / Alexa" },
  { ua: "Bytespider", label: "Bytespider", kind: "ai-train", platform: "ByteDance" },
];

// Matrice bot x chemin. C'est la sortie qui permet de dire, preuve a l'appui,
// exactement qui peut lire quoi.
export function crawlerMatrix(parsed, paths = ["/"]) {
  return CRAWLERS.map((bot) => {
    const results = paths.map((p) => ({ path: p, ...isAllowed(parsed, bot.ua, p) }));
    const blocked = results.filter((r) => !r.allowed);
    return { ...bot, results, blockedCount: blocked.length, blockedPaths: blocked.map((b) => b.path), sample: blocked[0] || results[0] };
  });
}
