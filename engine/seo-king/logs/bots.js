// Panoptic SEO KING - identification et VERIFICATION des robots dans les logs.
//
// Le piege central de toute analyse de logs: le user-agent est declaratif. N'importe
// quel script s'annonce "Googlebot" en une ligne de code. Un rapport qui compte les
// lignes contenant "Googlebot" ne mesure pas Google, il mesure les scrapers et les
// outils SEO tiers qui se font passer pour lui. Les chiffres seraient faux dans le
// sens le plus flatteur qui soit ("Google adore votre site").
//
// Parade, celle documentee par Google et Bing: DNS inverse puis DNS direct.
//   1. IP -> nom d'hote. Le nom doit appartenir a un domaine officiel du moteur.
//   2. Ce nom d'hote -> IP. Elle doit retomber sur l'IP de depart.
// Une usurpation echoue a l'etape 1 (le rDNS de l'attaquant ne pointe pas chez Google)
// ou a l'etape 2 (un rDNS mensonger ne survit pas a la resolution directe).
//
// Ce que ce module ne fait JAMAIS: declarer "faux" un bot qu'il n'a pas pu verifier.
// Sans DNS joignable, le verdict est "non verifie", pas "usurpateur".

import { promises as dns } from "node:dns";

// Domaines officiels des crawlers verifiables par DNS inverse.
export const BOTS = [
  { id: "googlebot", label: "Googlebot", kind: "search", ua: /googlebot/i, hosts: [/\.googlebot\.com$/i, /\.google\.com$/i] },
  { id: "google-other", label: "GoogleOther", kind: "search", ua: /google-?other/i, hosts: [/\.googlebot\.com$/i, /\.google\.com$/i] },
  { id: "google-extended", label: "Google-Extended", kind: "ai-train", ua: /google-extended/i, hosts: [/\.googlebot\.com$/i, /\.google\.com$/i] },
  { id: "bingbot", label: "Bingbot", kind: "search", ua: /bingbot|adidxbot/i, hosts: [/\.search\.msn\.com$/i] },
  { id: "gptbot", label: "GPTBot", kind: "ai-train", ua: /gptbot/i, hosts: [/\.openai\.com$/i] },
  { id: "oai-searchbot", label: "OAI-SearchBot", kind: "ai-search", ua: /oai-searchbot/i, hosts: [/\.openai\.com$/i] },
  { id: "chatgpt-user", label: "ChatGPT-User", kind: "ai-search", ua: /chatgpt-user/i, hosts: [/\.openai\.com$/i] },
  { id: "perplexitybot", label: "PerplexityBot", kind: "ai-search", ua: /perplexitybot/i, hosts: [/\.perplexity\.ai$/i, /\.perplexity\.com$/i] },
  { id: "perplexity-user", label: "Perplexity-User", kind: "ai-search", ua: /perplexity-user/i, hosts: [/\.perplexity\.ai$/i, /\.perplexity\.com$/i] },
  { id: "claudebot", label: "ClaudeBot", kind: "ai-train", ua: /claudebot/i, hosts: [/\.anthropic\.com$/i] },
  { id: "claude-user", label: "Claude-User", kind: "ai-search", ua: /claude-user/i, hosts: [/\.anthropic\.com$/i] },
  { id: "applebot", label: "Applebot", kind: "search", ua: /applebot/i, hosts: [/\.applebot\.apple\.com$/i] },
  { id: "ccbot", label: "CCBot", kind: "ai-train", ua: /ccbot/i, hosts: [] },
  { id: "bytespider", label: "Bytespider", kind: "ai-train", ua: /bytespider/i, hosts: [] },
  { id: "meta-externalagent", label: "meta-externalagent", kind: "ai-train", ua: /meta-externalagent|facebookexternalhit/i, hosts: [/\.facebook\.com$/i] },
  { id: "yandexbot", label: "YandexBot", kind: "search", ua: /yandexbot/i, hosts: [/\.yandex\.(ru|com|net)$/i] },
];

// Outils SEO et scrapers connus. Ils ne sont pas malveillants, mais les compter comme
// du trafic de moteur fausserait toutes les moyennes de budget d'exploration.
const TOOLS = /(ahrefsbot|semrushbot|mj12bot|dotbot|blexbot|dataforseo|screaming frog|sitebulb|serpstat|petalbot|seokicks|barkrowler)/i;

export function identify(ua) {
  if (!ua) return null;
  for (const b of BOTS) if (b.ua.test(ua)) return b;
  if (TOOLS.test(ua)) return { id: "seo-tool", label: "Outil SEO tiers", kind: "tool", hosts: [] };
  return null;
}

/**
 * Verifie une IP par DNS inverse puis direct.
 * @returns "verified" | "spoofed" | "unverifiable" | "unknown"
 *   verified     = le double controle DNS confirme le moteur
 *   spoofed      = le rDNS repond, mais pas un domaine du moteur -> usurpation
 *   unverifiable = ce bot n'a pas de domaine officiel a verifier (CCBot, Bytespider)
 *   unknown      = le DNS n'a pas repondu. On ne conclut RIEN.
 */
export async function verifyIp(ip, bot, { timeoutMs = 3000 } = {}) {
  if (!bot?.hosts?.length) return { state: "unverifiable", reason: "aucun domaine officiel publie pour ce crawler" };
  try {
    const names = await withTimeout(dns.reverse(ip), timeoutMs);
    if (!names?.length) return { state: "spoofed", reason: "aucun nom d'hote associe a cette IP" };
    const match = names.find((n) => bot.hosts.some((h) => h.test(n)));
    if (!match) return { state: "spoofed", reason: `rDNS ${names[0]} hors des domaines de ${bot.label}`, host: names[0] };

    // Deuxieme moitie du controle: un rDNS peut mentir, la resolution directe non.
    const back = await withTimeout(dns.resolve(match).catch(() => dns.resolve6(match)), timeoutMs);
    if (Array.isArray(back) && back.includes(ip)) return { state: "verified", host: match };
    return { state: "spoofed", reason: `${match} ne resout pas vers ${ip}`, host: match };
  } catch (e) {
    // NXDOMAIN sur le rDNS = l'IP ne se reclame de personne: c'est une usurpation.
    if (e?.code === "ENOTFOUND" || e?.code === "ENODATA") {
      return { state: "spoofed", reason: "aucun DNS inverse pour cette IP" };
    }
    return { state: "unknown", reason: "DNS injoignable" };
  }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);
}

/**
 * Verifie un echantillon d'IPs par bot. On ne verifie pas des millions de lignes:
 * les IPs les plus actives suffisent a etablir si le trafic annonce est authentique.
 */
export async function verifySample(byBot, { perBot = 3, concurrency = 4 } = {}) {
  const jobs = [];
  for (const [botId, data] of Object.entries(byBot)) {
    const bot = BOTS.find((b) => b.id === botId) || (botId === "seo-tool" ? { id: botId, hosts: [] } : null);
    const top = [...(data.ips || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, perBot);
    for (const [ip, hits] of top) jobs.push({ botId, bot, ip, hits });
  }
  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      const r = await verifyIp(j.ip, j.bot);
      results.push({ ...j, ...r });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) || 1 }, worker));

  // Synthese par bot: un bot est authentifie si au moins une de ses IPs passe le
  // double controle, et usurpe si aucune ne passe alors qu'au moins une a repondu.
  const summary = {};
  for (const r of results) {
    const s = summary[r.botId] || (summary[r.botId] = { checked: 0, verified: 0, spoofed: 0, unknown: 0, unverifiable: 0, samples: [] });
    s.checked++;
    s[r.state]++;
    if (s.samples.length < 3) s.samples.push({ ip: r.ip, hits: r.hits, state: r.state, host: r.host, reason: r.reason });
  }
  for (const s of Object.values(summary)) {
    s.verdict = s.verified > 0 ? "authentique"
      : s.spoofed > 0 && s.unknown === 0 ? "usurpe"
      : s.unverifiable > 0 && s.spoofed === 0 ? "non verifiable"
      : "indetermine";
  }
  return summary;
}
