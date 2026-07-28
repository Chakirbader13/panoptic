// Panoptic SEO KING - client Search Console (donnees de position du proprietaire).
//
// Pourquoi la Search Console et pas un fournisseur SERP tiers: un audit est une
// radiographie de l'existant, pas un outil de veille concurrentielle. La donnee SERP
// tierce est une ESTIMATION statistique, souvent fausse sur la longue traine. La
// Search Console est la donnee du proprietaire, gratuite, exacte, et elle dit ce que
// Google a REELLEMENT servi. Pour un moteur dont l'argument est la verification,
// preferer une estimation payante a une mesure gratuite serait incoherent.
//
// Limite assumee et affichee: elle ne couvre QUE le site audite. Aucune comparaison
// concurrentielle n'est possible par ce canal, et on le dit plutot que de la simuler.
//
// Deux voies d'authentification, parce qu'un serveur et un poste de travail n'ont pas
// les memes contraintes:
//   1. PANOPTIC_GSC_TOKEN     : jeton d'acces deja obtenu (test, usage ponctuel)
//   2. PANOPTIC_GSC_SA        : chemin d'un compte de service JSON, signe en JWT ici
// Aucune de ces valeurs n'est jamais journalisee ni recopiee dans un finding.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function gscConfigured(env = process.env) {
  return Boolean(env.PANOPTIC_GSC_TOKEN || env.PANOPTIC_GSC_SA);
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Compte de service -> jeton d'acces, par JWT signe RS256. Pas de dependance: la
// signature est faite avec node:crypto.
async function tokenFromServiceAccount(saPath, nowMs) {
  let sa;
  try { sa = JSON.parse(readFileSync(saPath, "utf8")); } catch (e) { return { error: `compte de service illisible: ${e.message}` }; }
  if (!sa.client_email || !sa.private_key) return { error: "compte de service incomplet (client_email / private_key)" };

  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
    ...(sa.subject ? { sub: sa.subject } : {}),
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  let signature;
  try { signature = b64url(signer.sign(sa.private_key)); } catch (e) { return { error: `signature JWT impossible: ${e.message}` }; }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${signature}` }),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res.ok) {
    const detail = typeof res.text === "function" ? await res.text().catch(() => "") : res.statusText;
    return { error: `echange de jeton refuse: ${String(detail).slice(0, 160)}` };
  }
  const j = await res.json();
  return j.access_token ? { token: j.access_token } : { error: "aucun jeton retourne" };
}

export async function getToken(env = process.env, nowMs = Date.now()) {
  if (env.PANOPTIC_GSC_TOKEN) return { token: String(env.PANOPTIC_GSC_TOKEN).trim() };
  if (env.PANOPTIC_GSC_SA) return tokenFromServiceAccount(env.PANOPTIC_GSC_SA, nowMs);
  return { error: "aucune configuration Search Console" };
}

async function api(path, token, body, { timeout = 20000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(`${API}${path}`, {
      method: body ? "POST" : "GET",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non JSON */ }
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      // 403 sur une propriete = le compte n'y a pas acces. C'est la cause n1 et il
      // faut la nommer, sinon l'utilisateur cherche du cote de la cle.
      return { error: res.status === 403 ? `acces refuse a cette propriete (${msg})` : msg };
    }
    return { data: json };
  } catch (e) {
    return { error: e.name === "AbortError" ? "delai depasse" : e.message };
  } finally { clearTimeout(to); }
}

// Une propriete Search Console s'ecrit soit en prefixe d'URL, soit en domaine.
// On essaie les deux formes plutot que de demander laquelle a l'utilisateur.
export function propertyCandidates(origin, host) {
  const clean = String(host || "").replace(/^www\./, "");
  return [`${origin}/`, `sc-domain:${clean}`, `https://www.${clean}/`, `http://${clean}/`];
}

/**
 * Recupere les performances de recherche du site.
 * @returns { state, rows, property, error }
 */
export async function fetchSearchAnalytics({ origin, host, env = process.env, days = 90, rowLimit = 500, fetchImpl, nowMs = Date.now() } = {}) {
  const t = await getToken(env, nowMs);
  if (t.error) return { state: "not_measured", reason: t.error };

  const end = new Date(nowMs - 2 * 86400000).toISOString().slice(0, 10);   // GSC a ~2 jours de latence
  const start = new Date(nowMs - (days + 2) * 86400000).toISOString().slice(0, 10);
  const body = { startDate: start, endDate: end, dimensions: ["page", "query"], rowLimit, dataState: "final" };

  let lastError = null;
  for (const property of propertyCandidates(origin, host)) {
    const r = await api(`/sites/${encodeURIComponent(property)}/searchAnalytics/query`, t.token, body, { fetchImpl });
    if (r.error) { lastError = r.error; continue; }
    const rows = (r.data?.rows || []).map((x) => ({
      page: x.keys?.[0], query: x.keys?.[1],
      clicks: x.clicks || 0, impressions: x.impressions || 0,
      ctr: x.ctr || 0, position: x.position || 0,
    }));
    return { state: "observed", property, rows, period: { start, end, days } };
  }
  return { state: "not_measured", reason: lastError || "aucune propriete accessible" };
}

// Agrege par page: c'est la maille d'un audit (on corrige une page, pas une requete).
export function aggregateByPage(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.page) continue;
    const p = by.get(r.page) || { page: r.page, clicks: 0, impressions: 0, positionSum: 0, n: 0, queries: [] };
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.positionSum += r.position * r.impressions;
    p.n += r.impressions;
    if (p.queries.length < 5) p.queries.push({ query: r.query, impressions: r.impressions, position: Math.round(r.position * 10) / 10 });
    by.set(r.page, p);
  }
  return [...by.values()].map((p) => ({
    page: p.page, clicks: p.clicks, impressions: p.impressions,
    ctr: p.impressions ? p.clicks / p.impressions : 0,
    // Position moyenne PONDEREE par les impressions: une moyenne simple donnerait
    // autant de poids a une requete vue 3 fois qu'a une requete vue 30 000 fois.
    position: p.n ? Math.round((p.positionSum / p.n) * 10) / 10 : null,
    queries: p.queries.sort((a, b) => b.impressions - a.impressions),
  })).sort((a, b) => b.impressions - a.impressions);
}
