// Panoptic SEO KING - lecture des sitemaps XML sans dependance.
// Gere: urlset, sitemapindex (recursif, borne), lastmod/changefreq/priority,
// alternates xhtml:link, et le cas frequent du sitemap servi en text/html (404 mou).

const tagText = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i").exec(xml);
  return m ? decode(m[1].trim()) : null;
};

function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .trim();
}

export function isSitemapIndex(xml = "") {
  return /<sitemapindex\b/i.test(xml);
}

// Renvoie les entrees d'un urlset: { loc, lastmod, changefreq, priority, alternates[] }
export function parseUrlset(xml = "") {
  const out = [];
  for (const m of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const block = m[1];
    const loc = tagText(block, "loc");
    if (!loc) continue;
    const alternates = [...block.matchAll(/<(?:\w+:)?link\b[^>]*>/gi)]
      .map((l) => l[0])
      .filter((t) => /rel\s*=\s*["']alternate["']/i.test(t))
      .map((t) => ({
        hreflang: (/hreflang\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]?.toLowerCase() || null,
        href: decode((/href\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1] || ""),
      }))
      .filter((a) => a.href);
    out.push({
      loc,
      lastmod: tagText(block, "lastmod"),
      changefreq: tagText(block, "changefreq"),
      priority: tagText(block, "priority"),
      alternates,
    });
  }
  return out;
}

// Renvoie les sitemaps references par un index.
export function parseSitemapIndex(xml = "") {
  const out = [];
  for (const m of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = tagText(m[1], "loc");
    if (loc) out.push({ loc, lastmod: tagText(m[1], "lastmod") });
  }
  return out;
}

// Un lastmod valide est une date ISO 8601 (W3C Datetime). Google ignore le champ
// entier des qu'il est incoherent, donc un format faux = perte de signal de fraicheur.
export function parseLastmod(value) {
  if (!value) return { present: false };
  const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value);
  const t = Date.parse(value);
  if (Number.isNaN(t)) return { present: true, valid: false, iso: false, raw: value };
  return { present: true, valid: iso, iso, raw: value, ms: t };
}
