// SEO KING - analyse de logs serveur.
//
// On fabrique un fichier de logs qui contient exactement les situations qu'on pretend
// detecter, plus un temoin sain. Aucun appel reseau: la verification DNS des robots est
// testee separement avec des IP reservees a la documentation (RFC 5737), qui ne
// resolvent jamais, ce qui permet de verifier qu'une IP non resolue n'est PAS declaree
// authentique.
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { streamLog, detectFormat } from "./logs/parse.js";
import { createAggregator, crossReference } from "./logs/analyze.js";
import { identify, verifyIp, BOTS } from "./logs/bots.js";
import { recon } from "../recon.js";
import { runShared } from "./index.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };
const dir = mkdtempSync(join(tmpdir(), "panoptic-logs-"));

// --- Identification des robots -------------------------------------------------------
ok(identify("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")?.id === "googlebot", "Googlebot identifie");
ok(identify("Mozilla/5.0 AppleWebKit (compatible; GPTBot/1.2; +https://openai.com/gptbot)")?.id === "gptbot", "GPTBot identifie");
ok(identify("Mozilla/5.0 (compatible; PerplexityBot/1.0)")?.kind === "ai-search", "PerplexityBot classe comme moteur de reponse");
ok(identify("Mozilla/5.0 (compatible; ClaudeBot/1.0)")?.kind === "ai-train", "ClaudeBot classe comme collecte d'entrainement");
ok(identify("Mozilla/5.0 (compatible; AhrefsBot/7.0)")?.kind === "tool", "un outil SEO tiers n'est pas compte comme moteur");
ok(identify("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120") === null, "un navigateur humain n'est pas un robot");
ok(identify(null) === null && identify("") === null, "user-agent vide gere");

// --- Verification DNS: le coeur anti-usurpation ---------------------------------------
{
  const googlebot = BOTS.find((b) => b.id === "googlebot");
  // 192.0.2.x est reservee a la documentation (RFC 5737): aucun rDNS ne peut exister.
  const r = await verifyIp("192.0.2.1", googlebot, { timeoutMs: 2500 });
  ok(r.state !== "verified", `une IP sans DNS inverse n'est JAMAIS declaree authentique (etat: ${r.state})`);
  const cc = BOTS.find((b) => b.id === "ccbot");
  const r2 = await verifyIp("192.0.2.2", cc);
  ok(r2.state === "unverifiable", "un crawler sans domaine officiel publie est 'non verifiable', pas 'usurpateur'");
}

// --- Detection de format ------------------------------------------------------------
ok(detectFormat(['1.2.3.4 - - [10/Oct/2026:13:55:36 +0200] "GET /p HTTP/1.1" 200 23 "-" "ua"']) === "combined", "format Combined detecte");
ok(detectFormat(['{"ClientIP":"1.2.3.4","ClientRequestURI":"/p"}']) === "json", "format JSON detecte");
ok(detectFormat(["#Fields: date time c-ip cs-method cs-uri-stem sc-status"]) === "w3c", "format W3C detecte");
ok(detectFormat(["ceci n'est pas un log", "ni ceci"]) === null, "format inconnu correctement signale");

// --- Fabrication d'un fichier de logs realiste ------------------------------------------
const UA = {
  google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  human: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0",
  ahrefs: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
};
const line = (ip, path, status, ua, day = 10) =>
  `${ip} - - [${String(day).padStart(2, "0")}/Oct/2026:13:55:36 +0000] "GET ${path} HTTP/1.1" ${status} 5120 "-" "${ua}"`;

const lines = [];
// Pages saines explorees par Google.
for (let i = 0; i < 40; i++) lines.push(line("66.249.66.1", "/", 200, UA.google, 10 + (i % 5)));
for (let i = 0; i < 30; i++) lines.push(line("66.249.66.1", "/produit", 200, UA.google));
// GASPILLAGE: URL a parametres (facettes) + redirections + 404, en masse.
for (let i = 0; i < 120; i++) lines.push(line("66.249.66.2", `/catalogue?couleur=c${i}&taille=t${i % 5}`, 200, UA.google));
for (let i = 0; i < 40; i++) lines.push(line("66.249.66.2", `/vieux-${i}`, 301, UA.google));
for (let i = 0; i < 30; i++) lines.push(line("66.249.66.2", `/disparu-${i}`, 404, UA.google));
// ORPHELINES ACTIVES: Google revient sur des URL que le site ne declare plus.
for (let i = 0; i < 12; i++) lines.push(line("66.249.66.3", "/ancienne-offre-2019", 200, UA.google, 11));
for (let i = 0; i < 8; i++) lines.push(line("66.249.66.3", "/promo-noel-2022", 200, UA.google, 12));
// 5xx FURTIFS servis a Googlebot.
for (let i = 0; i < 7; i++) lines.push(line("66.249.66.4", "/recherche", 503, UA.google));
// Trafic humain et outil SEO: ne doivent pas polluer les mesures de moteur.
for (let i = 0; i < 200; i++) lines.push(line("81.2.3.4", "/", 200, UA.human));
for (let i = 0; i < 50; i++) lines.push(line("54.36.148.1", "/", 200, UA.ahrefs));

writeFileSync(join(dir, "acces.log"), lines.join("\n") + "\n");
// Meme contenu gzippe: c'est ce qu'un hebergeur exporte reellement.
writeFileSync(join(dir, "acces.log.gz"), gzipSync(lines.join("\n") + "\n"));

// --- Lecture en flux --------------------------------------------------------------------
{
  const agg = createAggregator();
  const stats = await streamLog(join(dir, "acces.log"), (e) => agg.add(e));
  const r = agg.result();
  ok(stats.format === "combined", "format reconnu a la lecture");
  ok(stats.parsed === lines.length, `toutes les lignes sont exploitees (${stats.parsed}/${lines.length})`);
  ok(r.totals.botEntries > 0 && r.totals.humanEntries === 200, "trafic humain et robot separes correctement");
  ok(r.byBot.googlebot.hits === 287, `visites Googlebot comptees exactement (${r.byBot.googlebot?.hits})`);
  ok(r.byBot.googlebot.params === 120, `URL a parametres comptees (${r.byBot.googlebot?.params})`);
  ok(r.byBot.googlebot.serverErrors === 7, `5xx servies au moteur comptees (${r.byBot.googlebot?.serverErrors})`);
  ok(r.byBot["seo-tool"]?.hits === 50, "les outils SEO sont comptes a part, pas comme un moteur");
  ok(stats.firstTime && stats.lastTime && stats.lastTime > stats.firstTime, "la periode couverte est datee");
}

// --- Gzip -------------------------------------------------------------------------------
{
  const agg = createAggregator();
  const stats = await streamLog(join(dir, "acces.log.gz"), (e) => agg.add(e));
  ok(stats.parsed === lines.length, "un fichier gzippe donne exactement le meme resultat");
}

// --- JSON par ligne (CDN) ------------------------------------------------------------------
{
  const j = [
    JSON.stringify({ ClientIP: "66.249.66.1", ClientRequestURI: "/a", EdgeResponseStatus: 200, ClientRequestUserAgent: UA.google, EdgeStartTimestamp: "2026-10-10T10:00:00Z" }),
    JSON.stringify({ ClientIP: "66.249.66.1", ClientRequestURI: "/b?x=1", EdgeResponseStatus: 404, ClientRequestUserAgent: UA.google, EdgeStartTimestamp: "2026-10-10T10:01:00Z" }),
  ].join("\n");
  writeFileSync(join(dir, "cdn.json.log"), j + "\n");
  const agg = createAggregator();
  const stats = await streamLog(join(dir, "cdn.json.log"), (e) => agg.add(e));
  const r = agg.result();
  ok(stats.format === "json" && stats.parsed === 2, "logs JSON de CDN lus");
  ok(r.byBot.googlebot.notFound === 1 && r.byBot.googlebot.params === 1, "statuts et parametres extraits du JSON");
}

// --- Bout en bout: les constats sortent-ils, et seulement les bons ? ------------------------
const server = createServer((req, res) => {
  const path = req.url.split("?")[0].replace(/\/$/, "") || "/";
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (path === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
  if (path === "/sitemap.xml") {
    res.setHeader("content-type", "application/xml");
    // Le sitemap declare une page que les logs ne montrent JAMAIS explorée.
    return res.end(`<?xml version="1.0"?><urlset>
      <url><loc>http://127.0.0.1:${server.port}/</loc></url>
      <url><loc>http://127.0.0.1:${server.port}/produit</loc></url>
      <url><loc>http://127.0.0.1:${server.port}/jamais-exploree</loc></url></urlset>`);
  }
  const body = `<h1>${path}</h1><p>${"contenu ".repeat(80)}</p><a href="/produit">produit</a>`;
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page ${path}</title>
    <link rel="canonical" href="http://127.0.0.1:${server.port}${path}"></head><body>${body}</body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
server.port = server.address().port;

const scope = await recon(`http://127.0.0.1:${server.port}`, { maxPages: 5 });
const result = await runShared(scope, { logFile: join(dir, "acces.log"), render: false });
const rules = new Set(result.findings.filter((f) => f.lane === "logs").map((f) => f.rule));

ok(rules.has("crawl-budget-waste"), "gaspillage du budget d'exploration detecte");
ok(rules.has("active-orphan-pages"), "orphelines actives detectees");
ok(rules.has("stealth-server-errors"), "erreurs serveur furtives detectees");
ok(rules.has("sitemap-never-crawled"), "URL du sitemap jamais exploree detectee");
ok(rules.has("ai-crawlers-never-came"), "absence des crawlers de moteurs de reponse detectee");

const waste = result.findings.find((f) => f.rule === "crawl-budget-waste");
ok(waste && /parametres/.test(waste.proof), "la preuve du gaspillage cite les URL a parametres");
const orphans = result.findings.find((f) => f.rule === "active-orphan-pages");
ok(orphans && /ancienne-offre-2019/.test(orphans.proof), "la preuve des orphelines nomme les vraies URL");
const never = result.findings.find((f) => f.rule === "sitemap-never-crawled");
ok(never && /jamais-exploree/.test(never.proof), "la preuve nomme l'URL declaree mais jamais exploree");
ok(result.findings.filter((f) => f.lane === "logs").every((f) => f.proof && f.fix), "chaque constat porte preuve et correctif");
ok(result.logs?.stats?.parsed === lines.length, "les statistiques de lecture remontent au rapport");

// --- Avec des crawlers IA presents, le constat d'absence NE sort PAS ------------------------
{
  const withAi = [...lines];
  for (let i = 0; i < 15; i++) withAi.push(line("20.171.207.1", "/", 200, UA.gptbot));
  writeFileSync(join(dir, "avec-ia.log"), withAi.join("\n") + "\n");
  const scope2 = await recon(`http://127.0.0.1:${server.port}`, { maxPages: 5 });
  const r2 = await runShared(scope2, { logFile: join(dir, "avec-ia.log"), render: false });
  const rules2 = new Set(r2.findings.filter((f) => f.lane === "logs").map((f) => f.rule));
  ok(!rules2.has("ai-crawlers-never-came"), "aucune fausse alerte d'absence quand GPTBot est bien passe");
  // GPTBot collecte pour l'entrainement, il n'alimente pas les reponses en direct.
  ok(rules2.has("ai-search-crawlers-absent"), "la distinction entrainement / reponse en direct est faite");
  ok(r2.strengths.some((s) => /GPTBot/.test(s.text)), "le passage effectif est porte en point fort");
}

// --- Sans fichier: la lane se tait en le disant, sans rien inventer -------------------------
{
  const scope3 = await recon(`http://127.0.0.1:${server.port}`, { maxPages: 3 });
  const r3 = await runShared(scope3, { render: false });
  const l3 = r3.lanes.find((x) => x.id === "logs");
  ok(l3.findings === 0 && /aucun fichier/.test(l3.skipped || ""), "sans logs, la lane se tait en expliquant pourquoi");
}

// --- Fichier absent: constat honnete, pas un plantage ----------------------------------------
{
  const scope4 = await recon(`http://127.0.0.1:${server.port}`, { maxPages: 3 });
  const r4 = await runShared(scope4, { logFile: join(dir, "nexiste-pas.log"), render: false });
  ok(r4.findings.some((f) => f.rule === "logs-file-missing"), "un chemin invalide produit un constat, pas une exception");
}

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n  constats de logs: ${[...rules].join(", ")}`);
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
