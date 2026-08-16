// Panoptic - generateur de pages comparatives SEO (haute intention: "X vs Y", "alternative a X").
// Regle d'or (issue de l'etude concurrentielle): HONNETE. On dit ou le concurrent est
// meilleur ET ou Panoptic differe. Aucun chiffre fabrique ("non communique" sinon), aucun
// denigrement. Pages auto-audit-propres (h1, canonical, lang, jsonld, favicon, th scope,
// contraste OK, couleurs par variables). node build-comparatif.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = "https://panopticaudit.com";
const esc = (s) => String(s).replace(/&(?![a-z#])/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// V = oui, P = partiel, X = non. Rendu en pastilles.
const CELL = { V: '<span class="c v">&#10003;</span>', P: '<span class="c p">&#177;</span>', X: '<span class="c x">&middot;</span>' };
// lignes de la matrice: [libelle, valeur concurrent, valeur Panoptic]
const ROWS = (rival) => [
  ["Audit SEO technique", rival.seo, "V"],
  ["Performance / Core Web Vitals", rival.perf, "V"],
  ["Sécurité applicative (code + prod)", rival.sec, "V"],
  ["Accessibilité (WCAG / axe-core)", rival.a11y, "V"],
  ["RGPD / cookies / juridique", rival.legal, "V"],
  ["UX / conversion", rival.cro, "V"],
  ["Visibilité IA (GEO, llms.txt)", rival.geo, "V"],
  ["Lit le code source (fichier:ligne)", rival.code, "V"],
  ["Vérification anti-faux-positif", rival.verify, "V"],
  ["Impact chiffré en euros", rival.euros, "V"],
  ["Correctifs appliqués (jusqu'à la PR)", rival.fix, "V"],
  ["CLI + MCP (Claude Code, Cursor)", rival.mcp, "V"],
];

const RIVALS = [
  {
    slug: "semrush",
    name: "Semrush Site Audit",
    intent: "l'audit SEO de la suite Semrush",
    lede: "Semrush est une suite marketing de référence, avec un audit SEO technique très mûr. Panoptic couvre le SEO comme l'un de ses quinze domaines, et va au-delà : sécurité, accessibilité, RGPD, et surtout la lecture du code source.",
    bestAt: "Recherche de mots-clés, données de backlinks, suivi de position et un audit SEO à grande échelle, au sein d'un écosystème marketing complet.",
    pricing: "Abonnement de suite SEO (le plan Pro tourne autour de ~140 $/mois en tarif public ; l'audit de site est inclus, avec des limites de pages selon le palier).",
    chooseThem: ["Votre besoin principal est le SEO et le marketing (mots-clés, backlinks, contenu).", "Vous voulez un écosystème marketing unique et êtes déjà équipé Semrush.", "Vous n'avez pas besoin d'auditer la sécurité, l'accessibilité ou le code."],
    chooseUs: ["Vous voulez un seul audit couvrant sécurité, SEO, perf, accessibilité, RGPD et conversion.", "Vous voulez relier un symptôme en production à sa cause dans le code (fichier:ligne).", "Vous voulez des constats vérifiés, chiffrés en euros, prêts pour un décideur."],
    seo: "V", perf: "P", sec: "X", a11y: "P", legal: "X", cro: "X", geo: "X", code: "X", verify: "X", euros: "X", fix: "X", mcp: "X",
    faqQ: "Panoptic remplace-t-il Semrush ?", faqA: "Non pour le SEO marketing (mots-clés, backlinks) : Semrush reste plus profond sur cet axe. Panoptic remplace la partie audit technique de site en la couvrant en même temps que la sécurité, l'accessibilité, le RGPD et le code, dans un seul rapport vérifié.",
  },
  {
    slug: "screaming-frog",
    name: "Screaming Frog",
    intent: "le crawler SEO Screaming Frog",
    lede: "Screaming Frog est un excellent crawler SEO de bureau, configurable et peu cher. Panoptic est un audit multi-domaines en cloud, qui lit aussi le code et vérifie chaque constat.",
    bestAt: "Crawls SEO techniques profonds et configurables, extraction de données sur mesure, à un prix imbattable pour un usage manuel par un spécialiste.",
    pricing: "Licence de bureau à 199 £/an (version gratuite limitée à 500 URLs).",
    chooseThem: ["Vous êtes un SEO qui veut un contrôle fin du crawl et de l'extraction.", "Vous travaillez en local et voulez le prix le plus bas.", "Votre périmètre est le SEO technique, pas la sécurité ni l'accessibilité."],
    chooseUs: ["Vous voulez un audit consolidé que même un non-spécialiste peut lire et prioriser.", "Vous voulez la sécurité, l'accessibilité, le RGPD et le code en plus du SEO.", "Vous voulez des constats vérifiés (peu de faux positifs) et chiffrés."],
    seo: "V", perf: "P", sec: "X", a11y: "P", legal: "X", cro: "X", geo: "X", code: "X", verify: "X", euros: "X", fix: "X", mcp: "X",
    faqQ: "Screaming Frog ou Panoptic ?", faqA: "Screaming Frog pour un crawl SEO manuel, profond et bon marché par un spécialiste. Panoptic pour un audit tout-en-un (sécurité, SEO, accessibilité, RGPD, code) vérifié et priorisé, utilisable par une équipe, pas seulement un expert SEO.",
  },
  {
    slug: "lumar",
    name: "Lumar",
    intent: "la plateforme d'optimisation Lumar (ex-Deepcrawl)",
    lede: "Lumar est une plateforme entreprise solide pour le SEO, la performance et l'accessibilité à grande échelle. Panoptic ajoute la sécurité et la lecture du code, avec une vérification des constats et un prix accessible.",
    bestAt: "Crawl à très grande échelle, monitoring temps réel et intégration CI/CD, pour de grands sites avec des équipes dédiées.",
    pricing: "Tarification entreprise sur devis (des données tierces situent le contrat médian autour de 32 000 $/an).",
    chooseThem: ["Vous gérez un très grand site (dizaines de milliers de pages) avec une équipe dédiée.", "Vous avez un budget entreprise et voulez du crawl à l'échelle.", "Votre périmètre est front-end (SEO, perf, accessibilité), sans sécurité applicative ni code."],
    chooseUs: ["Vous voulez la sécurité et le code source audités en plus du SEO et de l'accessibilité.", "Vous voulez des constats vérifiés et chiffrés en euros, sans budget entreprise.", "Vous voulez relier la production au code, et des correctifs appliqués."],
    seo: "V", perf: "V", sec: "X", a11y: "V", legal: "P", cro: "P", geo: "P", code: "X", verify: "X", euros: "X", fix: "X", mcp: "X",
    faqQ: "Panoptic est-il une alternative à Lumar ?", faqA: "Oui pour les équipes qui veulent la breadth (SEO + sécurité + accessibilité + RGPD + code) et la vérification, sans engagement entreprise. Lumar reste plus fort sur le crawl à très grande échelle pour les très grands sites.",
  },
  {
    slug: "squirrelscan",
    name: "squirrelscan",
    intent: "l'outil d'audit IA squirrelscan",
    lede: "squirrelscan est un outil d'audit IA orienté développeur (CLI, MCP, beaucoup de règles). Panoptic partage cette approche dev-native, mais lit en plus le code source et vérifie chaque constat de façon déterministe.",
    bestAt: "Audit orienté ligne de commande et agents de code, large couverture de règles côté production, intégration native CI/CD et MCP.",
    pricing: "Modèle à crédits cloud (tarif non communiqué publiquement).",
    chooseThem: ["Vous voulez un scan production piloté par CLI et un agent de code.", "Vous privilégiez la largeur de règles côté production.", "Vous n'avez pas besoin d'analyser le code source ni d'un service de réparation."],
    chooseUs: ["Vous voulez que l'outil lise votre code source (secrets, CVE, architecture), pas seulement la prod.", "Vous voulez une vérification déterministe qui tue les faux positifs (pas un jugement de LLM).", "Vous voulez la garantie que votre code n'est jamais envoyé à un LLM tiers."],
    seo: "V", perf: "V", sec: "P", a11y: "V", legal: "X", cro: "X", geo: "P", code: "X", verify: "P", euros: "X", fix: "P", mcp: "V",
    faqQ: "Quelle différence avec squirrelscan ?", faqA: "Les deux sont dev-native (CLI + MCP). Panoptic lit en plus le code source et relie la prod à la ligne de code, applique une vérification déterministe anti-faux-positif, et n'envoie jamais votre code à un LLM tiers. squirrelscan reste centré sur la production et délègue les correctifs à un agent IA.",
  },
];

const CSS = `
  @font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  @font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  :root{--bg:#070a08;--bg2:#0c0f0d;--line:#1b221d;--line2:#27302a;--ink:#f2f5f2;--mut:#a4aea7;--dim:#8f9990;
    --acc:#4ff0a3;--acc-dim:#1e6b47;--acc-ghost:rgba(79,240,163,.08);--crit:#ff6b6b;--high:#ffa53d;
    --sans:Geist,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,monospace}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.65;-webkit-font-smoothing:antialiased;font-feature-settings:"ss01","cv01"}
  a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
  a:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:4px}
  code{font-family:var(--mono)}
  .skip{position:absolute;left:-9999px;top:0;z-index:100;background:var(--acc);color:#04140c;padding:10px 18px;border-radius:0 0 10px 0;font-weight:600}
  .skip:focus{left:0}
  .wrap{max-width:900px;margin:0 auto;padding:0 24px}
  nav.top{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);background:rgba(7,10,8,.78);border-bottom:1px solid var(--line)}
  .navin{max-width:900px;margin:0 auto;display:flex;align-items:center;gap:14px;height:64px;padding:0 24px}
  .logo{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.02em;font-size:18px;color:var(--ink)}
  .eye{width:22px;height:22px;border-radius:50%;border:2px solid var(--acc);display:grid;place-items:center}
  .eye::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--acc)}
  .navin .cta{margin-left:auto;background:var(--acc);color:#04140c;font-weight:600;font-size:14px;padding:9px 18px;border-radius:100px}
  .navin .cta:hover{text-decoration:none;background:#63f4b1}
  header.hero{padding:64px 0 34px;border-bottom:1px solid var(--line)}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin-bottom:14px}
  h1{font-size:clamp(32px,5vw,48px);line-height:1.03;letter-spacing:-.03em;font-weight:640;margin-bottom:16px}
  .lede{font-size:19px;color:var(--mut);max-width:64ch}
  section{padding:36px 0;border-bottom:1px solid var(--line)}
  h2{font-size:26px;letter-spacing:-.02em;font-weight:620;margin-bottom:16px}
  h3{font-size:16px;font-weight:600;margin-bottom:8px}
  p{color:var(--mut);margin-bottom:12px;max-width:70ch}
  p b,li b{color:var(--ink);font-weight:560}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:640px){.two{grid-template-columns:1fr}}
  .card{border:1px solid var(--line);border-radius:14px;padding:20px 22px;background:var(--bg2)}
  .card.us{border-color:var(--acc-dim);background:linear-gradient(180deg,var(--acc-ghost),transparent),var(--bg2)}
  .card ul{margin:0 0 0 18px;color:var(--mut);font-size:14.5px}.card li{margin-bottom:7px}
  .cmpwrap{overflow-x:auto;border:1px solid var(--line2);border-radius:16px;background:var(--bg2)}
  table{width:100%;border-collapse:collapse;min-width:520px;font-size:14.5px}
  th,td{padding:13px 14px;border-bottom:1px solid var(--line);text-align:center}
  tbody tr:last-child td{border-bottom:0}
  th{font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);font-weight:500;white-space:nowrap;vertical-align:bottom}
  .rowh{text-align:left;color:var(--ink);font-weight:550;white-space:nowrap}
  thead .rowh{color:var(--dim);font-weight:500}
  .usc{background:var(--acc-ghost)}
  th.us{color:#04140c;background:var(--acc);border-radius:8px 8px 0 0;padding:11px 14px;font-weight:700;letter-spacing:0}
  .c{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;line-height:1}
  .c.v{background:var(--acc);color:#04140c;font-size:12px;font-weight:800}
  .c.p{border:1.5px solid var(--high);color:var(--high);font-size:11px}
  .c.x{color:var(--dim);font-size:15px}
  .pricing{border:1px solid var(--line);border-radius:12px;padding:16px 18px;font-size:14.5px;color:var(--mut)}
  .pricing b{color:var(--ink)}
  .qa summary{cursor:pointer;font-size:17px;font-weight:560;list-style:none;padding:6px 0}
  .qa summary::-webkit-details-marker{display:none}
  .qa .ans{color:var(--mut);padding:4px 0 8px;max-width:70ch}
  .final{text-align:center;padding:52px 0;border-bottom:0}
  .final .btn{display:inline-block;background:var(--acc);color:#04140c;font-weight:640;font-size:16px;padding:15px 30px;border-radius:100px;margin-top:8px}
  .final .btn:hover{text-decoration:none;background:#63f4b1}
  footer{padding:28px 0}
  .footin{max-width:900px;margin:0 auto;padding:0 24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:var(--dim);font-size:13.5px}
  .footin a{color:var(--mut)}
  .others{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  .others a{font-size:13.5px;border:1px solid var(--line2);border-radius:100px;padding:6px 13px;color:var(--mut)}
  .others a:hover{border-color:var(--acc-dim);color:var(--ink);text-decoration:none}`;

function faviconTag() {
  return `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='none' stroke='%234ff0a3' stroke-width='3'/%3E%3Ccircle cx='16' cy='16' r='5' fill='%234ff0a3'/%3E%3C/svg%3E">`;
}
function shell({ title, desc, canonical, jsonld, body }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${SITE}/benchmark/og.png">
<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
${faviconTag()}
${jsonld}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Aller au contenu</a>
<nav class="top"><div class="navin"><a class="logo" href="/"><span class="eye" aria-hidden="true"></span>Panoptic</a><a class="cta" href="/console/">Scanner mon site</a></div></nav>
${body}
<footer><div class="footin"><span>&copy; 2026 Panoptic</span><span><a href="/">Accueil</a> &middot; <a href="/comparatif/">Comparatifs</a> &middot; <a href="/docs/">Docs</a> &middot; <a href="/console/">Console</a></span></div></footer>
</body>
</html>`;
}

function comparePage(r) {
  const canonical = `${SITE}/comparatif/${r.slug}/`;
  const rows = ROWS(r).map(([label, a, b]) =>
    `<tr><td class="rowh">${esc(label)}</td><td>${CELL[a]}</td><td class="usc">${CELL[b]}</td></tr>`).join("");
  const others = RIVALS.filter((x) => x.slug !== r.slug).map((x) => `<a href="/comparatif/${x.slug}/">vs ${esc(x.name)}</a>`).join("");
  const jsonld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [{ "@type": "Question", name: r.faqQ, acceptedAnswer: { "@type": "Answer", text: r.faqA } }],
  })}</script>`;
  const body = `
<header class="hero"><div class="wrap">
  <div class="eyebrow">Comparatif</div>
  <h1>Panoptic vs ${esc(r.name)}</h1>
  <p class="lede">${esc(r.lede)}</p>
</div></header>
<main id="main">
  <section><div class="wrap">
    <h2>En bref</h2>
    <div class="two">
      <div class="card"><h3>${esc(r.name)} excelle à</h3><p style="margin:0">${esc(r.bestAt)}</p></div>
      <div class="card us"><h3>Panoptic ajoute</h3><p style="margin:0">Un audit unique sur 15 domaines dont la sécurité, la lecture du code source (fichier:ligne), une vérification anti-faux-positif et un chiffrage en euros.</p></div>
    </div>
  </div></section>
  <section><div class="wrap">
    <h2>Comparaison</h2>
    <div class="cmpwrap"><table>
      <thead><tr><th class="rowh" scope="col">Capacité</th><th scope="col">${esc(r.name)}</th><th class="us" scope="col">Panoptic</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p style="font-size:13px;color:var(--dim);margin-top:10px">&#10003; couvert &nbsp; &#177; partiel &nbsp; &middot; absent. Comparaison sur les capacités documentées ; nous ne fabriquons aucun chiffre concurrent.</p>
  </div></section>
  <section><div class="wrap">
    <h2>Quand choisir quoi</h2>
    <div class="two">
      <div class="card"><h3>Choisissez ${esc(r.name)} si</h3><ul>${r.chooseThem.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="card us"><h3>Choisissez Panoptic si</h3><ul>${r.chooseUs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    </div>
  </div></section>
  <section><div class="wrap">
    <h2>Tarifs</h2>
    <div class="pricing"><b>${esc(r.name)}</b> : ${esc(r.pricing)}<br><b>Panoptic</b> : scan gratuit, audit complet 490 &euro;, surveillance continue 190 &euro;/mois.</div>
  </div></section>
  <section><div class="wrap">
    <h2>Question fréquente</h2>
    <details class="qa" open><summary>${esc(r.faqQ)}</summary><div class="ans">${esc(r.faqA)}</div></details>
  </div></section>
  <section class="final"><div class="wrap">
    <h2>Auditez votre site en une minute</h2>
    <p style="margin:0 auto">Scan gratuit sur les 15 domaines. Aucun compte requis.</p>
    <a class="btn" href="/console/">Scanner mon site</a>
    <div class="others" style="justify-content:center;margin-top:22px">${others}</div>
  </div></section>
</main>`;
  return shell({
    title: `Panoptic vs ${r.name} : comparatif d'audit de site (2026)`,
    desc: `Panoptic vs ${r.name} : où chacun est meilleur, tableau de comparaison honnête, quand choisir l'un ou l'autre, et tarifs. Audit de site tout-en-un, code + production.`,
    canonical, jsonld, body,
  });
}

function hubPage() {
  const canonical = `${SITE}/comparatif/`;
  const cards = RIVALS.map((r) => `<a class="card" href="/comparatif/${r.slug}/" style="text-decoration:none;display:block"><h3 style="color:var(--ink)">Panoptic vs ${esc(r.name)}</h3><p style="margin:0;font-size:14px">${esc(r.intent[0].toUpperCase() + r.intent.slice(1))}.</p></a>`).join("");
  const jsonld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: "Comparatifs Panoptic", url: canonical })}</script>`;
  const body = `
<header class="hero"><div class="wrap">
  <div class="eyebrow">Comparatifs</div>
  <h1>Panoptic face aux autres outils d'audit</h1>
  <p class="lede">Comparaisons honnêtes : où chaque outil est le meilleur, et quand Panoptic — l'audit tout-en-un qui lit le code et la production — est le bon choix.</p>
</div></header>
<main id="main"><section style="border-bottom:0"><div class="wrap">
  <div class="two" style="gap:14px">${cards}</div>
  <p style="margin-top:24px"><a href="/console/">Scanner mon site gratuitement</a> &middot; <a href="/docs/">Documentation</a></p>
</div></section></main>`;
  return shell({
    title: "Comparatifs Panoptic vs Semrush, Screaming Frog, Lumar, squirrelscan",
    desc: "Comparez Panoptic aux autres outils d'audit de site : Semrush, Screaming Frog, Lumar, squirrelscan. Comparaisons honnêtes, tableaux, tarifs, quand choisir quoi.",
    canonical, jsonld, body,
  });
}

let n = 0;
mkdirSync(join(ROOT, "comparatif"), { recursive: true });
writeFileSync(join(ROOT, "comparatif", "index.html"), hubPage()); n++;
for (const r of RIVALS) {
  const dir = join(ROOT, "comparatif", r.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), comparePage(r)); n++;
}
console.log(`${n} pages comparatives generees (hub + ${RIVALS.length} concurrents).`);
