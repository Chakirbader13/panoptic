// Panoptic - genere un bundle de correctifs pret pour une pull request.
// Ne pousse rien tout seul: produit le corps de PR (markdown) + une checklist par fichier.
// L'ouverture reelle se fait en opt-in via `gh pr create` (voir buildPrCommand).
const eur = (n) => (n || 0).toLocaleString("fr-FR");

export function buildFixBundle(rec) {
  const f = (rec.findings || []).filter((x) => x.check?.verdict !== "rejected");
  const code = f.filter((x) => x.location?.file);
  const prod = f.filter((x) => x.location?.url);

  const bySeverity = (arr) => {
    const order = ["critical", "high", "medium", "low", "info"];
    return [...arr].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  };

  const line = (x) => {
    const loc = x.location?.file ? `\`${x.location.file}:${x.location.line}\`` : `\`${x.location?.url}\``;
    return `- [ ] **[${x.severity}]** ${x.title} (${loc}${x.cwe ? ", " + x.cwe : ""})\n      - Correctif: ${x.fix?.summary || ""}\n      - Effort: ${x.effort ?? "?"} j-h`;
  };

  const s = rec.summary || {};
  const body = `## Audit Panoptic - correctifs proposes

**Cible:** ${rec.target}
**Sante:** ${rec.score}/100  |  **Findings:** ${f.length}  |  **Effort estime:** ${s.effortDays ?? "?"} j-h  |  **Risque:** ~${eur(s.riskEur)} EUR

### A corriger dans le code (${code.length})
${bySeverity(code).map(line).join("\n") || "_Aucun._"}

### A corriger en production / config (${prod.length})
${bySeverity(prod).map(line).join("\n") || "_Aucun._"}

---
_Genere par Panoptic. Chaque case cochee = un correctif applique. Rapport complet joint._`;

  // Regroupement par fichier: utile pour ouvrir une PR ciblee par module.
  const byFile = {};
  for (const x of code) {
    const file = x.location.file;
    (byFile[file] ||= []).push({ line: x.location.line, severity: x.severity, title: x.title, fix: x.fix?.summary });
  }

  return {
    title: `Panoptic: ${f.length} correctifs securite & qualite (${rec.score}/100)`,
    body,
    files: byFile,
    stats: { total: f.length, code: code.length, prod: prod.length },
  };
}

// Commande opt-in a executer par l'utilisateur (jamais lancee automatiquement).
export function buildPrCommand(bundle, branch = "panoptic/fixes") {
  const bodyEsc = bundle.body.replace(/'/g, "'\\''");
  return `git checkout -b ${branch} && gh pr create --title '${bundle.title.replace(/'/g, "'\\''")}' --body '${bodyEsc}'`;
}
