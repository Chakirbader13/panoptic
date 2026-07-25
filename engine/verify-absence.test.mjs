// Test /avis: le verificateur doit REJETER un constat "absence de X" quand X existe
// dans le DOM (defense en profondeur contre les faux positifs type "aucun CTA").
import { verifyFinding } from "./verify.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

const withCta = { home: { body: `<h1>Un titre de valeur assez long</h1><a class="btn btn-p" href="/c">Scanner mon site</a>` } };
const noCta = { home: { body: `<h1>Une page sans action cliquable du tout ici</h1><p>texte</p>` } };
const fp = (rule) => ({ rule, severity: "high", title: rule, evidence: { proof: "auto-referentiel", type: "prod" } });

// no-cta: rejete si un CTA existe, confirme s'il n'y en a vraiment pas.
ok(verifyFinding(fp("no-cta"), withCta).check.verdict === "rejected", "no-cta rejete quand CTA present (faux positif tue)");
ok(verifyFinding(fp("no-cta"), noCta).check.verdict === "confirmed", "no-cta confirme quand aucun CTA reel");

// weak-value-prop: rejete si un h1 substantiel existe.
ok(verifyFinding(fp("weak-value-prop"), withCta).check.verdict === "rejected", "weak-value-prop rejete si h1 fort present");
ok(verifyFinding({ rule: "weak-value-prop", severity: "medium", evidence: { proof: "x", type: "prod" } }, { home: { body: "<h1>ok</h1>" } }).check.verdict === "confirmed", "weak-value-prop confirme si h1 trop court");

// no-structured-data: rejete si JSON-LD present.
ok(verifyFinding(fp("no-structured-data"), { home: { body: `<script type="application/ld+json">{}</script>` } }).check.verdict === "rejected", "no-structured-data rejete si JSON-LD present");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
