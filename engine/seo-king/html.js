// Panoptic SEO KING - extraction HTML riche, sans dependance.
// Le moteur n'embarque pas de parseur DOM: on extrait ce dont les lanes ont besoin
// avec des regex tolerantes, et on assume les limites (commentaires, attributs
// exotiques). Chaque extracteur renvoie des donnees BRUTES: aucune interpretation
// ici, l'interpretation appartient aux lanes.

const RE_COMMENT = /<!--[\s\S]*?-->/g;
const RE_SCRIPT_STYLE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function stripNoise(html = "") {
  return html.replace(RE_COMMENT, " ").replace(RE_SCRIPT_STYLE, " ");
}

// Texte visible approximatif. Conserve les separateurs de bloc pour ne pas coller
// deux phrases de deux paragraphes differents (fausserait la lisibilite).
export function textOf(html = "") {
  return stripNoise(html)
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|br)>/gi, " \n")
    .replace(/<br\b[^>]*>/gi, " \n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:lt|gt|quot|#39|apos|rsquo|laquo|raquo|hellip|eacute|egrave|agrave|ccedil|ugrave|ocirc|icirc|acirc|ecirc|ucirc|euml|iuml|ouml|auml|uuml|[a-z#0-9]+);/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function wordCount(text = "") {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

// --- Attributs ---------------------------------------------------------------------
export function attrOf(openTag = "", name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(openTag);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

export function openTags(html = "", name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

// --- Metadonnees --------------------------------------------------------------------
// Renvoie TOUTES les metas sous forme normalisee, pour que les lanes puissent
// detecter les doublons (deux <title>, deux canonical: erreur frequente et invisible).
export function metaMap(html = "") {
  const out = { name: {}, property: {}, httpEquiv: {}, charset: null, duplicates: [] };
  for (const t of openTags(html, "meta")) {
    const charset = attrOf(t, "charset");
    if (charset) { out.charset = charset; continue; }
    const content = attrOf(t, "content");
    const name = attrOf(t, "name");
    const prop = attrOf(t, "property");
    const he = attrOf(t, "http-equiv");
    const put = (bucket, key) => {
      if (!key) return;
      const k = key.toLowerCase();
      if (bucket[k] != null && bucket[k] !== content) out.duplicates.push(k);
      bucket[k] = content ?? "";
    };
    put(out.name, name);
    put(out.property, prop);
    put(out.httpEquiv, he);
  }
  return out;
}

export function titles(html = "") {
  return [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "").trim()));
}

// <link rel=...> normalises: canonical, alternate/hreflang, prev/next, amphtml.
export function linkRels(html = "") {
  const out = [];
  for (const t of openTags(html, "link")) {
    const rel = (attrOf(t, "rel") || "").toLowerCase();
    if (!rel) continue;
    out.push({ rel, href: attrOf(t, "href"), hreflang: (attrOf(t, "hreflang") || "").toLowerCase() || null, type: attrOf(t, "type"), media: attrOf(t, "media"), raw: t });
  }
  return out;
}

// --- Structure de titres -------------------------------------------------------------
// Renvoie l'arbre a plat, dans l'ordre du document, avec le niveau et le texte.
// Les lanes en tirent: absence de h1, h1 multiples, sauts de niveau, titres vides.
export function headings(html = "") {
  const clean = stripNoise(html);
  const out = [];
  for (const m of clean.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    out.push({ level: Number(m[1]), text, empty: text.length === 0, hidden: /aria-hidden\s*=\s*["']true["']|\bsr-only\b|\bvisually-hidden\b/i.test(m[2]) });
  }
  return out;
}

// Sauts de niveau (h2 -> h4). Ce n'est pas cosmetique: la hierarchie est ce qui
// permet a un moteur de reponse de decouper la page en passages citables.
export function headingSkips(hs) {
  const skips = [];
  let prev = 0;
  for (const h of hs) {
    if (prev && h.level > prev + 1) skips.push({ from: prev, to: h.level, text: h.text.slice(0, 60) });
    prev = h.level;
  }
  return skips;
}

// --- Liens ---------------------------------------------------------------------------
// Extrait href + ancre + rel + attributs. L'ancre est le signal le plus sous-exploite
// du maillage interne: sans elle on ne peut pas juger la diversite des ancres.
export function links(html = "", baseUrl, origin) {
  const clean = stripNoise(html);
  const out = [];
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const open = `<a${m[1]}>`;
    const href = attrOf(open, "href");
    if (!href) continue;
    const anchorRaw = m[2];
    const anchor = decodeEntities(anchorRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const imgAlt = /<img\b/i.test(anchorRaw) ? attrOf((anchorRaw.match(/<img\b[^>]*>/i) || [""])[0], "alt") : null;
    let abs = null, internal = false;
    try {
      const u = new URL(href, baseUrl);
      if (/^https?:$/.test(u.protocol)) { u.hash = ""; abs = u.href; internal = u.origin === origin; }
    } catch { /* href non resolvable: mailto, tel, javascript */ }
    out.push({
      href, abs, internal, anchor,
      anchorSource: anchor ? "text" : imgAlt ? "img-alt" : "none",
      effectiveAnchor: anchor || imgAlt || "",
      rel: (attrOf(open, "rel") || "").toLowerCase(),
      target: attrOf(open, "target"),
      ariaLabel: attrOf(open, "aria-label"),
    });
  }
  return out;
}

// --- Images ---------------------------------------------------------------------------
export function images(html = "") {
  return openTags(stripNoise(html), "img").map((t) => ({
    src: attrOf(t, "src") || attrOf(t, "data-src"),
    alt: attrOf(t, "alt"),
    hasAltAttr: /\balt\s*=/i.test(t),
    width: attrOf(t, "width"),
    height: attrOf(t, "height"),
    loading: (attrOf(t, "loading") || "").toLowerCase(),
    fetchpriority: (attrOf(t, "fetchpriority") || "").toLowerCase(),
    decorative: attrOf(t, "alt") === "" || /role\s*=\s*["']presentation["']/i.test(t),
  }));
}

// --- Divers ---------------------------------------------------------------------------
export function htmlLang(html = "") {
  const m = /<html\b[^>]*>/i.exec(html);
  return m ? (attrOf(m[0], "lang") || null) : null;
}

// Directives robots issues du HTML (meta name=robots + les variantes par moteur).
export function robotsDirectives(html = "") {
  const metas = metaMap(html).name;
  const parts = [];
  for (const key of ["robots", "googlebot", "bingbot"]) {
    if (metas[key]) parts.push({ source: `meta name="${key}"`, value: String(metas[key]).toLowerCase() });
  }
  const all = parts.map((p) => p.value).join(",");
  return {
    parts,
    noindex: /\bnoindex\b/.test(all),
    nofollow: /\bnofollow\b/.test(all),
    nosnippet: /\bnosnippet\b/.test(all),
    noarchive: /\bnoarchive\b/.test(all),
    maxSnippet: (/max-snippet\s*:\s*(-?\d+)/.exec(all) || [])[1] ?? null,
  };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", eacute: "e", egrave: "e", ecirc: "e", agrave: "a", ccedil: "c", ugrave: "u", ocirc: "o", icirc: "i", acirc: "a", euml: "e", rsquo: "'", laquo: '"', raquo: '"', hellip: "..." };
export function decodeEntities(s = "") {
  return s.replace(/&([a-z#0-9]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? ENTITIES[e] ?? " ");
}
