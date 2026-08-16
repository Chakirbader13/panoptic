// Test rendu JS (sites SPA). Marqueur encode en base64 -> ABSENT du HTML brut, present
// seulement apres execution du JS. Degrade gracieusement si aucun Chromium (cas CI).
import { createServer } from "node:http";
import { makeRenderer, looksLikeSpa } from "./scanners/browser.js";
import { recon } from "./recon.js";

const MARKER = "PANOPTIC_RENDERED_ONLY_9F3A"; // n'apparait JAMAIS dans le HTML brut
const B64 = Buffer.from(`<h1>${MARKER}</h1><a href=/page2>lien</a>`, "utf8").toString("base64");
const SHELL = `<!doctype html><html lang=fr><head><title>SPA</title></head><body><div id="root"></div><script>document.getElementById("root").innerHTML=atob("${B64}")</script></body></html>`;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

const srv = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(SHELL); });
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}/`;

// 1. Detection SPA (pure, sans navigateur) - toujours testable.
ok(looksLikeSpa(SHELL) === true, "looksLikeSpa detecte une coquille SPA");
ok(looksLikeSpa("<html><body>" + "mot ".repeat(200) + "</body></html>") === false, "site riche en texte n'est pas vu comme SPA");
ok(!SHELL.includes(MARKER), "le marqueur est ABSENT du HTML brut (encode base64)");

// 2. Rendu reel si Chromium dispo; sinon degradation gracieuse. Le module Playwright
// peut etre present sans le BINAIRE Chromium (CI: npm install --ignore-scripts) -> le
// rendu renvoie { error } et l'audit retombe sur le HTML brut, sans crash.
const r = await makeRenderer({});
const probe = r.available ? await r.render(base) : { error: "no-module" };
const browserWorks = r.available && !probe.error && (probe.html || "").length > 0;
if (r.available) await r.close();

if (browserWorks) {
  ok(probe.html.includes(MARKER), "le rendu execute le JS et expose le contenu");

  // 3. recon paye (browserScan) rend l'accueil ET le crawl decouvre les liens JS.
  const scope = await recon(base, { maxPages: 3, browserScan: true });
  ok(scope.home.body.includes(MARKER), "recon: accueil rendu (contenu JS present)");
  ok((scope.crawl?.pages || []).some((p) => p.url.includes("/page2")), "recon: crawl a suivi un lien injecte par JS");

  // 4. recon gratuit (mono-page, pas de navigateur) NE rend PAS: pas de marqueur.
  const bare = await recon(base, {});
  ok(!bare.home.body.includes(MARKER), "scan gratuit: pas de rendu, accueil = coquille brute");
} else {
  console.log("  (Chromium indisponible: " + (probe.error || "?") + " -> degradation gracieuse verifiee)");
  const bare = await recon(base, { maxPages: 3, browserScan: true });
  ok(!bare.home.body.includes(MARKER), "sans navigateur: repli HTML brut, aucun crash");
}

srv.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
