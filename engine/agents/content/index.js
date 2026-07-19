// Panoptic - Agent Contenu / editorial / i18n. Prod (langue, fraicheur) + code (cles i18n cassees).
import { makeFinding, visibleText, elements, attr } from "../shared.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export function run(scope) {
  const findings = [];
  const out = [];

  if (scope.reachable) {
    const url = scope.url;
    const html = scope.home.body;
    const F = (r) => findings.push(makeFinding("content", "humain", { ...r, url }));
    const text = visibleText(html);

    // Cles i18n non resolues rendues telles quelles
    const rawKeys = text.match(/\b[a-z][a-z0-9]*(?:[._][a-z0-9]+){1,}\b/gi) || [];
    const suspicious = rawKeys.filter((k) => /\.(title|label|description|cta|button|heading|subtitle)$/i.test(k));
    if (suspicious.length) F({ rule: "unresolved-i18n", severity: "high", effort: 0.3, title: `Cle(s) de traduction non resolue(s) affichee(s): ${suspicious.slice(0, 3).join(", ")}`, fix: "Corriger le chargement des traductions; ne jamais afficher la cle brute.", proof: suspicious.slice(0, 5).join(", ") });

    // Fraicheur: annee ancienne dans le copyright
    const years = (text.match(/(?:©|copyright|\bcopy\b)[^0-9]{0,10}(20\d{2})/i) || [])[1];
    if (years && Number(years) < 2025) F({ rule: "stale-copyright", severity: "low", effort: 0.1, title: `Copyright date de ${years}`, fix: "Mettre a jour l'annee (automatiser via le build).", proof: `© ${years}` });

    // Langue declaree vs contenu (heuristique legere)
    const langAttr = (html.match(/<html[^>]*\blang\s*=\s*["']([a-z-]+)["']/i) || [])[1];
    if (langAttr && /^fr/i.test(langAttr)) {
      const enWords = (text.match(/\b(the|and|your|for|with|from|about|price|features)\b/gi) || []).length;
      const frWords = (text.match(/\b(le|la|les|des|vous|pour|avec|votre|prix)\b/gi) || []).length;
      if (enWords > 8 && enWords > frWords) F({ rule: "lang-mismatch", severity: "medium", effort: 0.4, title: "Langue declaree (fr) mais contenu majoritairement en anglais", fix: "Aligner lang= avec la langue reelle, ou traduire le contenu.", proof: `${enWords} mots EN vs ${frWords} FR.` });
    }
    out.push(`prod: ${text.length} car.`);
  }

  // Code: coherence des fichiers de traduction (cles manquantes entre langues)
  if (scope.repoPath) {
    const dicts = findLocaleFiles(scope.repoPath);
    if (dicts.length >= 2) {
      const keySets = dicts.map((d) => ({ file: d.file, keys: new Set(Object.keys(flatten(d.data))) }));
      const all = new Set(keySets.flatMap((k) => [...k.keys]));
      for (const ks of keySets) {
        const missing = [...all].filter((k) => !ks.keys.has(k));
        if (missing.length) findings.push(makeFinding("content", "humain", { rule: "i18n-missing-keys", file: ks.file, line: 1, evidenceType: "code", severity: "medium", effort: 0.3, title: `${missing.length} cle(s) de traduction manquante(s) dans ${ks.file}`, fix: "Completer les traductions manquantes pour eviter des trous d'affichage.", proof: missing.slice(0, 5).join(", ") }));
      }
    }
    out.push(`code: ${dicts.length} fichiers de locale`);
  }

  return { findings, stats: { notes: out } };
}

function findLocaleFiles(root) {
  const found = [];
  const rx = /(?:^|[\/])(en|fr|de|es|it|nl|pt|locales?|i18n|lang|translations?)[\/.]/i;
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", ".git", "dist", "build"].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (extname(e.name) === ".json" && rx.test(full)) {
        try {
          if (statSync(full).size > 500_000) continue;
          const data = JSON.parse(readFileSync(full, "utf8"));
          if (data && typeof data === "object") found.push({ file: full.slice(root.length + 1), data });
        } catch { /* ignore */ }
      }
    }
  };
  walk(root, 0);
  return found.slice(0, 12);
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = true;
  }
  return out;
}
