// Panoptic SEO KING - lecture de logs serveur, en flux.
//
// Un fichier de logs fait couramment plusieurs centaines de Mo. Le lire en memoire
// ferait tomber l'instance: on le parcourt donc ligne par ligne, en flux, et on
// n'agrege que des compteurs. Le fichier peut etre gzippe, c'est le cas le plus
// frequent des exports d'hebergeur.
//
// Quatre formats couverts, parce que c'est ce qu'on recoit reellement d'un client:
//   - Combined / NCSA  (Apache, Nginx par defaut)
//   - Common / CLF     (Combined sans referer ni user-agent)
//   - JSON par ligne   (Cloudflare Logpush, Netlify, la plupart des CDN modernes)
//   - W3C etendu       (IIS, avec sa ligne #Fields qui declare les colonnes)
//
// Le format n'est pas demande a l'utilisateur: on le detecte sur les premieres
// lignes. Un client qui doit deviner le format de ses propres logs n'enverra rien.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream";

// Combined: IP - user [10/Oct/2026:13:55:36 +0200] "GET /p HTTP/1.1" 200 2326 "ref" "ua"
const COMBINED = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?/;

export function detectFormat(lines) {
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith("#Fields:")) return "w3c";
    if (t.startsWith("{")) return "json";
    if (COMBINED.test(t)) return "combined";
  }
  return null;
}

function parseCombined(line) {
  const m = COMBINED.exec(line);
  if (!m) return null;
  return {
    ip: m[1],
    time: parseApacheDate(m[3]),
    method: m[4],
    path: stripQuery(m[5]),
    fullPath: m[5],
    status: Number(m[6]),
    bytes: m[7] === "-" ? 0 : Number(m[7]) || 0,
    referer: m[8] && m[8] !== "-" ? m[8] : null,
    ua: m[9] || null,
  };
}

// Les CDN n'emploient pas les memes noms de champs: on accepte les alias courants
// plutot que d'imposer un schema au client.
const J = {
  ip: ["ClientIP", "clientIp", "client_ip", "remote_addr", "ip", "c-ip", "RemoteIP"],
  ua: ["ClientRequestUserAgent", "user_agent", "userAgent", "http_user_agent", "ua", "cs(User-Agent)"],
  path: ["ClientRequestURI", "ClientRequestPath", "request_uri", "path", "url", "uri", "cs-uri-stem"],
  status: ["EdgeResponseStatus", "OriginResponseStatus", "status", "response_status", "sc-status", "statusCode"],
  time: ["EdgeStartTimestamp", "timestamp", "time", "datetime", "@timestamp", "date"],
  method: ["ClientRequestMethod", "method", "request_method", "cs-method"],
  bytes: ["EdgeResponseBytes", "bytes", "body_bytes_sent", "sc-bytes"],
  referer: ["ClientRequestReferer", "referer", "referrer", "http_referer"],
};
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; return null; };

function parseJsonLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const path = pick(o, J.path);
  if (!path) return null;
  const st = pick(o, J.status);
  return {
    ip: String(pick(o, J.ip) || ""),
    time: parseAnyDate(pick(o, J.time)),
    method: String(pick(o, J.method) || "GET").toUpperCase(),
    path: stripQuery(String(path)),
    fullPath: String(path),
    status: Number(st) || 0,
    bytes: Number(pick(o, J.bytes)) || 0,
    referer: pick(o, J.referer) || null,
    ua: pick(o, J.ua) || null,
  };
}

function makeW3cParser(fieldsLine) {
  const fields = fieldsLine.replace(/^#Fields:\s*/, "").trim().split(/\s+/);
  const idx = (name) => fields.indexOf(name);
  const i = {
    date: idx("date"), time: idx("time"), ip: idx("c-ip"), method: idx("cs-method"),
    uri: idx("cs-uri-stem"), status: idx("sc-status"), ua: idx("cs(User-Agent)"), bytes: idx("sc-bytes"),
  };
  return (line) => {
    const p = line.split(/\s+/);
    if (i.uri < 0 || !p[i.uri]) return null;
    return {
      ip: i.ip >= 0 ? p[i.ip] : "",
      time: i.date >= 0 && i.time >= 0 ? parseAnyDate(`${p[i.date]}T${p[i.time]}Z`) : null,
      method: i.method >= 0 ? p[i.method] : "GET",
      path: stripQuery(p[i.uri]),
      fullPath: p[i.uri],
      status: i.status >= 0 ? Number(p[i.status]) || 0 : 0,
      bytes: i.bytes >= 0 ? Number(p[i.bytes]) || 0 : 0,
      referer: null,
      // IIS remplace les espaces du user-agent par des "+".
      ua: i.ua >= 0 && p[i.ua] ? p[i.ua].replace(/\+/g, " ") : null,
    };
  };
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseApacheDate(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]);
  if (Number.isNaN(ms)) return null;
  if (m[7]) {
    const sign = m[7][0] === "-" ? 1 : -1;
    return ms + sign * ((+m[7].slice(1, 3)) * 3600000 + (+m[7].slice(3, 5)) * 60000);
  }
  return ms;
}
function parseAnyDate(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 1e12 ? Math.round(v / 1000) : v * 1000 > 1e12 ? v : v * 1000;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}
function stripQuery(p) {
  const i = String(p).indexOf("?");
  return i < 0 ? String(p) : String(p).slice(0, i);
}

/**
 * Parcourt un fichier de logs en flux et remet chaque entree a onEntry.
 * Ne conserve AUCUNE ligne: c'est l'appelant qui decide quoi agreger.
 */
export async function streamLog(filePath, onEntry, { maxLines = 5_000_000 } = {}) {
  const stats = { lines: 0, parsed: 0, skipped: 0, format: null, firstTime: null, lastTime: null };
  const gz = /\.gz$/i.test(filePath);
  const raw = createReadStream(filePath);
  const input = gz ? raw.pipe(createGunzip()) : raw;
  const rl = createInterface({ input, crlfDelay: Infinity });

  let parser = null;
  const sniff = [];

  for await (const line of rl) {
    if (stats.lines >= maxLines) break;
    stats.lines++;
    const t = line.trim();
    if (!t) continue;

    // Ligne de declaration W3C: elle definit les colonnes, elle peut apparaitre
    // plusieurs fois dans un meme fichier (rotation).
    if (t.startsWith("#")) {
      if (t.startsWith("#Fields:")) { parser = makeW3cParser(t); stats.format = "w3c"; }
      continue;
    }

    if (!parser) {
      sniff.push(t);
      const fmt = detectFormat(sniff);
      if (!fmt && sniff.length < 20) continue;
      stats.format = fmt || "combined";
      parser = stats.format === "json" ? parseJsonLine : parseCombined;
      // On rejoue les lignes mises de cote pendant la detection.
      for (const s of sniff) {
        const e = parser(s);
        if (e) { stats.parsed++; track(stats, e); onEntry(e); } else stats.skipped++;
      }
      sniff.length = 0;
      continue;
    }

    const e = parser(t);
    if (e) { stats.parsed++; track(stats, e); onEntry(e); } else stats.skipped++;
  }

  rl.close();
  raw.destroy();
  return stats;
}

function track(stats, e) {
  if (!e.time) return;
  if (stats.firstTime == null || e.time < stats.firstTime) stats.firstTime = e.time;
  if (stats.lastTime == null || e.time > stats.lastTime) stats.lastTime = e.time;
}
