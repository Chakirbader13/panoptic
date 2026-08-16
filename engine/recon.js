// Panoptic - Couche 1: reconnaissance et scoping unifie.
// La promesse "un seul crawl": on recupere la page cible UNE fois, plus robots.txt,
// sitemap, llms.txt et quelques signaux, et on partage ce contexte a tous les agents.
// Les agents prod ne re-fetchent pas la page: ils lisent scope.home.
import { httpGet, httpHead, originOf, hostOf, elements, attr } from "./agents/shared.js";
import { crawl } from "./crawl.js";
import { makeRenderer, looksLikeSpa, browserAllowed } from "./scanners/browser.js";
import { extractFacts, urlTemplate } from "./seo-king/pagefacts.js";
import { parseUrlset } from "./seo-king/xml.js";

// Bascule entre le petit regime (HTML conserve, comportement historique) et le grand
// regime (faits extraits a la volee, HTML libere). 60 pages x ~100 Ko tient largement
// en memoire; 2000 pages non.
const LARGE_THRESHOLD = 60;
// Pages dont on conserve le HTML brut en grand regime: l'accueil plus un representant
// par gabarit d'URL. Au-dela, on decrit le meme gabarit une deuxieme fois pour rien.
const DETAIL_CAP = 50;
// Plancher du nombre de pages crawlees par gabarit d'URL. Le plafond reel est
// proportionnel au budget de pages (voir l'appel a crawl).
const TEMPLATE_CAP_MIN = 8;
// Nombre de pages dont on garde le HTML brut PAR type de page.
const DETAIL_PER_TEMPLATE = 4;

// Repartit le budget de crawl entre les types de pages du site.
//
// Ni "les N premieres du sitemap" (on ne verrait qu'une section), ni un tourniquet a
// parts egales (une section de 1500 fiches pese alors autant qu'une page isolee).
// Deux temps: un PLANCHER pour que chaque type soit represente, puis le reste au
// PRORATA du volume reel. Un type qui fait 70 % du site recoit ~70 % du budget restant.
function allocateByTemplate(urls, limit, floor = 8) {
  const buckets = new Map();
  for (const u of urls) {
    const t = urlTemplate(u);
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(u);
  }
  const entries = [...buckets.entries()];
  const quota = new Map();
  let used = 0;

  // 1. Plancher: chaque type a droit a un echantillon minimal.
  for (const [t, list] of entries) {
    const q = Math.min(list.length, floor);
    quota.set(t, q);
    used += q;
  }
  // 2. Reste au prorata du volume non encore couvert.
  let remaining = Math.max(0, limit - used);
  if (remaining > 0) {
    const rest = entries.map(([t, list]) => [t, list.length - quota.get(t)]).filter(([, n]) => n > 0);
    const totalRest = rest.reduce((a, [, n]) => a + n, 0);
    if (totalRest > 0) {
      for (const [t, n] of rest) {
        const extra = Math.min(n, Math.floor((n / totalRest) * remaining));
        quota.set(t, quota.get(t) + extra);
      }
    }
  }

  // 3. Construction de la liste, en tourniquet pour que le debut du crawl couvre
  //    deja tous les types (si le budget temps coupe avant la fin, on a du diversifie).
  const out = [];
  const cursors = new Map(entries.map(([t]) => [t, 0]));
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (const [t, list] of entries) {
      const c = cursors.get(t);
      if (c >= quota.get(t) || c >= list.length) continue;
      out.push(list[c]);
      cursors.set(t, c + 1);
      progressed = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Detecte, depuis le repo, si le projet utilise une base et/ou envoie des emails.
// Sert a l'activation conditionnelle des agents (agents.js).
function repoSignals(repoPath) {
  const sig = { database: false, sendsEmail: false };
  if (!repoPath) return sig;
  try {
    const pkgPath = join(repoPath, "package.json");
    let deps = {};
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    }
    const names = Object.keys(deps).join(" ");
    if (/prisma|pg\b|mysql|mongoose|mongodb|sequelize|typeorm|drizzle|knex|@supabase|sqlite/i.test(names)) sig.database = true;
    if (/nodemailer|@sendgrid|resend|postmark|mailgun|@aws-sdk\/client-ses|nodemailer/i.test(names)) sig.sendsEmail = true;
  } catch { /* ignore */ }
  return sig;
}

// Detection de stack a partir des en-tetes + HTML (Wappalyzer-lite).
function detectStack(headers, html) {
  const s = new Set();
  const H = headers || {};
  const add = (x) => s.add(x);
  if (H["server"]) add(H["server"].split("/")[0]);
  if (H["x-powered-by"]) add(H["x-powered-by"]);
  if (H["x-vercel-id"] || /vercel/i.test(H["server"] || "")) add("Vercel");
  if (H["x-nf-request-id"] || /netlify/i.test(H["server"] || "")) add("Netlify");
  if (/cloudflare/i.test(H["server"] || "")) add("Cloudflare");
  if (/wp-content|wp-includes/i.test(html)) add("WordPress");
  if (/__NEXT_DATA__|\/_next\//.test(html)) add("Next.js");
  if (/id="__nuxt"|\/_nuxt\//.test(html)) add("Nuxt");
  if (/data-reactroot|react/i.test(html) && /\.js/.test(html)) add("React");
  if (/ng-version=/.test(html)) add("Angular");
  if (/data-v-[0-9a-f]{8}/.test(html)) add("Vue");
  if (/gtag\(|googletagmanager/i.test(html)) add("Google Tag Manager");
  if (/Shopify\./.test(html) || H["x-shopid"]) add("Shopify");
  return [...s].filter(Boolean);
}

// Extrait les liens internes (pour un futur crawl multi-pages).
function internalLinks(html, origin) {
  const out = new Set();
  for (const a of elements(html, "a")) {
    const href = attr(a, "href");
    if (!href) continue;
    try {
      const u = new URL(href, origin);
      if (u.origin === origin) out.add(u.pathname);
    } catch { /* ignore */ }
  }
  return [...out].slice(0, 100);
}

// Un serveur qui repond 200 sur toutes les routes (SPA, fallback Netlify mal
// configure) fait croire que robots.txt, llms.txt ou sitemap.xml existent alors
// qu'il sert son shell HTML. On exige donc que le corps ne soit PAS du HTML:
// sinon la verification adversariale rejetterait a tort les constats d'absence.
function isTextFile(res) {
  if (!res?.ok) return false;
  return !/<html[\s>]/i.test(res.bodySample || "");
}
function isXmlFile(res) {
  if (!res?.ok) return false;
  return /<(urlset|sitemapindex)\b/i.test(res.bodySample || "");
}

export async function recon(target, { repoPath, businessParams, browserScan, auth, maxPages = 1, seoKing } = {}) {
  const origin = originOf(target);
  const host = hostOf(target);
  const url = origin + "/";

  // Auth optionnelle (scan derriere login): cookie/bearer/headers propages a la home
  // ET au crawl. Normalisee une fois pour etre partagee via scope.auth.
  const authOpts = auth && (auth.cookie || auth.bearer || auth.headers)
    ? { cookie: auth.cookie, bearer: auth.bearer, headers: auth.headers } : null;

  const home = await httpGet(url, { ...authOpts });
  const reachable = !home.error;

  // Recuperations paralleles des ressources de scoping.
  const [robots, sitemap, llms, security] = await Promise.all([
    httpHead(origin + "/robots.txt"),
    httpHead(origin + "/sitemap.xml"),
    httpHead(origin + "/llms.txt"),
    httpHead(origin + "/.well-known/security.txt"),
  ]);

  let html = reachable ? home.body : "";

  // RENDU JS (sites SPA): si l'accueil est une coquille (React/Vue/Angular) et que le
  // navigateur est autorise (audit payant), on execute le JS pour recuperer le VRAI
  // contenu. Un seul navigateur, PARTAGE avec le crawl (rendu de chaque page decouverte).
  // Sans ca, tous les agents voient un <div id="root"></div> vide.
  let renderer = null;
  const renderAllowed = reachable && browserAllowed({ repo: Boolean(repoPath), repoPath, maxPages, browserScan });
  if (renderAllowed && looksLikeSpa(html)) {
    const r = await makeRenderer({ auth: authOpts });
    if (r.available) {
      const rendered = await r.render(url);
      if (rendered.html && rendered.html.length > html.length) { html = rendered.html; renderer = r; }
      else await r.close();   // le rendu n'a rien apporte: on relache le navigateur
    }
  }

  const stack = reachable ? detectStack(home.headers, html) : [];

  // UN SEUL CRAWL PARTAGE (promesse produit): quand le multi-pages est demande
  // (offre payante), on crawl une fois ici et tous les agents multi-pages lisent
  // scope.crawl.pages sans re-fetcher.
  //
  // Deux regimes, parce qu'ils n'ont pas les memes contraintes:
  //   - PETIT (<= 60 pages): on garde le HTML de chaque page. Simple, et les agents
  //     historiques (a11y, contenu) continuent de fonctionner tels quels.
  //   - GRAND (> 60 pages): garder 2000 HTML en memoire fait tomber l'instance. On
  //     extrait les faits de chaque page a la volee et on LIBERE le HTML aussitot,
  //     en n'en conservant qu'un echantillon detaille borne.
  let sharedCrawl = null;
  let facts = null;
  let detailHtml = null;
  if (reachable && maxPages > 1) {
    const large = maxPages > LARGE_THRESHOLD;
    let priorityUrls = null;
    let onPage = null;

    if (large) {
      // En grand regime, on lit le sitemap AVANT de crawler: ses URLs passent devant.
      // C'est la liste que le proprietaire declare importante; sur un site de 5000
      // pages, l'ordre de traitement decide de ce qu'on voit reellement.
      const full = await httpGet(origin + "/sitemap.xml", { timeout: 9000, ...authOpts });
      if (!full.error && /<urlset\b/i.test(full.body || "")) {
        // Repartition par type de page. Un sitemap liste les URLs groupees par
        // section: 1500 fiches d'affilee, puis 40 articles. En les prenant dans
        // l'ordre, le budget part entierement dans les fiches et on ne voit jamais
        // le blog.
        priorityUrls = allocateByTemplate(parseUrlset(full.body).map((e) => e.loc), maxPages, TEMPLATE_CAP_MIN);
      }
      facts = new Map();
      detailHtml = new Map();
      const seenTemplates = new Map();
      onPage = (pageUrl, pageHtml, status) => {
        const f = extractFacts(pageUrl, pageHtml, { status, origin });
        facts.set(pageUrl, f);
        // Echantillon detaille: l'accueil, puis quelques representants par TYPE de
        // page. Les lanes qui ont besoin du HTML brut (schema, entite, e-commerce)
        // travaillent dessus. Plusieurs par type, pas un seul: une seule fiche produit
        // ne dit pas si le balisage est constant sur toute la section.
        const seenForTemplate = seenTemplates.get(f.template) || 0;
        if (detailHtml.size < DETAIL_CAP && (pageUrl === url || seenForTemplate < DETAIL_PER_TEMPLATE)) {
          seenTemplates.set(f.template, seenForTemplate + 1);
          detailHtml.set(pageUrl, pageHtml);
        }
      };
    }

    sharedCrawl = await crawl(target, {
      seedUrl: url, seedHtml: html, seedHeaders: { status: home.status },
      maxPages,
      budgetMs: large ? 60000 : 14000,
      concurrency: large ? 8 : 5,
      auth: authOpts,
      keepHtml: !large,
      onPage: large ? onPage : null,
      priorityUrls,
      // Sur une boutique, 800 fiches produit donnent le meme diagnostic. On en garde
      // assez pour juger le gabarit, pas assez pour saturer le budget.
      // Plafond de securite pour les URLs DECOUVERTES PAR LIEN (hors sitemap, donc
      // hors quota). Genereux: la repartition par type est deja faite en amont.
      templateCap: large ? Math.max(TEMPLATE_CAP_MIN, Math.floor(maxPages / 2)) : 0,
      // Rendu JS des pages du crawl uniquement en petit regime (le grand regime,
      // 60+ pages, rendrait le cout du navigateur prohibitif). Le renderer est le meme
      // que celui de l'accueil: un seul navigateur pour tout l'audit.
      renderFn: (renderer && !large) ? renderer.render : null,
    });
  }
  if (renderer) await renderer.close();   // relache le navigateur partage

  return {
    target, url, origin, host,
    reachable,
    repoPath: repoPath || null,
    auth: authOpts || null,
    maxPages,
    // Options transmises aux lanes SEO KING (mesure de citations et ses budgets).
    // Elles voyagent sur le scope parce que les agents seo et geo partagent une
    // execution unique et doivent donc voir exactement la meme configuration.
    seoKing: seoKing || {},
    crawl: sharedCrawl,   // { pages:[{url,status,...,html}], linkTargets, truncated, stats } ou null
    // Grand regime uniquement: faits extraits par page (HTML deja libere) et
    // echantillon detaille qui conserve le HTML brut.
    facts,                // Map<url, PageFacts> ou null
    detailHtml,           // Map<url, html> ou null
    large: Boolean(facts),
    home: reachable ? { status: home.status, headers: home.headers, body: html, setCookie: home.setCookie, redirected: home.redirected } : { error: home.error },
    robots: isTextFile(robots) ? { present: true, body: robots.bodySample } : { present: false },
    sitemap: { present: isXmlFile(sitemap) },
    llmsTxt: { present: isTextFile(llms) },
    securityTxt: { present: isTextFile(security) },
    stack,
    pages: reachable ? internalLinks(html, origin) : [],
    businessParams: businessParams || null,
    // drapeaux d'activation conditionnelle pour agents.js
    repo: Boolean(repoPath),
    // surcharge navigateur par audit (undefined = defaut code+prod dans browserAllowed)
    ...(typeof browserScan === "boolean" ? { browserScan } : {}),
    ...repoSignals(repoPath),
  };
}
