// Panoptic SEO KING - largeur en PIXELS des titres et descriptions SERP.
//
// Le marche compte en caracteres ("60 caracteres max"). Google tronque en pixels.
// "Illillilli" et "WMWMWMWMWM" font 10 caracteres et pas du tout la meme largeur.
// Consequence reelle: un title "conforme" a 58 caracteres peut etre coupe en plein
// mot-cle, et un title de 65 caracteres peut tenir entierement.
//
// Table de largeurs pour Arial 20px (rendu desktop des titres Google). Mesures
// relatives normalisees; l'important est le rapport entre caracteres, pas la valeur
// absolue au pixel pres. On assume l'approximation et on le dit dans la preuve.

const W20 = {
  " ": 5.6, "!": 5.6, '"': 7.1, "#": 11.1, $: 11.1, "%": 17.8, "&": 13.3, "'": 3.8,
  "(": 6.7, ")": 6.7, "*": 7.8, "+": 11.7, ",": 5.6, "-": 6.7, ".": 5.6, "/": 5.6,
  0: 11.1, 1: 11.1, 2: 11.1, 3: 11.1, 4: 11.1, 5: 11.1, 6: 11.1, 7: 11.1, 8: 11.1, 9: 11.1,
  ":": 5.6, ";": 5.6, "<": 11.7, "=": 11.7, ">": 11.7, "?": 11.1, "@": 20.3,
  A: 13.3, B: 13.3, C: 14.4, D: 14.4, E: 13.3, F: 12.2, G: 15.6, H: 14.4, I: 5.6,
  J: 10.0, K: 13.3, L: 11.1, M: 16.7, N: 14.4, O: 15.6, P: 13.3, Q: 15.6, R: 14.4,
  S: 13.3, T: 12.2, U: 14.4, V: 13.3, W: 18.9, X: 13.3, Y: 13.3, Z: 12.2,
  "[": 5.6, "\\": 5.6, "]": 5.6, "^": 9.4, _: 11.1, "`": 6.7,
  a: 11.1, b: 11.1, c: 10.0, d: 11.1, e: 11.1, f: 5.6, g: 11.1, h: 11.1, i: 4.4,
  j: 4.4, k: 10.0, l: 4.4, m: 16.7, n: 11.1, o: 11.1, p: 11.1, q: 11.1, r: 6.7,
  s: 10.0, t: 5.6, u: 11.1, v: 10.0, w: 14.4, x: 10.0, y: 10.0, z: 10.0,
  "{": 6.7, "|": 5.2, "}": 6.7, "~": 11.7,
};
const DEFAULT_W = 11.1;   // largeur d'un caractere inconnu (accentue, emoji etroit)

// Facteur d'echelle: les descriptions sont rendues plus petites que les titres.
const SCALE = { title: 1, description: 0.7 };

export function pixelWidth(text = "", kind = "title") {
  let w = 0;
  for (const ch of String(text)) {
    // Les caracteres accentues font la largeur de leur base non accentuee.
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    w += W20[base] ?? W20[ch] ?? DEFAULT_W;
  }
  return Math.round(w * (SCALE[kind] ?? 1) * 10) / 10;
}

// Limites observees sur les SERP Google (desktop). Mobile tronque plus tot.
export const LIMITS = {
  title: { desktop: 580, mobile: 545 },
  description: { desktop: 920, mobile: 680 },
};

// Diagnostic complet d'un title/description: tronque ou non, et surtout OU.
export function fit(text = "", kind = "title", device = "desktop") {
  const limit = LIMITS[kind]?.[device] ?? LIMITS.title.desktop;
  const width = pixelWidth(text, kind);
  const truncated = width > limit;
  let visible = text;
  if (truncated) {
    let acc = 0;
    let cut = text.length;
    const scale = SCALE[kind] ?? 1;
    for (let i = 0; i < text.length; i++) {
      const base = text[i].normalize("NFD").replace(/[̀-ͯ]/g, "");
      acc += (W20[base] ?? DEFAULT_W) * scale;
      if (acc > limit) { cut = i; break; }
    }
    visible = text.slice(0, cut).replace(/\s+\S*$/, "");
  }
  return {
    width, limit, device, truncated,
    fillRatio: Math.round((width / limit) * 100),
    visible,
    cutOff: truncated ? text.slice(visible.length).trim() : "",
    // Sous-exploite: on paie un emplacement SERP et on n'utilise pas la place.
    underUsed: width < limit * 0.55,
  };
}
