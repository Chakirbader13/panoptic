// Panoptic - moteur CSS leger pour l'analyse de contraste (WCAG 1.4.3), sans navigateur.
// Parse les regles a selecteurs SIMPLES uniquement (tag, .class, #id, compounds sans
// combinateur) pour eviter les faux appariements. Fournit couleurs, luminance, ratio.

// --- Couleurs ---------------------------------------------------------------------
const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105], dimgrey: [105, 105, 105], gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245],
  maroon: [128, 0, 0], navy: [0, 0, 128], teal: [0, 128, 128], olive: [128, 128, 0],
  purple: [128, 0, 128], orange: [255, 165, 0], yellow: [255, 255, 0], lime: [0, 255, 0],
  aqua: [0, 255, 255], cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255],
  slategray: [112, 128, 144], slategrey: [112, 128, 144], lightslategray: [119, 136, 153],
  darkslategray: [47, 79, 79], indigo: [75, 0, 130], coral: [255, 127, 80], tomato: [255, 99, 71],
};

// Retourne {rgb:[r,g,b], alpha} ou null si non resoluble (transparent, currentColor, gradient...).
export function parseColor(input) {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (s === "transparent" || s === "currentcolor" || s === "inherit" || s.includes("gradient") || s.includes("var(")) return null;
  if (NAMED[s]) return { rgb: NAMED[s], alpha: 1 };

  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb: [r, g, b], alpha: a };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (v) => v.includes("%") ? Math.round(parseFloat(v) * 2.55) : parseInt(v, 10);
    const rgb = [chan(parts[0]), chan(parts[1]), chan(parts[2])];
    if (rgb.some((v) => Number.isNaN(v))) return null;
    const alpha = parts[3] != null ? parseFloat(parts[3]) : 1;
    return { rgb, alpha };
  }
  return null; // hsl() et autres: non geres, on prefere ne pas deviner
}

// Compose une couleur (avec alpha) sur un fond opaque.
export function flatten(fg, bgRgb) {
  if (fg.alpha >= 1) return fg.rgb;
  const a = fg.alpha;
  return fg.rgb.map((c, i) => Math.round(c * a + bgRgb[i] * (1 - a)));
}

// Luminance relative WCAG.
export function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// Ratio de contraste WCAG (1 a 21).
export function contrastRatio(rgb1, rgb2) {
  const l1 = luminance(rgb1), l2 = luminance(rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Regles CSS -------------------------------------------------------------------
// Extrait des declarations qui nous interessent depuis un bloc CSS. Selecteurs SIMPLES.
const WANT = new Set(["color", "background-color", "background", "font-size", "font-weight"]);

export function parseStylesheet(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[a-z-]+[^{;]*;/gi, "");
  // On ignore le contenu des at-rules a bloc (media...) en aplatissant naivement leurs regles internes.
  const flat = clean.replace(/@media[^{]*\{/gi, "").replace(/@supports[^{]*\{/gi, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const selectors = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(";")) {
      const idx = d.indexOf(":");
      if (idx < 0) continue;
      const prop = d.slice(0, idx).trim().toLowerCase();
      const val = d.slice(idx + 1).trim();
      if (WANT.has(prop)) decls[prop] = val;
    }
    if (!Object.keys(decls).length) continue;
    for (const sel of selectors) {
      const parsed = parseSimpleSelector(sel);
      if (parsed) rules.push({ ...parsed, decls, spec: specificity(parsed) });
    }
  }
  return rules;
}

// N'accepte qu'un selecteur compose simple: tag?.class*#id? sans combinateur ni pseudo.
function parseSimpleSelector(sel) {
  const s = sel.replace(/::?[a-z-]+(\([^)]*\))?/gi, "").trim(); // retire pseudos
  if (!s || /[\s>+~\[\]*]/.test(s)) return null;                 // pas de combinateur/attribut/universel
  const tag = (s.match(/^[a-z][a-z0-9-]*/i) || [null])[0];
  const classes = [...s.matchAll(/\.([a-z0-9_-]+)/gi)].map((x) => x[1].toLowerCase());
  const id = (s.match(/#([a-z0-9_-]+)/i) || [, null])[1];
  if (!tag && !classes.length && !id) return null;
  return { tag: tag ? tag.toLowerCase() : null, classes, id: id ? id.toLowerCase() : null };
}

function specificity({ id, classes, tag }) {
  return (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0);
}

export function matches(rule, el) {
  if (rule.tag && rule.tag !== el.tag) return false;
  if (rule.id && rule.id !== el.id) return false;
  for (const c of rule.classes) if (!el.classes.includes(c)) return false;
  return true;
}
