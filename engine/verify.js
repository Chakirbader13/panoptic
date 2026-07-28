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

// --- Re-derivation DOM pour les constats "absence de X" ---------------------------
// Lecon /avis (GPT-5+Gemini): un constat "aucun X" ne doit JAMAIS etre confirme sur la
// seule parole de l'agent. On cherche X dans le DOM reel; si on le trouve -> faux positif.
const CTA_CLASS = /class\s*=\s*["'][^"']*\b(btn|cta|button)\b/i;
const CTA_WORDS = /(acheter|commander|inscri|essa|reserver|contact|devis|demarrer|lancer|scan|analys|audit|activer|obtenir|decouvrir|commencer|get started|sign up|buy|try|book|start|subscribe|launch|download|telecharger)/i;
function hasCta(body) {
  if (!body) return false;
  if (CTA_CLASS.test(body)) return true;
  const tags = body.match(/<(a|button)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  return tags.some((t) => CTA_WORDS.test(t.replace(/<[^>]+>/g, " ")));
}
function strongH1(body) {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body || "");
  return Boolean(m && m[1].replace(/<[^>]+>/g, "").trim().length >= 8);
}

// rule -> predicate(scope): true = la condition tient (finding valide, reproduit),
//                           false = recon CONTREDIT (faux positif a rejeter),
//                           null  = recon ne peut pas trancher (on passe aux gardes).
// On ne renvoie false (rejet autoritaire) que quand recon prouve le contraire.
const REDERIVE = {
  "no-security-txt": (s) => (s.securityTxt?.present ? false : true),
  "no-sitemap":      (s) => (s.sitemap?.present ? false : true),
  "no-robots":       (s) => (s.robots?.present ? false : true),
  "no-llms-txt":     (s) => (s.llmsTxt?.present ? false : true),
  // CTA / proposition de valeur: on cherche l'element dans le DOM avant de confirmer.
  // (Attrape le faux positif "aucun CTA" sur un site qui en a: cf. /avis GPT-5+Gemini.)
  "no-cta":          (s) => (hasCta(s.home?.body) ? false : true),
  "weak-value-prop": (s) => (strongH1(s.home?.body) ? false : true),
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

// --- Gardes generiques par niveau de verifiabilite ---------------------------------
// Une regle declare ce qu'elle est capable de prouver (voir makeFinding). Le
// verificateur applique alors une garde generique, plutot qu'une entree de table
// par regle: avec ~90 regles SEO/GEO, une table exhaustive serait impossible a
// maintenir et deviendrait le vrai point de faux positifs.
const VERIFIABILITY = {
  // La preuve EST l'observation: la balise manque dans un HTML qu'on tient.
  "self-evident": (f) => (f.evidence?.proof
    ? V("confirmed", 3, 0, "Constat direct sur l'artefact recupere, preuve citee.")
    : V("plausible", 1, 2, "Regle auto-portante mais aucune preuve attachee.")),
  // Deduit d'au moins deux observations independantes (ex: on a recupere la page
  // cible d'un hreflang et lu ce qu'elle declare en retour).
  "cross-checked": (f) => (f.evidence?.proof
    ? V("confirmed", 3, 0, "Recoupe sur au moins deux observations independantes.")
    : V("plausible", 2, 1, "Recoupement annonce sans preuve citee.")),
  // Vrai sur l'echantillon observe. Ne se generalise pas au site entier: on ne
  // laisse jamais ce niveau produire une certitude.
  sampled: (f) => (f.evidence?.proof
    ? V("confirmed", 2, 1, "Verifie sur l'echantillon observe; ne se generalise pas au site entier.")
    : V("plausible", 1, 2, "Echantillon sans preuve citee.")),
  // Signal, pas preuve. Ne peut jamais etre confirme.
  inconclusive: () => V("plausible", 1, 2, "Signal interpretable: confirmation humaine requise."),
};

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

  // 2 bis. Garde generique selon le niveau de verifiabilite declare par la regle.
  // Passe APRES la re-derivation (qui reste autoritaire pour rejeter un faux
  // positif) et AVANT les gardes historiques.
  const guard = VERIFIABILITY[finding.verifiability];
  if (guard) return { ...finding, check: guard(finding) };

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
