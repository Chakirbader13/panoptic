// Panoptic - analyse de contraste WCAG 1.4.3 sans navigateur.
// Construit un arbre HTML leger, resout la cascade (selecteurs simples) + l'heritage,
// determine le fond effectif en remontant les ancetres (base = fond du body, sinon blanc:
// fiable car un site sombre pose TOUJOURS un fond explicite), calcule le ratio.
// Biais fort anti-faux-positifs: on ne signale que si les deux couleurs sont resolues.
import { parseColor, flatten, contrastRatio, parseStylesheet, matches } from "../../css.js";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SKIP_TEXT = new Set(["script", "style", "head", "title", "meta", "noscript", "svg", "path", "code", "pre"]);
const WANT = ["color", "background-color", "background", "font-size", "font-weight"];

function attrOf(s, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, "i").exec(s || "");
  return m ? (m[1] ?? m[2]) : null;
}
function parseInline(style) {
  const out = {};
  if (!style) return out;
  for (const d of style.split(";")) {
    const i = d.indexOf(":"); if (i < 0) continue;
    const p = d.slice(0, i).trim().toLowerCase();
    if (WANT.includes(p)) out[p] = d.slice(i + 1).trim();
  }
  return out;
}

function buildTree(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const root = { tag: "#root", id: null, classes: [], style: {}, children: [], parent: null, text: "" };
  let cur = root;
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/)?>/g;
  let last = 0, m;
  while ((m = tagRe.exec(html))) {
    const between = html.slice(last, m.index);
    if (between.trim()) cur.text += " " + between.replace(/\s+/g, " ").trim();
    last = tagRe.lastIndex;
    const [, close, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      let n = cur; while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if (tag === "script" || tag === "style") {
      const closeTag = `</${tag}>`;
      const idx = html.toLowerCase().indexOf(closeTag, last);
      if (idx >= 0) { last = idx + closeTag.length; tagRe.lastIndex = last; }
      continue;
    }
    const el = {
      tag, id: (attrOf(attrs, "id") || "").toLowerCase() || null,
      classes: (attrOf(attrs, "class") || "").toLowerCase().split(/\s+/).filter(Boolean),
      style: parseInline(attrOf(attrs, "style")), children: [], parent: cur, text: "",
    };
    cur.children.push(el);
    if (!VOID.has(tag) && !selfClose) cur = el;
  }
  return root;
}

// Valeur d'une propriete POSEE sur cet element (inline > meilleure regle par specificite).
function ownProp(el, prop, rules) {
  let best = null, spec = -1;
  for (const r of rules) {
    if (r.decls[prop] == null) continue;
    if (r.spec >= spec && matches(r, el)) { best = r.decls[prop]; spec = r.spec; }
  }
  if (el.style[prop] != null) best = el.style[prop];
  return best;
}

// background-color, ou couleur extraite du shorthand `background`.
function ownBg(el, rules) {
  let v = ownProp(el, "background-color", rules);
  let c = v ? parseColor(v) : null;
  if (!c) {
    const bg = ownProp(el, "background", rules);
    if (bg) for (const tok of bg.split(/\s+/)) { const t = parseColor(tok); if (t) { c = t; break; } }
  }
  return c;
}

// Couleur du texte (herite): remonte jusqu'a une valeur; defaut CSS = noir.
function resolveColor(el, rules) {
  let n = el;
  while (n && n.tag !== "#root") {
    const v = ownProp(n, "color", rules);
    if (v) { const c = parseColor(v); return c ? { c, from: n === el ? "self" : "inherited" } : null; }
    n = n.parent;
  }
  return { c: { rgb: [0, 0, 0], alpha: 1 }, from: "default" };
}

// Fond effectif: premier ancetre (ou soi) avec un fond opaque; sinon base (fond body/blanc).
function resolveBg(el, rules, base) {
  let n = el;
  while (n && n.tag !== "#root") {
    const c = ownBg(n, rules);
    if (c && c.alpha >= 0.5) return { rgb: c.alpha >= 1 ? c.rgb : flatten(c, base.rgb), explicit: true };
    n = n.parent;
  }
  return { rgb: base.rgb, explicit: base.explicit };
}

function fontSizePx(el, rules) {
  let n = el;
  while (n && n.tag !== "#root") {
    const v = ownProp(n, "font-size", rules);
    if (v) { const m = /([\d.]+)px/.exec(v); if (m) return parseFloat(m[1]); return 16; }
    n = n.parent;
  }
  return 16;
}
function fontWeight(el, rules) {
  let n = el;
  while (n && n.tag !== "#root") {
    const v = ownProp(n, "font-weight", rules);
    if (v) { if (/bold/.test(v)) return 700; const w = parseInt(v, 10); return Number.isNaN(w) ? 400 : w; }
    n = n.parent;
  }
  return 400;
}

const hex = ([r, g, b]) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Retourne { violations:[...], stats }. cssTexts = tableau de blocs CSS (style + linked).
export function analyzeContrast(html, cssTexts) {
  const rules = cssTexts.flatMap((c) => parseStylesheet(c || ""));
  const root = buildTree(html);

  // Base: fond du body/html si pose explicitement, sinon blanc (fiable).
  let bodyEl = null;
  (function find(n) { for (const ch of n.children) { if (ch.tag === "body") bodyEl = ch; else find(ch); } })(root);
  let base = { rgb: [255, 255, 255], explicit: false };
  for (const el of [bodyEl, root.children.find((c) => c.tag === "html")]) {
    if (!el) continue;
    const c = ownBg(el, rules);
    if (c && c.alpha >= 0.5) { base = { rgb: c.alpha >= 1 ? c.rgb : flatten(c, [255, 255, 255]), explicit: true }; break; }
  }

  const seen = new Map(); // clef couleur -> {count, example}
  let evaluated = 0;

  (function walk(n) {
    if (n.tag !== "#root" && !SKIP_TEXT.has(n.tag)) {
      const txt = n.text.trim();
      if (txt.length >= 3 && /[a-zA-Z0-9]/.test(txt) && evaluated < 4000) {
        evaluated++;
        const fg = resolveColor(n, rules);
        if (fg) {
          const bg = resolveBg(n, rules, base);
          // On exige un fond determine (explicite quelque part OU base blanche fiable non-heritee d'un site sombre).
          const fgRgb = flatten(fg.c, bg.rgb);
          const ratio = contrastRatio(fgRgb, bg.rgb);
          const size = fontSizePx(n, rules), weight = fontWeight(n, rules);
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const threshold = large ? 3 : 4.5;
          if (ratio < threshold && (bg.explicit || fg.from !== "default")) {
            const key = `${hex(fgRgb)}|${hex(bg.rgb)}|${large}`;
            const conf = bg.explicit && fg.from !== "inherited" ? "high" : "medium";
            const rec = seen.get(key) || { fg: hex(fgRgb), bg: hex(bg.rgb), ratio: +ratio.toFixed(2), threshold, large, count: 0, example: null, conf };
            rec.count++;
            if (!rec.example) rec.example = `<${n.tag}${n.classes.length ? " class='" + n.classes.slice(0, 2).join(" ") + "'" : ""}> "${txt.slice(0, 40)}"`;
            seen.set(key, rec);
          }
        }
      }
    }
    for (const ch of n.children) walk(ch);
  })(root);

  const violations = [...seen.values()].sort((a, b) => a.ratio - b.ratio);
  return { violations, stats: { rules: rules.length, evaluated, pairs: violations.length } };
}
