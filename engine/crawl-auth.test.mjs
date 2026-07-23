// Test chantier 2: serveur local avec 3 pages dont 1 derriere login (cookie).
// Verifie: (1) auth propagee -> page protegee lue, (2) crawl partage multi-pages,
// (3) agents a11y + content agregent sur plusieurs pages.
import { createServer } from "node:http";
import { recon } from "./recon.js";
import { run as a11yRun } from "./agents/a11y/index.js";
import { run as contentRun } from "./agents/content/index.js";

const COOKIE = "session=secret-token";
// 3 pages: home (liens), /a (probleme a11y: img sans alt + input sans label),
// /private (protegee, exige le cookie; contient aussi une img sans alt).
const PAGES = {
  "/": `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body>
    <h1>Accueil</h1><a href="/a">Page A</a> <a href="/private">Espace prive</a></body></html>`,
  "/a": `<!doctype html><html lang="fr"><head><title>Page A</title></head><body>
    <h1>A</h1><img src="x.png"><form><input type="text" name="q"></form>
    <a href="/">Retour</a></body></html>`,
  "/private": `<!doctype html><html lang="fr"><head><title>Prive</title></head><body>
    <h1>Tableau de bord</h1><img src="chart.png"><p>© 2019 Ancien</p></body></html>`,
};

const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/private") {
    if ((req.headers.cookie || "") !== COOKIE) { res.writeHead(302, { location: "/login" }); return res.end(); }
  }
  const body = PAGES[path];
  if (body == null) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// --- 1. Scan SANS auth: /private redirige (302) -> pas lue en 200 ---
const bare = await recon(base, { maxPages: 5 });
const barePriv = (bare.crawl?.pages || []).find((p) => p.url.endsWith("/private"));
ok(bare.crawl != null, "crawl partage present quand maxPages>1");
ok(bare.crawl.pages.length >= 2, "crawl a trouve plusieurs pages");
ok(!barePriv || barePriv.status !== 200, "sans cookie, /private non lue en 200");

// --- 2. Scan AVEC auth: /private lue en 200 ---
const authed = await recon(base, { maxPages: 5, auth: { cookie: COOKIE } });
ok(authed.auth != null, "scope.auth expose");
const authPriv = (authed.crawl.pages || []).find((p) => p.url.endsWith("/private"));
ok(authPriv && authPriv.status === 200, "avec cookie, /private lue en 200");
ok(authPriv && /Tableau de bord/.test(authPriv.html), "html de la page protegee retenu");

// --- 3. a11y multi-pages: agrege img-no-alt sur /a ET /private ---
const a11y = await a11yRun(authed);
const imgFinding = a11y.findings.find((f) => f.rule === "img-no-alt");
ok(imgFinding, "a11y detecte img sans alt");
ok(/sur 2 pages/.test(imgFinding.title), "a11y AGREGE img-no-alt sur 2 pages: " + (imgFinding?.title || "?"));
ok(a11y.stats.pages >= 3, "a11y a analyse >=3 pages: " + a11y.stats.pages);

// --- 4. content multi-pages: copyright 2019 sur /private ---
const content = await contentRun(authed);
const stale = content.findings.find((f) => f.rule === "stale-copyright");
ok(stale, "content detecte copyright perime (page protegee, via auth)");
ok(/2019/.test(stale?.evidence?.proof || ""), "copyright 2019 vu");

// --- 5. mono-page (gratuit): pas de crawl, analyse home seule ---
const single = await recon(base, {});   // maxPages defaut 1
ok(single.crawl == null, "maxPages=1 -> pas de crawl partage (scan gratuit mono-page)");
const a11ySingle = await a11yRun(single);
ok(a11ySingle.stats.pages === 1, "a11y mono-page analyse 1 page");

server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
