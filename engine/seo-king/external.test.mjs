// SEO KING - sources externes: positions (Search Console) et liens entrants.
//
// Aucun appel reseau sortant: la Search Console est simulee par une fonction fetch
// injectee, et les pages sources des backlinks sont servies par un serveur local. Un
// test qui dependrait d'un compte Google reel ne serait jamais lance.
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractLinks, parseCsv } from "./backlinks/parse-csv.js";
import { verifyBacklinks } from "./backlinks/verify.js";
import { aggregateByPage, propertyCandidates, gscConfigured } from "./gsc/client.js";
import { recon } from "../recon.js";
import { runShared } from "./index.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };
const dir = mkdtempSync(join(tmpdir(), "panoptic-ext-"));

// =====================================================================================
// 1. Lecture d'exports de liens, quel que soit l'outil d'origine
// =====================================================================================
{
  const ahrefs = `"Referring page URL","Target URL","Anchor","Type"
"https://blog-a.test/article","https://cible.test/produit","voir le produit","dofollow"
"https://blog-b.test/avis","https://cible.test/","cible test","nofollow"`;
  const r = extractLinks(ahrefs);
  ok(r.links.length === 2, `export type Ahrefs lu (${r.links.length} liens)`);
  ok(r.links[0].source === "https://blog-a.test/article" && r.links[0].anchor === "voir le produit", "colonnes source et ancre reconnues");

  // Search Console: export "sites les plus liants", donc des DOMAINES, pas des pages.
  const gsc = `Sites les plus liants,Liens entrants
partenaire.test,42
annuaire.test,7`;
  const g = extractLinks(gsc);
  ok(g.links.length === 2 && g.links[0].source === "https://partenaire.test", "export Search Console au niveau domaine converti en URL");
  ok(/niveau domaine/.test(g.note || ""), "la limite de l'export domaine est signalee, pas masquee");

  // CSV sans en-tete reconnaissable: on trouve la colonne d'URL par son contenu.
  const brut = `a,b,c
x,https://source.test/page,y`;
  ok(extractLinks(brut).links.length === 1, "colonne d'URL detectee sans en-tete connu");

  // Robustesse du parseur: virgules et guillemets internes.
  const tricky = parseCsv('"a,b","c""d"\n1,2');
  ok(tricky[0][0] === "a,b" && tricky[0][1] === 'c"d', "virgules et guillemets echappes correctement lus");
  ok(extractLinks("").links.length === 0, "fichier vide gere sans exception");
}

// =====================================================================================
// 2. Verification reelle des liens, avec un serveur qui simule les cas du terrain
// =====================================================================================
const server = createServer((req, res) => {
  const p = req.url.split("?")[0];
  const html = (body, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  if (p === "/vivant") return res.end(html(`<p>texte</p><a href="https://cible.test/produit">notre produit</a>`));
  if (p === "/nofollow") return res.end(html(`<a rel="nofollow ugc" href="https://cible.test/">cible</a>`));
  if (p === "/perdu") return res.end(html(`<p>on parle d'autre chose</p><a href="https://ailleurs.test/">ailleurs</a>`));
  if (p === "/noindex") return res.end(html(`<a href="https://cible.test/x">cible</a>`, `<meta name="robots" content="noindex">`));
  if (p === "/relatif") return res.end(html(`<a href="//cible.test/via-protocole">cible</a>`));
  if (p === "/disparu") { res.statusCode = 404; return res.end(html("<h1>404</h1>")); }
  // Pare-feu: le piege. Ne doit JAMAIS etre compte comme un lien perdu.
  if (p === "/waf") { res.statusCode = 403; return res.end(html("<h1>Access denied</h1>")); }
  if (p === "/challenge") return res.end(html("<h1>Just a moment...</h1><p>Checking your browser</p>"));
  res.statusCode = 404; res.end("nope");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${server.address().port}`;

{
  const links = ["/vivant", "/nofollow", "/perdu", "/noindex", "/relatif", "/disparu", "/waf", "/challenge"]
    .map((p) => ({ source: B + p }));
  const r = await verifyBacklinks(links, { targetHost: "cible.test", cap: 20 });

  const byPath = Object.fromEntries(r.results.map((x) => [x.source.replace(B, ""), x]));
  ok(byPath["/vivant"].state === "verified" && byPath["/vivant"].anchor === "notre produit", "lien vivant confirme avec son ancre");
  ok(byPath["/nofollow"].state === "verified" && byPath["/nofollow"].nofollow === true, "nofollow/ugc reconnu comme ne transmettant pas d'autorite");
  ok(byPath["/perdu"].state === "lost", "lien reellement disparu classe comme perdu");
  ok(byPath["/noindex"].state === "verified" && byPath["/noindex"].sourceNoindex === true, "page source en noindex signalee");
  ok(byPath["/relatif"].state === "verified", "lien en URL relative au protocole correctement resolu");
  ok(byPath["/disparu"].state === "source-gone", "page source supprimee distinguee d'un lien retire");

  // LE PIEGE: un blocage n'est pas une disparition.
  ok(byPath["/waf"].state === "unverifiable", "une page protegee par pare-feu n'est PAS declaree perdue");
  ok(byPath["/challenge"].state === "unverifiable", "un interstitiel anti-robot n'est PAS declare perdu");
  ok(r.counts.lost === 1, `un seul lien reellement perdu (${r.counts.lost}), les blocages exclus`);
  ok(r.counts.unverifiable === 2, `deux liens non verifiables comptes a part (${r.counts.unverifiable})`);
  ok(r.counts.dofollow === 3, `liens transmettant l'autorite comptes exactement (${r.counts.dofollow})`);

  // Deduplication et plafond.
  const dup = await verifyBacklinks([{ source: B + "/vivant" }, { source: B + "/vivant#ancre" }], { targetHost: "cible.test" });
  ok(dup.results.length === 1, "les doublons d'URL source sont fusionnes");
}

// =====================================================================================
// 3. Bout en bout: la lane backlinks dans un audit
// =====================================================================================
const site = createServer((req, res) => {
  const p = req.url.split("?")[0].replace(/\/$/, "") || "/";
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (p === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
  if (p === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); return res.end(`<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${site.port}/</loc></url></urlset>`); }
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Site cible ${p}</title>
    <link rel="canonical" href="http://127.0.0.1:${site.port}${p}"></head>
    <body><h1>Cible</h1><p>${"contenu ".repeat(80)}</p></body></html>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
site.port = site.address().port;
const HOST = `127.0.0.1:${site.port}`;

{
  // Les pages sources pointent vers le site audite (meme hote que le serveur de test).
  const src = createServer((req, res) => {
    const p = req.url.split("?")[0];
    res.setHeader("content-type", "text/html");
    if (p === "/ok") return res.end(`<html><body><a href="http://${HOST}/">cible</a></body></html>`);
    if (p === "/parti") return res.end(`<html><body><p>plus de lien</p></body></html>`);
    res.statusCode = 404; res.end("x");
  });
  await new Promise((r) => src.listen(0, "127.0.0.1", r));
  const S = `http://127.0.0.1:${src.address().port}`;

  const csv = `Referring page URL,Target URL,Anchor\n${S}/ok,http://${HOST}/,cible\n${S}/parti,http://${HOST}/,ancienne\n`;
  writeFileSync(join(dir, "liens.csv"), csv);

  const scope = await recon(`http://${HOST}`, { maxPages: 3 });
  const r = await runShared(scope, { backlinksFile: join(dir, "liens.csv"), render: false });
  const rules = new Set(r.findings.filter((f) => f.lane === "backlinks").map((f) => f.rule));
  ok(rules.has("backlinks-lost"), "la lane signale le lien disparu");
  ok(rules.has("backlinks-discovery-out-of-scope"), "la lane annonce ce qu'elle NE peut PAS faire");
  ok(r.backlinks?.counts?.verified === 1, `un lien verifie vivant (${r.backlinks?.counts?.verified})`);
  ok(r.strengths.some((s) => /verifies en direct/.test(s.text)), "les liens vivants sont portes en point fort");
  src.close();
}

// Sans fichier: silence motive.
{
  const scope = await recon(`http://${HOST}`, { maxPages: 2 });
  const r = await runShared(scope, { render: false });
  const l = r.lanes.find((x) => x.id === "backlinks");
  ok(l.findings === 0 && /aucun export/.test(l.skipped || ""), "sans export, la lane se tait en expliquant pourquoi");
}

// =====================================================================================
// 4. Positions: Search Console simulee
// =====================================================================================
ok(gscConfigured({}) === false, "sans variable d'environnement, la Search Console est declaree non configuree");
ok(gscConfigured({ PANOPTIC_GSC_TOKEN: "x" }) === true, "un jeton suffit a l'activer");
ok(propertyCandidates("https://x.fr", "www.x.fr").includes("sc-domain:x.fr"), "les deux formes de propriete sont essayees");

{
  // Valeurs choisies pour que moyenne PONDEREE et moyenne SIMPLE divergent nettement:
  // ponderee = (3.0*10000 + 9.0*2000)/12000 = 4.0 ; simple = (3.0+9.0)/2 = 6.0.
  // Un test dont les deux calculs donnent presque le meme resultat ne prouve rien.
  const rows = [
    { keys: ["https://x.fr/a", "requete forte"], clicks: 10, impressions: 10000, ctr: 0.001, position: 3.0 },
    { keys: ["https://x.fr/a", "requete rare"], clicks: 2, impressions: 2000, ctr: 0.001, position: 9.0 },
    { keys: ["https://x.fr/b", "requete moyenne"], clicks: 50, impressions: 1000, ctr: 0.05, position: 8.4 },
  ];
  const agg = aggregateByPage(rows.map((r) => ({ page: r.keys[0], query: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })));
  ok(agg.length === 2, "agregation par page");
  ok(agg[0].impressions === 12000, "impressions cumulees par page");
  ok(agg[0].position === 4, `position moyenne PONDEREE par les impressions: 4.0 attendu, pas 6.0 (obtenu ${agg[0].position})`);

  // Fetch simule: aucune connexion sortante.
  const fetchImpl = async (url) => {
    if (!/searchAnalytics/.test(url)) return { ok: false, status: 404, text: async () => "{}" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rows }) };
  };
  const scope = await recon(`http://${HOST}`, { maxPages: 3 });
  const r = await runShared(scope, {
    render: false,
    env: { PANOPTIC_GSC_TOKEN: "jeton-de-test-1234567890" },
    fetchImpl,
  });
  const rules = new Set(r.findings.filter((f) => f.lane === "positions").map((f) => f.rule));
  ok(r.positions?.pages?.length === 2, "les positions remontent au rapport");
  ok(rules.has("striking-distance-pages"), "les pages a portee de main (positions 4-15) sont identifiees");
  ok(rules.has("positions-own-site-only"), "la limite au seul site audite est annoncee");
  ok(r.strengths.some((s) => /impressions/.test(s.text)), "le volume reel est porte en point fort");
}

// Erreur d'API: aucune position inventee.
{
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "User does not have sufficient permission" } }) });
  const scope = await recon(`http://${HOST}`, { maxPages: 2 });
  const r = await runShared(scope, { render: false, env: { PANOPTIC_GSC_TOKEN: "jeton-de-test-1234567890" }, fetchImpl });
  const f = r.findings.find((x) => x.rule === "positions-unavailable");
  ok(Boolean(f), "un refus d'acces produit un constat honnete");
  ok(/acces refuse/.test(f.proof), "la cause exacte est nommee, pas un message generique");
  ok(!r.positions, "aucune donnee de position n'est publiee en cas d'echec");
}

// Non configuree: silence motive, aucun constat parasite.
{
  const scope = await recon(`http://${HOST}`, { maxPages: 2 });
  const r = await runShared(scope, { render: false, env: {} });
  const l = r.lanes.find((x) => x.id === "positions");
  ok(l.findings === 0 && /non configuree/.test(l.skipped || ""), "sans configuration, la lane se tait en expliquant pourquoi");
}

server.close(); site.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
