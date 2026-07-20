// Panoptic - Couche 3: verification adversariale (le defaut par defaut du produit).
//
// Principe: NE JAMAIS faire confiance au verdict de l'agent qui a leve le finding.
// Pour chaque finding on tente de le REFUTER, de facon deterministe et sans LLM:
//   1. Re-derivation independante depuis la preuve de recon PARTAGEE (autoritaire pour
//      les faits d'origine: presence robots/sitemap/security.txt/llms, balises du HTML
//      d'accueil). Une logique independante de celle de l'agent -> attrape les faux
//      positifs (ex: l'agent dit "pas de sitemap" alors que recon en a vu un).
//   2. Gardes: preuve exigee, reproductibilite, respect d'une verification d'agent deja
//      solide (securite: entropie/signature), sinon plafonnement honnete a "plausible".
//
// Verdicts:
//   confirmed  = reproduit independamment OU observe live avec preuve
//   plausible  = affirme mais non reproductible ici (revue recommandee) -> priorite x0.6
//   rejected   = recon CONTREDIT la claim, ou placeholder -> exclu du score et du rapport
//
// Le scoring (schema.js) pondere deja par ce verdict: cette couche a donc un effet reel
// sur le score, la priorisation et ce qui apparait dans le rapport.
import { SEVERITY } from "./schema.js";
import { meta } from "./agents/shared.js";

function V(verdict, votes, refuters, reason) { return { verdict, votes, refuters, reason }; }

const hasLdJson = (body) => /application\/ld\+json/i.test(body || "");

// rule -> predicate(scope): true = la condition tient (finding valide, reproduit),
//                           false = recon CONTREDIT (faux positif a rejeter),
//                           null  = recon ne peut pas trancher (on passe aux gardes).
// On ne renvoie false (rejet autoritaire) que quand recon prouve le contraire.
const REDERIVE = {
  "no-security-txt": (s) => (s.securityTxt?.present ? false : true),
  "no-sitemap":      (s) => (s.sitemap?.present ? false : true),
  "no-robots":       (s) => (s.robots?.present ? false : true),
  "no-llms-txt":     (s) => (s.llmsTxt?.present ? false : true),
  // Donnees structurees (SEO): n'importe quel JSON-LD suffit a contredire.
  "no-structured-data": (s) => (hasLdJson(s.home?.body) ? false : true),
  // JSON-LD geo specifiquement: si AUCUN JSON-LD -> forcement pas de geo (confirme);
  // s'il y en a, on ne peut pas savoir s'il est geo -> on laisse l'agent (null).
  "no-jsonld-geo":   (s) => (hasLdJson(s.home?.body) ? null : true),
  "missing-viewport": (s) => (metaPresent(s, 'name=["\']viewport') ? false : true),
  "missing-og":      (s) => (metaPresent(s, 'property=["\']og:title') ? false : true),
  // Absence dans le HTML ne prouve PAS l'absence d'analytics (script injecte):
  // on rejette seulement si un tag est visible, sinon on laisse l'agent decider.
  "no-analytics":    (s) => (/gtag\(|googletagmanager|google-analytics|plausible\.io|matomo|posthog/i.test(s.home?.body || "") ? false : null),
};

function metaPresent(scope, key) {
  const body = scope.home?.body;
  if (!body) return false;
  return meta(body, key) != null;
}

const rank = (f) => SEVERITY[f.severity]?.rank ?? 1;
const hasEvidence = (f) => Boolean(f.evidence?.proof || f.location?.file || f.location?.url || f.evidence?.artifact);

// Verdict par defaut pose par makeFinding (aucune verification propre de l'agent).
const isDefaultCheck = (f) => {
  const r = f.check?.reason;
  return !r || r === "Observe directement.";
};

// Challenge UN finding contre le scope. Pur, deterministe.
export function verifyFinding(finding, scope = {}) {
  // Un rejet pose par l'agent (ex: securite placeholder/entropie) reste rejete.
  if (finding.check?.verdict === "rejected") return finding;

  // 1. Re-derivation independante autoritaire.
  const pred = REDERIVE[finding.rule];
  if (pred) {
    const held = pred(scope);
    if (held === false) return { ...finding, check: V("rejected", 0, 3, "Recon contredit la claim: ressource/balise presente.") };
    if (held === true)  return { ...finding, check: V("confirmed", 3, 0, "Reproduit independamment depuis la reconnaissance.") };
    // null -> gardes ci-dessous
  }

  // 2. Affirmation forte sans aucune preuve: on ne peut pas la confirmer -> plausible.
  if (!hasEvidence(finding) && rank(finding) >= 4) {
    return { ...finding, check: V("plausible", 1, 2, "Gravite elevee mais aucune preuve attachee: a confirmer.") };
  }

  // 3. Explicitement non reproductible.
  if (finding.evidence?.reproducible === false) {
    return { ...finding, check: V("plausible", 2, 1, "Non marque comme reproductible: a confirmer.") };
  }

  // 4. L'agent a fait sa PROPRE verification (verdict non-defaut): on la respecte.
  //    (securite: signature/entropie; seo: plausible motive; deps via OSV; etc.)
  if (finding.check && !isDefaultCheck(finding)) return finding;

  // 5. Signal honnete = PREUVE CONCRETE, pas code-vs-prod. Un finding porteur d'une
  //    preuve (snippet code, en-tete observe, ids OSV) est confirme; sans preuve, on
  //    ne peut pas le reproduire -> plausible (jamais de "confirme" gratuit).
  if (finding.evidence?.proof) {
    const reason = finding.evidence.type === "prod"
      ? "Observe sur la reponse live avec preuve."
      : "Preuve concrete attachee (code/donnee).";
    return { ...finding, check: V("confirmed", 3, 0, reason) };
  }
  return { ...finding, check: V("plausible", 2, 1, "Sans preuve concrete reproductible: revue recommandee.") };
}
