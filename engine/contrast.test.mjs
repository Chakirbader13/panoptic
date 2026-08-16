// Test contraste WCAG avec resolution des variables CSS. Verrouille le fix du faux
// positif dark-mode (var(--bg) non resolu -> fond blanc par defaut -> fausses alertes).
import { analyzeContrast } from "./agents/a11y/contrast.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

const html = `<html><body><p class="x">un texte assez long pour etre evalue</p></body></html>`;

// 1. Dark-mode via variables: texte clair sur fond sombre = BON contraste, aucun faux positif.
let r = analyzeContrast(html, [":root{--bg:#070a08;--fg:#63b3ff}body{background:var(--bg)}.x{color:var(--fg)}"]);
ok(r.violations.length === 0, "dark-mode par variables: aucun faux positif (var(--bg) resolu)");

// 2. Vrai faible contraste via variables: DOIT etre detecte.
r = analyzeContrast(html, [":root{--bg:#f0f0f0;--fg:#c0c0c0}body{background:var(--bg)}.x{color:var(--fg)}"]);
ok(r.violations.length > 0, "vrai faible contraste via variables detecte");

// 3. Baseline sans variables: comportement inchange (regression).
r = analyzeContrast(html, ["body{background:#f0f0f0}.x{color:#c0c0c0}"]);
ok(r.violations.length > 0, "faible contraste sans variable detecte (baseline)");

// 4. var() avec repli utilise (couleurs assez distinctes pour depasser la garde <1.25:1).
r = analyzeContrast(html, ["body{background:#0a0a0a}.x{color:var(--absent, #444444)}"]);
ok(r.violations.length > 0, "var() avec valeur de repli resolue et evaluee");

// 5. Variable en chaine (var pointant une var).
r = analyzeContrast(html, [":root{--base:#070a08;--bg:var(--base);--fg:#f2f5f2}body{background:var(--bg)}.x{color:var(--fg)}"]);
ok(r.violations.length === 0, "resolution recursive de variables (var -> var)");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
