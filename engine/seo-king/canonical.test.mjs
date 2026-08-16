// SEO KING - regression: le canonical apex<->www n'est PAS une fuite inter-domaine.
//
// Bug attrape en dogfood outbound (2026-08): auditer seo.fr en mono-page remontait un
// constat CRITIQUE "se canonicalise vers un autre domaine" parce que la page pointait
// vers www.seo.fr. C'est la config www/apex standard, pas une fuite. Un faux positif
// critique envoye a une agence SEO (qui SAIT que c'est faux) detruit la credibilite.
// sameSite() compare le domaine enregistrable en ignorant www. -> ce test le verrouille.
import { sameSite, registrableDomain } from "./graph.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

// registrableDomain: www et sous-domaines se reduisent au domaine enregistrable.
ok(registrableDomain("www.seo.fr") === "seo.fr", "www.seo.fr -> seo.fr");
ok(registrableDomain("blog.seo.fr") === "seo.fr", "blog.seo.fr -> seo.fr");
ok(registrableDomain("SEO.FR") === "seo.fr", "casse ignoree");
ok(registrableDomain("www.foo.co.uk") === "foo.co.uk", "suffixe a deux niveaux (co.uk) preserve");
ok(registrableDomain("shop.example.com") === "example.com", "sous-domaine e-commerce -> apex");

// sameSite: apex<->www et sous-domaines = meme site (consolidation legitime).
ok(sameSite("https://seo.fr/", "https://www.seo.fr/") === true, "apex et www sont le meme site");
ok(sameSite("https://www.seo.fr", "https://seo.fr") === true, "www et apex, sens inverse");
ok(sameSite("https://seo.fr/", "https://blog.seo.fr/x") === true, "sous-domaine du meme domaine");
ok(sameSite("https://foo.co.uk/", "https://www.foo.co.uk/") === true, "co.uk apex<->www");
ok(sameSite("https://shop.example.com/", "https://www.example.com/") === true, "sous-domaine <-> www du meme apex");

// sameSite: un VRAI autre domaine reste distinct (la fuite doit toujours etre detectee).
ok(sameSite("https://seo.fr/", "https://competitor.com/") === false, "domaine different = pas le meme site");
ok(sameSite("https://foo.co.uk/", "https://bar.co.uk/") === false, "deux domaines distincts sous co.uk");
ok(sameSite("https://a.com/", "https://a.com.evil.com/") === false, "prefixe trompeur n'est pas le meme site");

// Robustesse: entrees cassees -> false, jamais d'exception.
ok(sameSite("pas une url", "https://seo.fr") === false, "entree invalide gere sans crash");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
