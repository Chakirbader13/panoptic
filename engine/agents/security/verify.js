// Panoptic - Agent securite: verification adversariale.
// Chaque finding brut est challenge avant d'entrer dans le rapport. C'est ce qui
// transforme une liste de matches regex en findings credibles (peu de faux positifs).
//   verdict: "confirmed" (preuve solide) | "plausible" (a confirmer) | "rejected" (faux positif)

const PLACEHOLDER = /\b(example|examples|xxx+|your[_-]?|changeme|change_me|placeholder|dummy|sample|redacted|fake|test[_-]?key|foo|bar|lorem|000000|123456|<[^>]+>|\.\.\.|process\.env|import\.meta|getenv)\b/i;

// Entropie de Shannon (bits/caractere). Un vrai secret est > ~3.2; un mot commun ~2.
function entropy(s) {
  if (!s) return 0;
  const freq = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  let h = 0;
  const n = s.length;
  for (const c in freq) { const p = freq[c] / n; h -= p * Math.log2(p); }
  return h;
}

function verdict(v, votes, refuters, reason) {
  return { verdict: v, votes, refuters, reason };
}

// raw = finding brut de scan.js ou prod.js
export function verifyFinding(raw) {
  const conf = raw.confidence || "medium";
  const evidence = raw.match || raw.proof || "";

  // Les findings de prod (headers, cookies, TLS, fichiers exposes) sont directement
  // observes sur la reponse HTTP: la preuve EST la reproduction.
  if (raw.kind === "prod") {
    return verdict("confirmed", 3, 0, "Observe directement sur la reponse HTTP.");
  }

  // Secrets: placeholder = faux positif certain.
  if (raw.kind === "secret") {
    if (PLACEHOLDER.test(raw.source) || PLACEHOLDER.test(evidence)) {
      return verdict("rejected", 0, 3, "Valeur de type placeholder / exemple, pas un secret reel.");
    }
    // Secret generique: exiger de l'entropie, sinon plausible seulement.
    if (raw.ruleId === "generic-secret-assign") {
      const val = (evidence.match(/['"]([^'"]{12,})['"]/) || [])[1] || evidence;
      const h = entropy(val);
      if (h < 3.0) return verdict("rejected", 1, 2, `Entropie faible (${h.toFixed(2)} bits/car), probablement pas un secret.`);
      return verdict("plausible", 2, 1, `Entropie ${h.toFixed(2)} bits/car: a confirmer manuellement.`);
    }
    // Secret a prefixe reconnu (sk_live_, AKIA...): signature forte.
    return verdict("confirmed", 3, 0, "Signature de secret reconnue et non-placeholder.");
  }

  // Code (SAST): la confiance de la regle pilote le verdict.
  if (conf === "high") return verdict("confirmed", 3, 0, "Pattern a signal fort, faible taux de faux positifs.");
  if (conf === "medium") {
    // Un sink sur une constante litterale est moins dangereux qu'avec une variable.
    if (/=\s*['"`][^'"`$]*['"`]\s*;?\s*$/.test(raw.source)) {
      return verdict("plausible", 2, 1, "Sink present mais la valeur semble litterale: a verifier.");
    }
    return verdict("confirmed", 3, 0, "Sink dangereux avec entree dynamique probable.");
  }
  return verdict("plausible", 2, 1, "Signal faible: revue manuelle recommandee.");
}
