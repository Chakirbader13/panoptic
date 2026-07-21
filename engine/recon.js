// Panoptic - Couche 1: reconnaissance et scoping unifie.
// La promesse "un seul crawl": on recupere la page cible UNE fois, plus robots.txt,
// sitemap, llms.txt et quelques signaux, et on partage ce contexte a tous les agents.
// Les agents prod ne re-fetchent pas la page: ils lisent scope.home.
import { httpGet, httpHead, originOf, hostOf, elements, attr } from "./agents/shared.js";
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

export async function recon(target, { repoPath, businessParams, browserScan } = {}) {
  const origin = originOf(target);
  const host = hostOf(target);
  const url = origin + "/";

  const home = await httpGet(url);
  const reachable = !home.error;

  // Recuperations paralleles des ressources de scoping.
  const [robots, sitemap, llms, security] = await Promise.all([
    httpHead(origin + "/robots.txt"),
    httpHead(origin + "/sitemap.xml"),
    httpHead(origin + "/llms.txt"),
    httpHead(origin + "/.well-known/security.txt"),
  ]);

  const html = reachable ? home.body : "";
  const stack = reachable ? detectStack(home.headers, html) : [];

  return {
    target, url, origin, host,
    reachable,
    repoPath: repoPath || null,
    home: reachable ? { status: home.status, headers: home.headers, body: html, setCookie: home.setCookie, redirected: home.redirected } : { error: home.error },
    robots: robots.ok ? { present: true, body: robots.bodySample } : { present: false },
    sitemap: { present: Boolean(sitemap.ok) },
    llmsTxt: { present: Boolean(llms.ok) },
    securityTxt: { present: Boolean(security.ok) },
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
