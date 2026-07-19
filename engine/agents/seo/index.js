// Panoptic - Agent SEO technique, version multi-pages (crawler + analyse inter-pages).
// Crawle le site (a partir du contexte partage), agrege les problemes par page, et
// detecte ce qu'un check d'une seule page ne peut pas voir: titres/metas dupliques,
// liens internes casses, incoherences a l'echelle du site.
import { makeFinding, meta } from "../shared.js";
import { crawl, checkLinks } from "../../crawl.js";

export async function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const home = scope.home.body;
  const F = (r) => findings.push(makeFinding("seo", "visibilite", { url, ...r }));

  // --- Crawl (amorce avec la page deja recuperee par la recon) ---
  const c = await crawl(scope.target, { seedUrl: url, seedHtml: home, seedHeaders: { status: scope.home.status }, maxPages: 12, budgetMs: 12000 });
  const ok = c.pages.filter((p) => p.status === 200 && !p.error);
  const shortUrl = (u) => u.replace(scope.origin, "") || "/";

  // --- Problemes agreges par page (une entree par regle, listant les pages) ---
  const noTitle = ok.filter((p) => !p.title).map((p) => shortUrl(p.url));
  if (noTitle.length) F({ rule: "missing-title", severity: "high", effort: 0.2, title: `Balise <title> absente sur ${noTitle.length} page(s)`, fix: "Ajouter un title unique de 50-60 caracteres par page.", proof: noTitle.slice(0, 8).join(", ") });

  const noDesc = ok.filter((p) => !p.desc).map((p) => shortUrl(p.url));
  if (noDesc.length) F({ rule: "missing-meta-desc", severity: "medium", effort: 0.3, title: `Meta description absente sur ${noDesc.length} page(s)`, fix: "Rediger une meta description de 120-155 caracteres par page.", proof: noDesc.slice(0, 8).join(", ") });

  const noH1 = ok.filter((p) => p.h1 === 0).map((p) => shortUrl(p.url));
  if (noH1.length) F({ rule: "missing-h1", severity: "medium", effort: 0.3, title: `Aucun <h1> sur ${noH1.length} page(s)`, fix: "Ajouter un h1 unique et descriptif par page.", proof: noH1.slice(0, 8).join(", ") });
  const multiH1 = ok.filter((p) => p.h1 > 1).map((p) => shortUrl(p.url));
  if (multiH1.length) F({ rule: "multiple-h1", severity: "low", effort: 0.3, title: `Plusieurs <h1> sur ${multiH1.length} page(s)`, fix: "Conserver un seul h1 par page.", proof: multiH1.slice(0, 8).join(", ") });

  const noCanon = ok.filter((p) => !p.canonical).map((p) => shortUrl(p.url));
  if (noCanon.length) F({ rule: "missing-canonical", severity: "medium", effort: 0.2, title: `Balise canonical absente sur ${noCanon.length} page(s)`, fix: "Ajouter <link rel=canonical> auto-referent sur chaque page.", proof: noCanon.slice(0, 8).join(", ") });

  const noindexed = ok.filter((p) => p.noindex).map((p) => shortUrl(p.url));
  if (noindexed.length) F({ rule: "noindex-pages", severity: "high", effort: 0.2, title: `${noindexed.length} page(s) en noindex (exclues de l'index)`, fix: "Verifier que ces pages doivent bien etre desindexees.", proof: noindexed.slice(0, 8).join(", ") });

  const thin = ok.filter((p) => p.words > 0 && p.words < 120).map((p) => shortUrl(p.url));
  if (thin.length) F({ rule: "thin-content", severity: "low", effort: 0.5, title: `Contenu pauvre (<120 mots) sur ${thin.length} page(s)`, fix: "Etoffer le contenu editorial de ces pages.", proof: thin.slice(0, 8).join(", ") });

  // --- Inter-pages: TITRES dupliques (invisible pour un check d'une page) ---
  dupGroups(ok, "title").forEach((g) => F({ rule: "duplicate-title", severity: "medium", effort: 0.3, title: `Title identique sur ${g.pages.length} pages: "${g.value.slice(0, 50)}"`, fix: "Rendre chaque title unique.", proof: g.pages.slice(0, 8).join(", ") }));
  dupGroups(ok, "desc").forEach((g) => F({ rule: "duplicate-meta-desc", severity: "low", effort: 0.3, title: `Meta description identique sur ${g.pages.length} pages`, fix: "Rediger une description unique par page.", proof: g.pages.slice(0, 8).join(", ") }));

  // --- Inter-pages: LIENS INTERNES CASSES ---
  const visitedUrls = new Set(ok.map((p) => p.url));
  const brokenVisited = c.pages.filter((p) => p.status >= 400 || p.error).map((p) => `${shortUrl(p.url)} (${p.error ? "injoignable" : p.status})`);
  const toCheck = c.linkTargets.filter((u) => !visitedUrls.has(u));
  const checked = await checkLinks(toCheck, { cap: 20 });
  const brokenLinks = checked.filter((l) => l.status >= 400 || l.status === 0).map((l) => `${shortUrl(l.url)} (${l.status || "injoignable"})`);
  const allBroken = [...brokenVisited, ...brokenLinks];
  if (allBroken.length) F({ rule: "broken-internal-links", severity: "high", effort: 0.4, title: `${allBroken.length} lien(s) interne(s) casse(s) (4xx/5xx)`, fix: "Corriger ou rediriger les URLs cassees; mettre a jour les liens.", proof: allBroken.slice(0, 10).join(", ") });

  // --- Homepage / site: signaux uniques (une seule verification pertinente) ---
  if (!meta(home, 'name=["\']viewport')) F({ rule: "missing-viewport", severity: "high", effort: 0.1, title: "Meta viewport absente (non mobile-friendly)", fix: "Ajouter <meta name=viewport content='width=device-width, initial-scale=1'>.", proof: "Accueil sans viewport." });
  if (!meta(home, 'property=["\']og:title')) F({ rule: "missing-og", severity: "low", effort: 0.2, title: "Open Graph absent (partage social degrade)", fix: "Ajouter og:title, og:description, og:image.", proof: "Accueil sans og:title." });
  if (!/application\/ld\+json/i.test(home)) F({ rule: "no-structured-data", severity: "low", effort: 0.4, title: "Aucune donnee structuree (Schema.org)", fix: "Ajouter du JSON-LD (Organization, WebSite, BreadcrumbList).", proof: "Accueil sans ld+json." });
  if (!scope.sitemap.present) F({ rule: "no-sitemap", severity: "medium", effort: 0.3, title: "sitemap.xml absent", fix: "Generer et referencer un sitemap.xml.", proof: "sitemap.xml introuvable." });
  if (!scope.robots.present) F({ rule: "no-robots", severity: "low", effort: 0.1, title: "robots.txt absent", fix: "Ajouter un robots.txt referencant le sitemap.", proof: "robots.txt introuvable." });

  return { findings, stats: { crawled: c.stats.crawled, discovered: c.stats.discovered, linksChecked: checked.length, broken: allBroken.length, truncated: c.truncated, ms: c.stats.ms } };
}

// Regroupe les pages partageant une meme valeur non vide pour la cle donnee.
function dupGroups(pages, key) {
  const map = new Map();
  for (const p of pages) {
    const v = p[key];
    if (!v) continue;
    const k = v.toLowerCase();
    (map.get(k) || map.set(k, { value: v, pages: [] }).get(k)).pages.push(p.url.replace(/^https?:\/\/[^/]+/, "") || "/");
  }
  return [...map.values()].filter((g) => g.pages.length > 1);
}
