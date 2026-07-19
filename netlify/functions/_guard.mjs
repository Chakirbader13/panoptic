// Panoptic - garde de la fonction publique d'audit (offre gratuite).
// Deux protections, car chaque appel lance le moteur complet (crawl + 15 agents):
//   1. rateLimit  : quota par IP + plafond global, etat partage via Netlify Blobs
//                   (survit aux cold starts, contrairement a un compteur en memoire).
//   2. validateTarget : garde SSRF de base (refuse localhost / IP privees / metadata).
//
// Note: la garde SSRF est litterale (hostname). Elle bloque les cas triviaux
// (http://169.254.169.254, http://localhost, 10.x...) mais pas le DNS rebinding
// ni un domaine public resolvant vers une IP interne. Defense en profondeur a part.
import { getStore } from "@netlify/blobs";

const WINDOW_MS = 10 * 60 * 1000; // fenetre glissante de 10 minutes
const PER_IP = 5;                 // 5 audits / 10 min / IP
const GLOBAL = 60;                // plafond global 60 audits / 10 min (borne le cout)

function clientIp(req) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

// Compteur fenetre-fixe auto-reinitialise: UNE cle par sujet (borne le nombre de blobs
// au nombre d'IP distinctes, pas au nombre de fenetres). Pas de controle de concurrence
// dans Blobs (last-write-wins): sous forte concurrence le compte peut legerement
// sous-estimer, c'est acceptable pour une protection anti-abus.
async function hit(store, key, limit, window) {
  let rec = null;
  try { rec = await store.get(key, { type: "json" }); } catch { rec = null; }
  if (!rec || rec.w !== window) rec = { w: window, c: 0 };
  if (rec.c >= limit) return false;
  rec.c += 1;
  try { await store.setJSON(key, rec); } catch { /* erreur de store -> fail-open */ }
  return true;
}

function retryAfter(window) {
  const nextWindowStart = (window + 1) * WINDOW_MS;
  return Math.max(1, Math.ceil((nextWindowStart - Date.now()) / 1000));
}

export async function rateLimit(req) {
  let store;
  try {
    store = getStore({ name: "panoptic-ratelimit", consistency: "strong" });
  } catch {
    return { ok: true }; // Blobs indisponible (dev local non configure) -> ne bloque pas
  }
  const window = Math.floor(Date.now() / WINDOW_MS);
  // IP d'abord: un abuseur atteint son quota (5) sans consommer le budget global.
  if (!(await hit(store, `ip:${clientIp(req)}`, PER_IP, window)))
    return { ok: false, scope: "ip", retryAfter: retryAfter(window) };
  if (!(await hit(store, "global", GLOBAL, window)))
    return { ok: false, scope: "global", retryAfter: retryAfter(window) };
  return { ok: true };
}

// --- Garde SSRF litterale -------------------------------------------------
const BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|ip6-localhost)$/i;

function isPrivateIp(host) {
  // IPv4 litterale
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64.0.0/10
    return false;
  }
  // IPv6 loopback / link-local / unique-local
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

// Retourne { ok, url } ou { ok:false, error }. Normalise la cible (ajoute https:// si absent).
export function validateTarget(target) {
  if (!target || typeof target !== "string") return { ok: false, error: "url cible requise" };
  let raw = target.trim();
  // Prefixe https:// uniquement si AUCUN schema n'est present (sinon ftp:// etc.
  // recevrait https:// et passerait la garde). Un schema present est valide plus bas.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "https://" + raw;
  let url;
  try { url = new URL(raw); } catch { return { ok: false, error: "url invalide" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "protocole non autorise (http/https uniquement)" };
  const host = url.hostname;
  if (BLOCKED_HOST.test(host) || isPrivateIp(host))
    return { ok: false, error: "cible non autorisee (adresse interne/privee)" };
  return { ok: true, url: url.href };
}
