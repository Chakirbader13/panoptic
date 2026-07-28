// Panoptic SEO KING - lane internationale (hreflang et parite de locales).
//
// hreflang est la zone ou les outils du marche se contentent de verifier la
// PRESENCE des balises. Or Google ignore le cluster ENTIER des qu'un seul lien
// n'est pas reciproque. On va donc chercher la page cible et on lit ce qu'elle
// declare en retour. C'est la seule verification qui vaut quelque chose.

import { detectLang } from "../text.js";

export const id = "hreflang";

// Codes ISO 639-1 courants + regions ISO 3166-1. Un code invalide fait ignorer la ligne.
const LANGS = new Set("aa ab af ak am ar as av ae ay az ba bm be bn bi bo bs br bg ca cs ch ce cu cv kw co cr cy da de dv dz el en eo et eu ee fo fa fj fi fr fy ff gd ga gl gv gn gu ht ha he hz hi ho hr hu hy ig io ii iu ie ia id ik is it jv ja kl kn ks ka kr kk km ki rw ky kv kg ko kj ku lo la lv li ln lt lb lu lg mh ml mr mk mg mt mn mi ms my na nv nr nd ng ne nl nn nb no ny oc oj or om os pa pi pl pt ps qu rm ro rn ru sg sa si sk sl se sm sn sd so st es sq sc sr ss su sw sv ty ta tt te tg tl th ti to tn ts tk tr tw ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" "));

function dedupeAlternates(list) {
  const seen = new Map();
  for (const a of list) {
    const key = `${a.hreflang}|${a.href}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

export function run(ctx) {
  const { scope, deep, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["architecture"], url: scope.url, ...r });

  // Un site est multilingue si des URL suivent un prefixe de langue, ou si des
  // alternates sont declares. On ne reproche jamais l'absence de hreflang a un site
  // monolingue.
  const LANG_PREFIX = /^\/([a-z]{2})(?:-[a-z]{2})?(?:\/|$)/i;
  const localePages = new Map();
  for (const n of graph.list()) {
    const m = LANG_PREFIX.exec(n.path || "");
    if (m && LANGS.has(m[1].toLowerCase())) {
      const k = m[1].toLowerCase();
      if (!localePages.has(k)) localePages.set(k, []);
      localePages.get(k).push(n);
    }
  }
  const home = graph.get(scope.url);
  // Dedoublonnage: un meme alternate peut etre declare a la fois dans le HTML et
  // dans le sitemap. Le compter deux fois fausserait tous les constats en aval.
  const declared = dedupeAlternates(home?.alternates || []);
  const multilingual = localePages.size > 0 || declared.length > 0;

  if (!multilingual) {
    return { findings: out, strengths, skipped: "site monolingue: aucun prefixe de langue ni alternate declare" };
  }

  // Sur un domaine alias, le cluster hreflang vit legitimement sur le domaine
  // canonique: les alternates pointent ailleurs et ne pointent pas en retour ici,
  // et c'est exactement ce qu'il faut faire. Verifier la reciprocite depuis l'alias
  // produirait deux faux positifs graves. On note ou il faut regarder, et on sort.
  if (ctx.alias) {
    F({
      rule: "hreflang-on-alias-domain", severity: "info", effort: 0,
      title: `Cluster hreflang porte par ${ctx.alias.canonicalOrigin}, pas par ce domaine`,
      proof: `${declared.length} alternate(s) declares depuis ce domaine alias, tous vers ${ctx.alias.canonicalOrigin}. La reciprocite doit se verifier entre les locales du domaine canonique, pas depuis l'alias.`,
      fix: `Relancer l'audit sur ${ctx.alias.canonicalOrigin} pour valider la reciprocite hreflang du cluster reel.`,
      verifiability: "cross-checked",
    });
    return { findings: out, strengths, skipped: `domaine alias de ${ctx.alias.canonicalOrigin}` };
  }

  if (!declared.length) {
    F({
      rule: "missing-hreflang", severity: "high", effort: 0.4,
      title: `Site multilingue (${localePages.size} locales) sans aucune balise hreflang`,
      proof: `Locales detectees par l'URL: ${[...localePages.keys()].join(", ")} (${[...localePages.values()].reduce((s, l) => s + l.length, 0)} pages). Aucun <link rel="alternate" hreflang> sur l'accueil. Google traite alors chaque version comme du contenu duplique concurrent.`,
      fix: "Declarer, sur chaque page, un alternate par locale plus un x-default, avec des URL absolues.",
      verifiability: "cross-checked",
    });
    return { findings: out, strengths };
  }

  // --- Validite des codes -------------------------------------------------------------
  const bad = declared.filter((a) => {
    const v = (a.hreflang || "").toLowerCase();
    if (v === "x-default") return false;
    const [lang, region] = v.split("-");
    return !LANGS.has(lang) || (region && !/^[a-z]{2}$/i.test(region));
  });
  if (bad.length) {
    F({
      rule: "hreflang-invalid-code", severity: "high", effort: 0.2,
      title: `${bad.length} code(s) hreflang invalide(s)`,
      proof: bad.slice(0, 5).map((a) => `hreflang="${a.hreflang}" -> ${short(a.href)}`).join(", ") + ". Un code non conforme ISO 639-1 / 3166-1 fait ignorer la ligne entiere.",
      fix: 'Utiliser la forme langue ou langue-REGION: "fr", "fr-BE", "en-US". Le code region est un PAYS, pas une langue.',
      verifiability: "self-evident",
    });
  }

  // --- x-default -----------------------------------------------------------------------
  if (!declared.some((a) => a.hreflang === "x-default")) {
    F({
      rule: "hreflang-no-xdefault", severity: "low", effort: 0.1,
      title: "Aucun hreflang x-default declare",
      proof: `${declared.length} alternates declares (${[...new Set(declared.map((a) => a.hreflang))].join(", ")}), aucun x-default. Les visiteurs dont la langue n'est pas couverte n'ont pas de version designee.`,
      fix: 'Ajouter <link rel="alternate" hreflang="x-default" href="..."> vers la version par defaut.',
      verifiability: "self-evident",
    });
  } else strengths.push("x-default declare");

  // --- Auto-reference --------------------------------------------------------------------
  const selfRef = declared.some((a) => { try { return new URL(a.href).href.replace(/\/$/, "") === scope.url.replace(/\/$/, ""); } catch { return false; } });
  if (!selfRef) {
    F({
      rule: "hreflang-no-self-reference", severity: "medium", effort: 0.2,
      title: "La page ne se declare pas elle-meme dans ses alternates",
      proof: `Alternates: ${declared.map((a) => a.hreflang).join(", ")}. Aucun ne pointe vers ${scope.url}. L'auto-reference est requise: sans elle le cluster est incomplet.`,
      fix: "Chaque page doit inclure sa propre URL dans la liste des alternates, avec sa propre langue.",
      verifiability: "self-evident",
    });
  } else strengths.push("Auto-reference hreflang presente");

  // --- URL relatives ----------------------------------------------------------------------
  const relative = declared.filter((a) => a.href && !/^https?:\/\//i.test(a.href));
  if (relative.length) {
    F({
      rule: "hreflang-relative-url", severity: "medium", effort: 0.1,
      title: `${relative.length} alternate(s) hreflang en URL relative`,
      proof: relative.slice(0, 4).map((a) => `${a.hreflang}: "${a.href}"`).join(", ") + ". La specification impose des URL absolues; les URL relatives sont ignorees.",
      fix: "Passer chaque href en URL absolue avec le protocole et le domaine.",
      verifiability: "self-evident",
    });
  }

  // --- Reciprocite: LA verification qui compte ---------------------------------------------
  const checks = (deep?.hreflangChecks || []).filter((c) => c.state === "observed");
  const notChecked = (deep?.hreflangChecks || []).filter((c) => c.state !== "observed");
  const nonReciprocal = [];
  const brokenAlt = [];
  for (const c of checks) {
    if (c.status >= 400 || c.status === 0) { brokenAlt.push(c); continue; }
    const pointsBack = (c.backHrefs || []).some((b) => {
      try { return new URL(b.href, c.url).href.replace(/\/$/, "") === scope.url.replace(/\/$/, ""); } catch { return false; }
    });
    if (!pointsBack) nonReciprocal.push(c);
  }

  if (brokenAlt.length) {
    F({
      rule: "hreflang-broken-target", severity: "high", effort: 0.3,
      title: `${brokenAlt.length} alternate(s) hreflang pointent vers une page morte`,
      proof: brokenAlt.slice(0, 4).map((c) => `${c.hreflang} -> ${short(c.href)} (${c.error ? "injoignable" : c.status})`).join(", "),
      fix: "Corriger l'URL cible ou retirer l'alternate.",
      verifiability: "cross-checked",
    });
  }
  if (nonReciprocal.length) {
    F({
      rule: "hreflang-not-reciprocal", severity: "high", effort: 0.3,
      title: `${nonReciprocal.length} alternate(s) hreflang sans lien retour`,
      proof: nonReciprocal.slice(0, 5).map((c) => `${short(c.href)} declare ${c.alternateCount} alternate(s) mais aucun ne pointe vers ${short(scope.url)}`).join(" | ") + ". Google exige la reciprocite et ignore le cluster entier quand elle manque.",
      fix: "Publier la meme liste complete d'alternates sur CHAQUE version linguistique, y compris l'auto-reference.",
      verifiability: "cross-checked",
    });
  } else if (checks.length) {
    strengths.push(`Reciprocite hreflang verifiee sur ${checks.length} version(s) linguistique(s)`);
  }
  if (notChecked.length && !checks.length) {
    F({
      rule: "hreflang-unverified", severity: "info", effort: 0,
      title: "Reciprocite hreflang non verifiee (budget de requetes epuise)",
      proof: `${notChecked.length} alternate(s) declares n'ont pas pu etre recuperes: ${notChecked[0]?.reason || "budget"}.`,
      fix: "Relancer l'audit avec un budget de pages superieur pour verifier la reciprocite.",
      verifiability: "inconclusive",
    });
  }

  // --- Langue reelle contre langue declaree ------------------------------------------------
  // Piege classique: la page /de/ existe, l'URL est allemande, le hreflang est allemand,
  // et le contenu est reste en francais parce que la traduction n'a jamais ete faite.
  for (const [locale, nodes] of localePages) {
    const withText = nodes.find((n) => n.text && n.text.length > 400);
    if (!withText) continue;
    const det = detectLang(withText.text);
    if (det.lang && det.lang !== locale && det.confidence > 0.04) {
      F({
        rule: "locale-content-mismatch", severity: "high", effort: 0.8,
        title: `La version /${locale}/ sert du contenu en "${det.lang}"`,
        url: withText.url,
        proof: `${short(withText.url)}: detection par mots vides -> ${det.lang} (${Math.round(det.ratio * 100)}% des tokens), attendu ${locale}. Ecart avec la 2e langue: ${det.confidence}.`,
        fix: `Traduire reellement le contenu de la locale ${locale}, ou retirer cette version tant qu'elle n'est pas traduite.`,
        verifiability: "cross-checked",
        dimensions: ["architecture", "content"],
      });
    }
  }

  // --- Parite de locales --------------------------------------------------------------------
  if (localePages.size > 1) {
    const counts = [...localePages.entries()].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
    const [topLocale, topCount] = counts[0];
    const thin = counts.filter(([, c]) => c < topCount / 2);
    if (thin.length) {
      F({
        rule: "locale-parity-gap", severity: "medium", effort: 1,
        title: `Parite de locales desequilibree: ${thin.map(([k]) => k).join(", ")} nettement plus pauvre(s)`,
        proof: counts.map(([k, c]) => `${k}: ${c} page(s)`).join(", ") + `. La locale ${topLocale} sert de reference.`,
        fix: "Completer les locales incompletes, ou retirer leur declaration hreflang tant que le contenu n'existe pas.",
        verifiability: "sampled",
      });
    } else strengths.push(`Parite de locales homogene (${counts.map(([k, c]) => `${k}:${c}`).join(", ")})`);
  }

  return { findings: out, strengths };
}
