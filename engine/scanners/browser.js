// Panoptic - scanners NAVIGATEUR (Chromium headless via Playwright).
// axe-core (a11y WCAG) et, plus tard, Lighthouse (perf/CWV). Tournent uniquement la
// ou un navigateur est disponible: le serveur Render (image Docker avec Chromium).
//
// DEGRADATION GRACIEUSE stricte: en serverless (Netlify) Playwright n'est PAS installe.
// L'import de Playwright est DYNAMIQUE et a specifier NON-CONSTANT pour que le bundler
// Netlify ne l'embarque pas; s'il echoue -> available:false, findings:[] (jamais de
// fausse confiance, jamais de crash). Le resultat est memoise (un seul essai/process).
// AUCUN import statique lourd: axe-core / playwright / lighthouse sont charges
// PARESSEUSEMENT et seulement si un navigateur est disponible (serveur Render).
// -> la fonction serverless Netlify ne les embarque ni ne les charge jamais.

// GARDE-FOU COUT: le navigateur (axe/Lighthouse) est LOURD (~1 Go RAM/Chromium).
// C'est une capacite PREMIUM, reservee au payant. Regle de decision par audit:
//   1. PANOPTIC_BROWSER=off  -> coupe-circuit global (tout desactive).
//   2. scope.browserScan (bool) -> surcharge explicite par audit si fournie.
//   3. sinon defaut: uniquement si code+prod (repo present). Un scan gratuit
//      boite-noire (sans repo) ne lance donc JAMAIS Chromium, meme sur Render.
export function browserAllowed(scope = {}) {
  if (process.env.PANOPTIC_BROWSER === "off") return false;
  if (typeof scope.browserScan === "boolean") return scope.browserScan;
  // Audit PAYANT = navigateur reel (axe-core WCAG + Lighthouse CWV), pas les heuristiques.
  // Signal payant: depot connecte (code+prod) OU crawl multi-pages (maxPages>1). Le scan
  // gratuit mono-page (maxPages=1) reste leger. Corrige la critique /avis "pas de WCAG/CWV
  // reels": un audit prod-only multi-pages activait les heuristiques au lieu d'axe/Lighthouse.
  return Boolean(scope.repo || scope.repoPath || (scope.maxPages || 1) > 1);
}

// --- RENDU JS (sites SPA) --------------------------------------------------------
// Un site React/Vue/Angular sert un HTML quasi vide (ex. <div id="root"></div>): sans
// executer le JS, tous les agents voient du vide. makeRenderer ouvre UN navigateur et
// rend plusieurs pages (le crawl decouvre les URLs au fil de l'eau -> browser partage).
// Degradation gracieuse: pas de Chromium -> available:false, l'appelant retombe sur le
// HTML brut. auth = { cookie?, bearer?, headers? } propage aux requetes (scan authentifie).
export async function makeRenderer({ auth, timeoutMs = 20000 } = {}) {
  const pw = await getPlaywright();
  if (!pw) return { available: false, render: async () => ({ error: "no-browser" }), close: async () => {} };
  let browser = null, context = null;
  const ensure = async () => {
    if (context) return;
    browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const extraHTTPHeaders = { ...(auth?.headers || {}) };
    if (auth?.cookie) extraHTTPHeaders["cookie"] = auth.cookie;
    if (auth?.bearer) extraHTTPHeaders["authorization"] = `Bearer ${auth.bearer}`;
    context = await browser.newContext({
      userAgent: "PanopticAudit/1.0 (+https://panopticaudit.com)",
      ...(Object.keys(extraHTTPHeaders).length ? { extraHTTPHeaders } : {}),
    });
  };
  return {
    available: true,
    async render(url) {
      try {
        await ensure();
        const page = await context.newPage();
        try {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          // Laisse le framework hydrater, sans bloquer si une connexion reste ouverte.
          await page.waitForLoadState("networkidle", { timeout: 3500 }).catch(() => {});
          const html = await page.content();
          return { html, status: resp ? resp.status() : 200 };
        } finally { await page.close().catch(() => {}); }
      } catch (e) { return { error: String(e.message || e).slice(0, 160) }; }
    },
    async close() { try { if (context) await context.close(); if (browser) await browser.close(); } catch { /* deja ferme */ } },
  };
}

// Heuristique: ce HTML brut est-il une coquille SPA (contenu injecte par JS) ?
// Signature de root SPA connue OU tres peu de texte visible -> vaut le rendu.
export function looksLikeSpa(html) {
  if (!html) return false;
  const hasRoot = /<div\s+id=["'](root|app|__next|__nuxt|app-root|q-app)["']/i.test(html)
    || /\bdata-reactroot\b/i.test(html) || /\bng-version=/i.test(html) || /id=["']svelte\b/i.test(html);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = (text.match(/\S+/g) || []).length;
  return (hasRoot && words < 120) || words < 25;
}

let _pw; // undefined = pas encore essaye, null = indisponible, objet = module Playwright
async function getPlaywright() {
  if (_pw !== undefined) return _pw;
  if (process.env.PANOPTIC_BROWSER === "off") return (_pw = null);
  try {
    // Specifier non-constant: le bundler ne peut pas le resoudre statiquement -> non embarque.
    const spec = process.env.PW_MODULE || ["play", "wright"].join("");
    _pw = await import(spec);
  } catch {
    _pw = null;
  }
  return _pw;
}

// impact axe -> severite canonique.
const IMPACT = { critical: "high", serious: "high", moderate: "medium", minor: "low" };

function mapViolation(v) {
  const nodes = v.nodes || [];
  const targets = nodes.slice(0, 5).map((n) => (n.target || []).join(" ")).filter(Boolean);
  const wcag = (v.tags || []).filter((t) => /^wcag\d|^wcag2/.test(t)).join(", ");
  return {
    rule: "axe:" + v.id,
    severity: IMPACT[v.impact] || "low",
    effort: 0.3,
    title: v.help,
    fix: `${v.help}. ${v.helpUrl}`,
    proof: `${nodes.length} element(s)${targets.length ? " : " + targets[0] : ""}${nodes[0]?.failureSummary ? " - " + nodes[0].failureSummary.replace(/\s+/g, " ").slice(0, 160) : ""}`,
    artifact: targets.join(" | ") || undefined,
    reason: wcag ? `axe-core, ${wcag}` : "axe-core",
  };
}

/**
 * Scanne l'accessibilite d'une URL avec axe-core dans Chromium.
 * @returns {Promise<{available:boolean, findings:object[], error?:string, stats?:object}>}
 */
export async function runAxe(url, { timeoutMs = 30000 } = {}) {
  const pw = await getPlaywright();
  if (!pw) return { available: false, findings: [] };
  const axeMod = await loadModule("AXE_MODULE", "axe-core");
  const AXE_SOURCE = (axeMod?.default || axeMod)?.source;
  if (!AXE_SOURCE) return { available: false, findings: [] };
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ userAgent: "PanopticAudit/1.0 (+https://panoptic-audit.netlify.app)" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.addScriptTag({ content: AXE_SOURCE });
    const res = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
    const findings = (res.violations || []).map(mapViolation);
    return { available: true, findings, stats: { violations: (res.violations || []).length } };
  } catch (e) {
    return { available: true, findings: [], error: String(e.message || e).slice(0, 200) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// --- Lighthouse (perf / Core Web Vitals en laboratoire) --------------------------
// Lance le Chromium de Playwright via chrome-launcher (port DevTools libre auto) et
// passe le port a Lighthouse. Imports dynamiques non-constants: hors bundle Netlify.
async function loadModule(envKey, name) {
  try { return await import(process.env[envKey] || name); } catch { return null; }
}

function stripMd(s) { return String(s || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 200); }

// Metriques CWV surveillees -> findings quand le score Lighthouse de l'audit est faible.
const CWV = [
  { k: "largest-contentful-paint", rule: "lcp", label: "LCP" },
  { k: "cumulative-layout-shift", rule: "cls", label: "CLS" },
  { k: "total-blocking-time", rule: "tbt", label: "TBT" },
  { k: "speed-index", rule: "speed-index", label: "Speed Index" },
];

export async function runLighthouse(url) {
  const pw = await getPlaywright();
  if (!pw) return { available: false, findings: [], metrics: null };
  const chromeLauncher = await loadModule("CL_MODULE", "chrome-launcher");
  const lhMod = await loadModule("LH_MODULE", "lighthouse");
  const lighthouse = lhMod?.default || lhMod;
  if (!chromeLauncher || typeof lighthouse !== "function") return { available: false, findings: [], metrics: null };

  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: pw.chromium.executablePath(),
      chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const r = await lighthouse(url, { port: chrome.port, output: "json", onlyCategories: ["performance"], logLevel: "silent" });
    const lhr = r?.lhr;
    if (!lhr) return { available: true, findings: [], metrics: null, error: "pas de rapport lighthouse" };
    const A = (k) => lhr.audits?.[k] || {};
    const score = Math.round((lhr.categories?.performance?.score ?? 0) * 100);
    const metrics = {
      score,
      lcp: A("largest-contentful-paint").displayValue,
      cls: A("cumulative-layout-shift").displayValue,
      tbt: A("total-blocking-time").displayValue,
      fcp: A("first-contentful-paint").displayValue,
      speedIndex: A("speed-index").displayValue,
    };
    const findings = [];
    for (const c of CWV) {
      const a = A(c.k);
      if (typeof a.score === "number" && a.score < 0.9) {
        findings.push({
          rule: "lighthouse:" + c.rule,
          severity: a.score < 0.5 ? "high" : "medium",
          effort: 0.5,
          title: `${c.label} a ameliorer (${a.displayValue})`,
          fix: stripMd(a.description) || `Optimiser ${c.label}.`,
          proof: `${c.label} = ${a.displayValue} (score Lighthouse ${Math.round(a.score * 100)}/100, mesure laboratoire).`,
          reason: "Lighthouse (Chromium, laboratoire)",
          impact: "Core Web Vitals",
        });
      }
    }
    return { available: true, findings, metrics, stats: { score, failing: findings.length } };
  } catch (e) {
    return { available: true, findings: [], metrics: null, error: String(e.message || e).slice(0, 200) };
  } finally {
    if (chrome && typeof chrome.kill === "function") { try { await chrome.kill(); } catch { /* deja mort */ } }
  }
}
