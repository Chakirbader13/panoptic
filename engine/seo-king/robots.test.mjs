// SEO KING - conformite RFC 9309 du parseur robots.txt.
// Chaque cas ici correspond a un faux positif que produit la regex naive utilisee
// par la plupart des outils d'audit ("User-agent: X" suivi de "Disallow: /").
import { parseRobots, isAllowed, groupFor, crawlerMatrix } from "./robots.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// --- Groupes multi user-agent -------------------------------------------------------
const multi = parseRobots(`
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /prive/

User-agent: *
Allow: /
`);
ok(multi.groups.length === 2, "deux groupes distincts");
ok(multi.groups[0].agents.length === 2, "lignes User-agent consecutives partagent un groupe");
ok(!isAllowed(multi, "GPTBot", "/prive/x").allowed, "GPTBot bloque sur /prive/");
ok(!isAllowed(multi, "ClaudeBot", "/prive/x").allowed, "ClaudeBot herite du meme groupe");
ok(isAllowed(multi, "GPTBot", "/public").allowed, "GPTBot autorise ailleurs");
ok(isAllowed(multi, "PerplexityBot", "/prive/x").allowed, "bot non liste retombe sur le groupe *");

// --- Precedence Allow / Disallow (RFC 9309 2.2.2) -----------------------------------
const prec = parseRobots(`
User-agent: *
Disallow: /blog/
Allow: /blog/public/
`);
ok(!isAllowed(prec, "Googlebot", "/blog/prive").allowed, "Disallow s'applique par defaut");
ok(isAllowed(prec, "Googlebot", "/blog/public/a").allowed, "Allow plus specifique gagne sur Disallow");

// --- Jokers et ancre de fin -----------------------------------------------------------
const wild = parseRobots(`
User-agent: *
Disallow: /*.pdf$
Disallow: /tmp/*/cache
`);
ok(!isAllowed(wild, "Googlebot", "/docs/guide.pdf").allowed, "motif *.pdf$ bloque un PDF");
ok(isAllowed(wild, "Googlebot", "/docs/guide.pdf.html").allowed, "l'ancre $ empeche le faux positif .pdf.html");
ok(!isAllowed(wild, "Googlebot", "/tmp/a/cache").allowed, "joker au milieu du chemin");

// --- Disallow vide = tout autoriser (RFC 9309 5.1) --------------------------------------
const empty = parseRobots(`
User-agent: GPTBot
Disallow:
`);
ok(isAllowed(empty, "GPTBot", "/").allowed, "Disallow vide n'est PAS un blocage");

// Le piege exact que la regex naive produit: elle voit "User-agent: GPTBot" puis
// "Disallow: /" plus loin dans le fichier et conclut a un blocage.
const naiveTrap = parseRobots(`
User-agent: GPTBot
Allow: /

User-agent: BadBot
Disallow: /
`);
ok(isAllowed(naiveTrap, "GPTBot", "/").allowed, "GPTBot autorise malgre un Disallow: / dans un AUTRE groupe");
ok(!isAllowed(naiveTrap, "BadBot", "/").allowed, "BadBot reellement bloque");

// --- Specificite du groupe ----------------------------------------------------------------
const spec = parseRobots(`
User-agent: *
Disallow: /

User-agent: Googlebot
Allow: /
`);
ok(isAllowed(spec, "Googlebot", "/page").allowed, "groupe nomme prime sur le groupe *");
ok(!isAllowed(spec, "Bingbot", "/page").allowed, "les autres restent sur le groupe *");
ok(groupFor(spec, "Googlebot").agents.includes("googlebot"), "groupFor renvoie le groupe nomme");

// --- Le groupe d'une VARIANTE ne doit pas capter le crawler principal -------------------
// Regression: la correspondance etait bidirectionnelle, donc "Googlebot-Image" captait
// "Googlebot" (nom plus long = gagnant). Consequence: on annoncait l'indexeur principal
// bloque alors que seule l'indexation d'images l'etait. Faux critique le plus grave.
const variant = parseRobots(`
User-agent: Googlebot-Image
Disallow: /

User-agent: *
Allow: /
`);
ok(groupFor(variant, "Googlebot").agents.includes("*"), "Googlebot retombe sur * et non sur le groupe Googlebot-Image");
ok(isAllowed(variant, "Googlebot", "/").allowed, "Googlebot n'est PAS declare bloque par une regle destinee aux images");
ok(!isAllowed(variant, "Googlebot-Image", "/photo.jpg").allowed, "Googlebot-Image reste bien bloque par son propre groupe");
// Le sens inverse reste valide (RFC 9309 2.2.1): un groupe generique couvre ses variantes.
const generic = parseRobots("User-agent: Googlebot\nDisallow: /prive/\n");
ok(!isAllowed(generic, "Googlebot-News", "/prive/x").allowed, "un groupe Googlebot couvre bien Googlebot-News");

// --- Regles hors groupe ------------------------------------------------------------------
const orphan = parseRobots(`
Disallow: /oublie/
User-agent: *
Allow: /
`);
ok(orphan.unknownDirectives.length === 1, "une regle avant tout User-agent est mise de cote");
ok(isAllowed(orphan, "Googlebot", "/oublie/x").allowed, "une regle hors groupe est ignoree, comme le font les crawlers");

// --- Commentaires et directive Sitemap ------------------------------------------------------
const comments = parseRobots(`
# commentaire
User-agent: *   # inline
Disallow: /admin/
Sitemap: https://exemple.fr/sitemap.xml
`);
ok(comments.sitemaps.length === 1, "directive Sitemap collectee");
ok(!isAllowed(comments, "Googlebot", "/admin/x").allowed, "commentaire inline n'empeche pas le parsing");

// --- Matrice de crawlers ----------------------------------------------------------------------
const matrix = crawlerMatrix(parseRobots("User-agent: *\nDisallow: /api/\n"), ["/", "/api/v1", "/prix"]);
const google = matrix.find((b) => b.ua === "Googlebot");
ok(google.blockedCount === 1, "la matrice compte exactement les chemins bloques");
ok(google.blockedPaths[0] === "/api/v1", "la matrice nomme le chemin bloque");
ok(matrix.every((b) => b.kind && b.platform), "chaque crawler porte son type et sa plateforme");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
