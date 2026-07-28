// Panoptic SEO KING - rendu navigateur partage (Chromium via Playwright).
//
// Pourquoi ce module existe alors que engine/scanners/browser.js lance deja Chromium:
// browser.js ouvre UN NAVIGATEUR PAR APPEL (runAxe, runLighthouse). Pour rendre dix
// pages il faudrait dix Chromium a ~1 Go: impossible sur une instance 2 Go. Ici, un
// seul navigateur, un seul contexte, N pages ouvertes et refermees une par une.
//
// DEGRADATION GRACIEUSE stricte, comme browser.js: import dynamique a specifier
// non-constant (le bundler serverless ne doit pas l'embarquer), et si Playwright
// manque on renvoie available:false avec zero rendu. Jamais de crash, jamais de
// fausse confiance: une lane qui ne recoit pas de rendu doit le DIRE, pas deviner.

const DEFAULTS = {
  maxPages: 8,
  pageTimeoutMs: 12000,
  totalBudgetMs: 60000,
  // Au-dela, un moteur considere la page comme non rendue: on fait pareil.
  settleMs: 900,
  userAgent: "PanopticAudit/1.0 (+https://panopticaudit.com)",
  viewport: { width: 1280, height: 900 },
};

let _pw;
async function getPlaywright() {
  if (_pw !== undefined) return _pw;
  if (process.env.PANOPTIC_BROWSER === "off") return (_pw = null);
  try {
    const spec = process.env.PW_MODULE || ["play", "wright"].join("");
    _pw = await import(spec);
  } catch {
    _pw = null;
  }
  return _pw;
}

// Script execute DANS la page. Deux precautions:
//   1. On fait defiler la page avant de lire: un site a revelation au defilement
//      (opacity 0 jusqu'au scroll) ou a chargement paresseux n'a pas encore son
//      contenu au moment du domcontentloaded. Sans ca, on mesurerait un DOM a moitie
//      vide et on annoncerait du contenu manquant qui existe.
//   2. On renvoie le HTML SERIALISE du document rendu, pas une extraction maison:
//      c'est le meme format que le HTML brut, donc le meme extracteur peut le lire et
//      la comparaison brut/rendu porte sur des grandeurs comparables.
const SETTLE_AND_SERIALIZE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = Math.max(document.body ? document.body.scrollHeight : 0, window.innerHeight);
  for (let y = 0; y < Math.min(h, 12000); y += Math.floor(window.innerHeight * 0.8)) {
    window.scrollTo(0, y);
    await sleep(60);
  }
  window.scrollTo(0, 0);
  await sleep(120);
  return document.documentElement.outerHTML;
})()`;

/**
 * Rend une liste d'URLs dans UN SEUL navigateur.
 * @returns {{available:boolean, pages:Map<string,{html,status,ms,consoleErrors}>, error?:string, stats:object}}
 */
export async function renderPages(urls, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const pages = new Map();
  const stats = { requested: urls.length, rendered: 0, failed: 0, skipped: 0, ms: 0 };

  const pw = await getPlaywright();
  if (!pw) return { available: false, pages, stats, reason: "Playwright indisponible dans cet environnement" };

  const list = urls.slice(0, opts.maxPages);
  stats.skipped = Math.max(0, urls.length - list.length);
  const start = performance.now();
  let browser;

  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const contextOptions = {
      userAgent: opts.userAgent,
      viewport: opts.viewport,
      // On veut voir ce que voit un visiteur reel, pas une version degradee.
      javaScriptEnabled: true,
      ...(opts.auth?.cookie ? { extraHTTPHeaders: { cookie: opts.auth.cookie } } : {}),
      ...(opts.auth?.bearer ? { extraHTTPHeaders: { authorization: `Bearer ${opts.auth.bearer}` } } : {}),
    };

    for (const url of list) {
      if (performance.now() - start > opts.totalBudgetMs) {
        stats.skipped += list.length - pages.size - stats.failed;
        break;
      }
      const t0 = performance.now();
      let page, context;
      const consoleErrors = [];
      try {
        // Contexte NEUF par page (~30-50 Mo, sans commune mesure avec le Go d'un
        // navigateur). Indispensable pour la fidelite: une banniere de consentement
        // acceptee sur la premiere page changerait le rendu de toutes les suivantes,
        // alors qu'un crawler arrive toujours vierge.
        context = await browser.newContext(contextOptions);
        page = await context.newPage();
        page.on("console", (m) => { if (m.type() === "error" && consoleErrors.length < 10) consoleErrors.push(m.text().slice(0, 200)); });
        page.on("pageerror", (e) => { if (consoleErrors.length < 10) consoleErrors.push(String(e.message).slice(0, 200)); });

        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.pageTimeoutMs });
        // Laisse le JS de rendu finir. networkidle seul peut ne jamais arriver sur un
        // site a sondage permanent, d'ou l'attente bornee plutot qu'une condition.
        await page.waitForTimeout(opts.settleMs);
        const html = await page.evaluate(SETTLE_AND_SERIALIZE);

        pages.set(url, {
          html,
          status: resp ? resp.status() : null,
          ms: Math.round(performance.now() - t0),
          consoleErrors,
        });
        stats.rendered++;
      } catch (e) {
        stats.failed++;
        pages.set(url, { html: null, error: String(e.message || e).slice(0, 180), ms: Math.round(performance.now() - t0), consoleErrors });
      } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
      }
    }
  } catch (e) {
    return { available: true, pages, stats, error: String(e.message || e).slice(0, 200) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    stats.ms = Math.round(performance.now() - start);
  }

  return { available: true, pages, stats };
}

// Memoise sur le scope: comme la deep-recon, le rendu ne doit avoir lieu qu'une fois
// meme si plusieurs agents le demandent en parallele.
export function renderShared(scope, urls, options) {
  if (!scope) return Promise.resolve({ available: false, pages: new Map(), stats: {} });
  if (!scope.__renderPromise) {
    scope.__renderPromise = renderPages(urls, options).catch((e) => ({
      available: false, pages: new Map(), stats: {}, error: String(e.message || e).slice(0, 200),
    }));
  }
  return scope.__renderPromise;
}
