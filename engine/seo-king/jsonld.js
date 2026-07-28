// Panoptic SEO KING - extraction et validation du JSON-LD.
//
// Trois niveaux, dans cet ordre, parce qu'ils echouent differemment:
//   1. Syntaxe   : un bloc non parsable est purement ignore par Google. Pire que rien,
//                  parce que l'equipe croit avoir des donnees structurees.
//   2. Graphe    : @graph et references @id. Un @id qui ne resout pas casse le lien
//                  entre l'Organization et le WebSite, donc l'entite de marque.
//   3. Semantique: proprietes requises par type (exigences Google Rich Results).
//                  Une propriete requise manquante = pas d'eligibilite, silencieusement.

export function extractBlocks(html = "") {
  const blocks = [];
  const re = /<script\b([^>]*)\btype\s*=\s*["']application\/ld\+json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[3].trim();
    // Un CDATA wrapper est legal et casse JSON.parse si on ne le retire pas.
    const body = raw.replace(/^\s*\/\/?\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
    let parsed = null, error = null;
    try { parsed = JSON.parse(body); } catch (e) { error = e.message; }
    blocks.push({ raw: body, parsed, error, index: blocks.length });
  }
  return blocks;
}

// Aplatit @graph et les tableaux racine en une liste de noeuds typables.
export function flattenNodes(blocks) {
  const nodes = [];
  const walk = (obj, blockIndex, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 6) return;
    if (Array.isArray(obj)) { for (const o of obj) walk(o, blockIndex, depth + 1); return; }
    if (Array.isArray(obj["@graph"])) { for (const o of obj["@graph"]) walk(o, blockIndex, depth + 1); }
    if (obj["@type"]) nodes.push({ node: obj, blockIndex, types: typesOf(obj), id: obj["@id"] || null });
    // Les noeuds imbriques comptent (ex: Organization dans publisher d'un Article).
    for (const [k, v] of Object.entries(obj)) {
      if (k === "@graph" || k === "@context") continue;
      if (v && typeof v === "object") walk(v, blockIndex, depth + 1);
    }
  };
  for (const b of blocks) if (b.parsed) walk(b.parsed, b.index);
  return nodes;
}

export function typesOf(node) {
  const t = node?.["@type"];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).replace(/^https?:\/\/schema\.org\//, ""));
}

// Exigences Google Rich Results, sous-ensemble utile. `req` = sans elle, aucune
// eligibilite. `rec` = fortement recommande, absence = affichage degrade.
// `note` porte l'avertissement metier quand le type lui-meme est un piege.
export const TYPE_RULES = {
  Organization: { req: ["name"], rec: ["url", "logo", "sameAs", "description"] },
  LocalBusiness: { req: ["name", "address"], rec: ["telephone", "openingHours", "geo", "priceRange", "url"] },
  WebSite: { req: ["name", "url"], rec: ["publisher"] },
  WebPage: { req: [], rec: ["name", "description", "isPartOf", "inLanguage"] },
  BreadcrumbList: { req: ["itemListElement"], rec: [] },
  Product: { req: ["name"], rec: ["image", "description", "offers", "brand", "sku"] },
  Offer: { req: ["price", "priceCurrency"], rec: ["availability", "url", "priceValidUntil"] },
  Article: { req: ["headline"], rec: ["image", "datePublished", "dateModified", "author", "publisher"] },
  BlogPosting: { req: ["headline"], rec: ["image", "datePublished", "dateModified", "author", "publisher"] },
  NewsArticle: { req: ["headline"], rec: ["image", "datePublished", "dateModified", "author", "publisher"] },
  FAQPage: {
    req: ["mainEntity"], rec: [],
    // Google a retire les rich results FAQ le 7 mai 2026 (hors sites sante/gouvernement).
    // Le balisage garde de la valeur pour la citation IA: on ne le retire pas, on ne le
    // recommande simplement plus pour gagner un affichage SERP.
    note: "info:faq-no-serp",
  },
  Question: { req: ["name", "acceptedAnswer"], rec: [] },
  Answer: { req: ["text"], rec: [] },
  SoftwareApplication: { req: ["name"], rec: ["applicationCategory", "operatingSystem", "offers", "aggregateRating"] },
  Service: { req: ["name"], rec: ["provider", "areaServed", "serviceType", "offers"] },
  Person: { req: ["name"], rec: ["jobTitle", "url", "sameAs", "worksFor"] },
  Event: { req: ["name", "startDate", "location"], rec: ["endDate", "offers", "eventStatus", "organizer"] },
  Review: { req: ["reviewRating"], rec: ["author", "itemReviewed", "datePublished"] },
  AggregateRating: { req: ["ratingValue"], rec: ["reviewCount", "ratingCount", "bestRating"] },
  VideoObject: { req: ["name", "thumbnailUrl", "uploadDate"], rec: ["description", "duration", "contentUrl"] },
  JobPosting: { req: ["title", "datePosted", "hiringOrganization"], rec: ["jobLocation", "baseSalary", "employmentType"] },
  Course: { req: ["name", "description"], rec: ["provider", "offers", "hasCourseInstance"] },
  Recipe: { req: ["name", "recipeIngredient", "recipeInstructions"], rec: ["image", "totalTime", "recipeYield"] },
  // HowTo: rich results retires par Google. Le conserver ne nuit pas, en ajouter
  // pour gagner un affichage SERP est une perte de temps qu'on signale.
  HowTo: { req: ["name", "step"], rec: [], note: "info:howto-retired" },
};

function has(node, prop) {
  const v = node[prop];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Une reference @id est "externe" si elle designe un autre domaine que celui audite.
// Sans origine connue, on considere externe tout @id absolu portant un domaine: la
// prudence va toujours vers le NON-signalement.
function isExternalRef(id, siteOrigin) {
  if (!/^https?:\/\//i.test(id)) return false;
  if (!siteOrigin) return true;
  try { return new URL(id).origin !== siteOrigin; } catch { return true; }
}

// Valide chaque noeud contre TYPE_RULES et resout les references @id du graphe.
// siteOrigin permet de distinguer une reference interne cassee d'un lien externe legitime.
export function validate(blocks, siteOrigin = null) {
  const nodes = flattenNodes(blocks);
  const ids = new Set(nodes.map((n) => n.id).filter(Boolean));
  const issues = [];
  const typeCount = {};

  for (const b of blocks) {
    if (b.error) issues.push({ kind: "syntax", blockIndex: b.index, message: b.error, snippet: b.raw.slice(0, 160) });
    else if (b.parsed && !b.parsed["@context"] && !Array.isArray(b.parsed)) {
      issues.push({ kind: "no-context", blockIndex: b.index, message: "@context absent", snippet: b.raw.slice(0, 120) });
    }
  }

  for (const n of nodes) {
    for (const t of n.types) {
      typeCount[t] = (typeCount[t] || 0) + 1;
      const rule = TYPE_RULES[t];
      if (!rule) continue;
      const missingReq = rule.req.filter((p) => !has(n.node, p));
      const missingRec = rule.rec.filter((p) => !has(n.node, p));
      if (missingReq.length) issues.push({ kind: "missing-required", type: t, props: missingReq, blockIndex: n.blockIndex, id: n.id });
      if (missingRec.length) issues.push({ kind: "missing-recommended", type: t, props: missingRec, blockIndex: n.blockIndex, id: n.id });
      if (rule.note) issues.push({ kind: "note", type: t, note: rule.note, blockIndex: n.blockIndex });
    }
    // Reference @id qui ne resout nulle part: le graphe est casse en silence.
    // MAIS une reference vers un URI EXTERNE (Wikidata, une page d'autorite, un autre
    // domaine du groupe) est parfaitement legitime en JSON-LD: le consommateur la
    // dereference lui-meme. On ne signale donc que les references internes non
    // resolues, celles ou l'auteur voulait manifestement pointer un noeud local.
    for (const [k, v] of Object.entries(n.node)) {
      if (k.startsWith("@")) continue;
      const refs = Array.isArray(v) ? v : [v];
      for (const r of refs) {
        if (!r || typeof r !== "object" || !r["@id"] || Object.keys(r).length !== 1) continue;
        if (ids.has(r["@id"])) continue;
        if (isExternalRef(r["@id"], siteOrigin)) continue;
        issues.push({ kind: "dangling-id", prop: k, ref: r["@id"], blockIndex: n.blockIndex, type: n.types[0] });
      }
    }
  }

  // AggregateRating sans aucune Review ni reviewCount: signal de note fabriquee.
  // Google le sanctionne et c'est un risque juridique (pratique commerciale trompeuse).
  for (const n of nodes) {
    if (!n.types.includes("AggregateRating")) continue;
    const hasCount = has(n.node, "reviewCount") || has(n.node, "ratingCount");
    if (!hasCount) issues.push({ kind: "rating-without-count", blockIndex: n.blockIndex });
  }

  return { nodes, issues, typeCount, blockCount: blocks.length, parsedCount: blocks.filter((b) => b.parsed).length };
}

// Cherche le premier noeud d'un type donne (utile pour la lane entite).
export function findNode(nodes, type) {
  return nodes.find((n) => n.types.includes(type))?.node || null;
}

// Normalise une valeur schema en tableau de chaines (sameAs, author, etc.).
export function asStrings(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === "string" ? x : x?.url || x?.name || x?.["@id"] || null)).filter(Boolean).map(String);
}
