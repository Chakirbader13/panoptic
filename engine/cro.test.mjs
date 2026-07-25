// Test de non-regression: le faux positif "aucun CTA" (bug decouvert via /avis GPT-5+Gemini)
// sur un site dont le CTA reel est "Scanner mon site" (verbe hors dico initial) + boutons stylises.
import { run } from "./agents/cro/index.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };
const cro = (html) => run({ reachable: true, url: "https://x.fr/", home: { body: html } });

// 1. CTA par bouton stylise, libelle sans verbe du dico d'origine ("Scanner").
const withStyledCta = `<html><body><h1>Quinze experts, un rapport, zero angle mort ici</h1>
  <a class="btn btn-p" href="/console/">Scanner mon site</a>
  <p>Avis clients: ils nous font confiance.</p></body></html>`;
let r = cro(withStyledCta);
ok(!r.findings.find((f) => f.rule === "no-cta"), "pas de faux positif no-cta quand CTA stylise present");
ok(r.stats.ctas >= 1, "CTA compte >=1: " + r.stats.ctas);

// 2. CTA par verbe elargi seul (sans class), ex "Lancer l'audit".
r = cro(`<html><body><h1>Un titre de valeur assez long pour passer</h1><a href="/go">Lancer l'audit complet</a></body></html>`);
ok(!r.findings.find((f) => f.rule === "no-cta"), "verbe elargi (lancer) reconnu comme CTA");

// 3. VRAI cas sans CTA: aucun bouton, aucun verbe -> le finding DOIT firer.
r = cro(`<html><body><h1>Une page de texte sans aucune action cliquable ici</h1><a href="/blog">nos articles</a><p>lorem</p></body></html>`);
ok(r.findings.find((f) => f.rule === "no-cta"), "no-cta fire bien quand il n'y a reellement aucun CTA");

// 4. Repetition du meme CTA (nav+hero+footer) != overload (bonne pratique).
const repeated = `<html><body><h1>Titre de valeur suffisamment long pour valider</h1>` +
  Array(5).fill('<a class="btn" href="/c">Scanner mon site</a>').join("") + `</body></html>`;
r = cro(repeated);
ok(!r.findings.find((f) => f.rule === "cta-overload"), "meme CTA repete n'est pas un overload");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
