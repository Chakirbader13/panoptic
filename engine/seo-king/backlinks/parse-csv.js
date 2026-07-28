// Panoptic SEO KING - lecture d'un export de liens entrants, quelle qu'en soit l'origine.
//
// Choix delibere: on n'impose PAS un format. Chaque outil exporte le sien (Search
// Console, Ahrefs, Majestic, Moz, DataForSEO), et demander a l'utilisateur de le
// reformater garantit qu'il n'enverra rien. On detecte donc les colonnes utiles par
// leur nom, et a defaut par leur contenu.
//
// Consequence directe: le produit n'est lie a aucun fournisseur. L'utilisateur peut
// verifier des liens venant de l'outil qu'il paie deja.

// Noms de colonnes rencontres dans les exports reels, par role.
const COLS = {
  source: [
    "referring page url", "referring page", "source url", "source", "page source",
    "url de la page referente", "backlink", "from url", "link url", "page de destination",
    "origin url", "referring url", "url source",
  ],
  target: [
    "target url", "target", "url de destination", "to url", "destination url",
    "linked page", "page liee", "cible",
  ],
  anchor: ["anchor", "anchor text", "ancre", "texte d'ancrage", "link anchor"],
  type: ["type", "nofollow", "link type", "rel", "follow"],
  domain: ["referring domain", "domaine referent", "source domain", "domain", "site", "sites les plus liants", "top linking sites"],
};

// Analyse un CSV en tenant compte des guillemets et des virgules internes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text).replace(/^﻿/, "");   // BOM des exports Excel
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === "," || c === ";" || c === "\t") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s).trim());

/**
 * Extrait des liens entrants d'un export CSV, quel que soit l'outil d'origine.
 * @returns {{ links:[{source,target,anchor,type}], columns:object, rows:number, note?:string }}
 */
export function extractLinks(text, { targetHost } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { links: [], columns: {}, rows: 0, note: "fichier vide" };

  const header = rows[0].map(norm);
  const find = (names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const idx = {
    source: find(COLS.source),
    target: find(COLS.target),
    anchor: find(COLS.anchor),
    type: find(COLS.type),
    domain: find(COLS.domain),
  };

  let body = rows.slice(1);
  // Pas d'en-tete reconnaissable: on repere la colonne qui contient des URLs.
  if (idx.source < 0) {
    const probe = rows.slice(0, 8);
    let best = -1, bestScore = 0;
    const width = Math.max(...probe.map((r) => r.length));
    for (let c = 0; c < width; c++) {
      const score = probe.filter((r) => isUrl(r[c])).length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best >= 0 && bestScore >= 1) {
      idx.source = best;
      if (!header.some(isUrl)) body = rows.slice(1); else body = rows;
    }
  }

  const links = [];
  for (const r of body) {
    let source = idx.source >= 0 ? String(r[idx.source] || "").trim() : "";
    // Export "sites les plus liants" de la Search Console: un domaine, pas une URL.
    if (!isUrl(source) && idx.domain >= 0) {
      const d = String(r[idx.domain] || "").trim();
      if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) source = "https://" + d.replace(/^https?:\/\//, "");
    }
    if (!isUrl(source)) continue;
    links.push({
      source,
      target: idx.target >= 0 ? String(r[idx.target] || "").trim() || null : null,
      anchor: idx.anchor >= 0 ? String(r[idx.anchor] || "").trim() || null : null,
      type: idx.type >= 0 ? String(r[idx.type] || "").trim() || null : null,
    });
  }

  const domainOnly = links.length > 0 && links.every((l) => {
    try { return new URL(l.source).pathname === "/"; } catch { return false; }
  });

  return {
    links,
    columns: Object.fromEntries(Object.entries(idx).filter(([, v]) => v >= 0).map(([k, v]) => [k, rows[0][v]])),
    rows: body.length,
    // La Search Console n'exporte que des DOMAINES liants, pas les pages exactes. On
    // le signale: verifier une page d'accueil ne prouve pas que le lien profond existe.
    note: domainOnly ? "export au niveau domaine: seule la page d'accueil de chaque site referent sera verifiee" : undefined,
  };
}
