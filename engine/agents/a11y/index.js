// Panoptic - Agent Accessibilite (WCAG). Scanner navigateur axe-core (moteur WCAG reel)
// si un Chromium est disponible (serveur Render); sinon repli heuristique HTML + contraste CSS.
import { makeFinding, elements, attr, tagAll, countTag, httpGet } from "../shared.js";
import { analyzeContrast } from "./contrast.js";
import { runAxe, browserAllowed } from "../../scanners/browser.js";

export async function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("a11y", "humain", { ...r, url }));

  // Scanner REEL axe-core (rendu Chromium) quand disponible: supplante les heuristiques
  // ci-dessous (couverture WCAG complete, moins de faux positifs/negatifs). Repli propre
  // sur les heuristiques si aucun navigateur (ex. fonction serverless).
  if (browserAllowed(scope)) {
    const ax = await runAxe(url).catch(() => ({ available: false, findings: [] }));
    if (ax.available && !ax.error) {
      for (const a of ax.findings) F(a);
      return { findings, stats: { source: "axe-core", violations: ax.findings.length } };
    }
  }

  // Langue du document (WCAG 3.1.1)
  if (!/<html[^>]*\blang\s*=/i.test(html)) F({ rule: "no-lang", severity: "medium", effort: 0.1, cwe: "WCAG-3.1.1", title: "Attribut lang absent sur <html>", fix: "Ajouter lang='fr' (ou la langue reelle) sur la balise html.", proof: "Pas de lang sur <html>." });

  // Images sans alt (WCAG 1.1.1)
  const imgs = elements(html, "img");
  const noAlt = imgs.filter((i) => attr(i, "alt") === null);
  if (noAlt.length) F({ rule: "img-no-alt", severity: "high", effort: 0.3, cwe: "WCAG-1.1.1", title: `${noAlt.length}/${imgs.length} images sans alternative textuelle`, fix: "Ajouter alt descriptif (ou alt='' si decoratif).", proof: `${noAlt.length} img sans alt.` });

  // Champs de formulaire sans label (WCAG 1.3.1 / 4.1.2)
  // Un input est considere etiquete s'il porte aria-label/aria-labelledby/title/id/
  // placeholder OU s'il est ENVELOPPE dans un <label> (cas frequent, ex. honeypots).
  const labelBlocks = (html.match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) || []).join("\n");
  const inputs = elements(html, "input").filter((i) => !/type=["'](hidden|submit|button|image)["']/i.test(i));
  const unlabeled = inputs.filter((i) =>
    attr(i, "aria-label") === null && attr(i, "aria-labelledby") === null && attr(i, "title") === null &&
    attr(i, "id") === null && attr(i, "placeholder") === null && !labelBlocks.includes(i));
  if (unlabeled.length) F({ rule: "input-no-label", severity: "high", effort: 0.4, cwe: "WCAG-1.3.1", title: `${unlabeled.length} champ(s) de formulaire sans label`, fix: "Associer chaque input a un <label for> ou aria-label.", proof: `${unlabeled.length} input sans label.` });

  // Ordre des titres (WCAG 1.3.1): h1 present avant h2
  if (countTag(html, "h1") === 0 && countTag(html, "h2") > 0) F({ rule: "heading-order", severity: "medium", effort: 0.2, cwe: "WCAG-1.3.1", title: "Hierarchie de titres cassee (h2 sans h1)", fix: "Commencer par un h1 unique puis descendre sans saut.", proof: "h2 present sans h1." });

  // Liens sans intitule (WCAG 2.4.4)
  const links = tagAll(html, "a");
  const empty = links.filter((t) => t.replace(/<[^>]+>/g, "").trim() === "").length;
  if (empty) F({ rule: "empty-link", severity: "medium", effort: 0.3, cwe: "WCAG-2.4.4", title: `${empty} lien(s) sans intitule textuel`, fix: "Fournir un texte de lien explicite ou aria-label.", proof: `${empty} liens vides.` });

  // Boutons icone sans nom accessible
  const btns = elements(html, "button");
  const iconBtns = btns.filter((b) => attr(b, "aria-label") === null).length;
  // heuristique douce: signale seulement si beaucoup de boutons
  if (btns.length > 0 && iconBtns === btns.length && btns.length >= 3) F({ rule: "button-no-aria", severity: "low", effort: 0.3, cwe: "WCAG-4.1.2", title: "Boutons potentiellement sans nom accessible", fix: "Verifier que chaque bouton a un texte ou aria-label.", proof: `${btns.length} boutons.` });

  // Viewport avec zoom desactive (WCAG 1.4.4)
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b/i.test(html)) F({ rule: "no-zoom", severity: "medium", effort: 0.1, cwe: "WCAG-1.4.4", title: "Zoom desactive dans le viewport", fix: "Retirer user-scalable=no et maximum-scale=1.", proof: "Zoom bloque." });

  // tabindex positif (anti-pattern)
  if (/tabindex\s*=\s*["']?[1-9]/i.test(html)) F({ rule: "positive-tabindex", severity: "low", effort: 0.3, cwe: "WCAG-2.4.3", title: "tabindex positif (ordre de focus casse)", fix: "Utiliser tabindex=0 ou l'ordre naturel du DOM.", proof: "tabindex positif detecte." });

  // --- Contraste CSS reel (WCAG 1.4.3) ---
  const contrast = await runContrast(scope, html);
  for (const v of contrast.violations.slice(0, 8)) {
    const kind = v.large ? "grand texte (seuil 3:1)" : "texte normal (seuil 4.5:1)";
    F({
      rule: "low-contrast", severity: v.conf === "high" ? "high" : "medium", effort: 0.2, cwe: "WCAG-1.4.3",
      title: `Contraste insuffisant ${v.ratio}:1 (${kind})`,
      fix: `Assombrir ${v.fg} ou eclaircir le fond ${v.bg} pour atteindre ${v.threshold}:1.`,
      proof: `${v.fg} sur ${v.bg}, ${v.count} occurrence(s). Ex: ${v.example}`,
      impact: "Texte illisible pour malvoyants; non-conformite EAA 2025",
      check: v.conf === "high"
        ? { verdict: "confirmed", votes: 3, refuters: 0, reason: "Couleurs resolues explicitement via la cascade." }
        : { verdict: "plausible", votes: 2, refuters: 1, reason: "Fond/texte partiellement herite: a confirmer au rendu." },
    });
  }

  return { findings, stats: { source: "heuristic", imgs: imgs.length, inputs: inputs.length, links: links.length, contrast: contrast.stats, checks: 9 } };
}

// Recupere le CSS (blocs <style> + feuilles liees) et analyse le contraste.
async function runContrast(scope, html) {
  const styleBlocks = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).map((b) => b.replace(/<\/?style[^>]*>/gi, ""));
  const hrefs = [];
  for (const l of elements(html, "link")) {
    if (/rel\s*=\s*["']stylesheet["']/i.test(l)) { const h = attr(l, "href"); if (h) hrefs.push(h); }
  }
  const linked = [];
  for (const h of hrefs.slice(0, 6)) {
    let abs; try { abs = new URL(h, scope.url).href; } catch { continue; }
    if (new URL(abs).origin !== scope.origin) continue; // meme origine seulement
    const r = await httpGet(abs, { timeout: 6000 });
    if (!r.error && r.body) linked.push(r.body);
  }
  return analyzeContrast(html, [...styleBlocks, ...linked]);
}
