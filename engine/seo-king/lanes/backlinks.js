// Panoptic SEO KING - lane liens entrants (conditionnelle, par verification).
//
// Positionnement assume: Panoptic ne DECOUVRE pas de backlinks. Construire un index du
// web est hors de portee, et les approximations d'un index partiel contrediraient la
// promesse centrale du produit. Ce qu'il fait, personne ne le fait bien: il VERIFIE.
//
// L'utilisateur fournit l'export de l'outil qu'il paie deja (ou de la Search Console),
// et le moteur va constater lien par lien ce qui tient encore debout aujourd'hui. Un
// index dit "vous aviez 400 liens le mois dernier"; ici on dit "sur 40 verifies
// aujourd'hui, 6 ont disparu, 4 sont en nofollow, 2 sont sur des pages desindexees".
//
// Ce qui reste STRUCTURELLEMENT hors de portee, et qui est dit dans le rapport: la
// decouverte de liens que l'utilisateur ignore, l'analyse des concurrents, et la
// detection d'attaques de liens recentes.

import { readFileSync, existsSync } from "node:fs";
import { extractLinks } from "../backlinks/parse-csv.js";
import { verifyBacklinks } from "../backlinks/verify.js";

export const id = "backlinks";

export async function run(ctx) {
  const { scope, options = {} } = ctx;
  const out = [];
  const strengths = [];
  const F = (r) => out.push({ dimensions: ["entity"], url: scope.url, ...r });

  const file = options.backlinksFile || scope.backlinksFile || null;
  if (!file) return { findings: out, strengths, skipped: "aucun export de liens entrants fourni (option --backlinks)" };
  if (!existsSync(file)) {
    F({
      rule: "backlinks-file-missing", severity: "info", effort: 0,
      title: "Export de liens entrants introuvable",
      proof: `Chemin fourni: ${file}.`,
      fix: "Fournir un export CSV depuis la Search Console, Ahrefs, Majestic ou tout autre outil: le format est detecte automatiquement.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths, skipped: "fichier introuvable" };
  }

  let parsed;
  try {
    parsed = extractLinks(readFileSync(file, "utf8"), { targetHost: scope.host });
  } catch (e) {
    F({
      rule: "backlinks-unreadable", severity: "info", effort: 0,
      title: "Export de liens illisible",
      proof: String(e.message || e).slice(0, 160),
      fix: "Fournir un CSV valide.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths };
  }

  if (!parsed.links.length) {
    F({
      rule: "backlinks-no-urls", severity: "info", effort: 0,
      title: "Aucun lien exploitable dans l'export fourni",
      proof: `${parsed.rows} ligne(s) lues, aucune colonne d'URL identifiee. Colonnes reconnues: ${Object.keys(parsed.columns).join(", ") || "aucune"}.`,
      fix: "Verifier que l'export contient une colonne d'URL de page referente.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths };
  }

  const res = await verifyBacklinks(parsed.links, {
    targetHost: scope.host,
    cap: options.backlinksCap || 40,
  });
  ctx.backlinks = { ...res, note: parsed.note, columns: parsed.columns };

  const c = res.counts;
  const s = res.sample;
  const base = `${s.checked} lien(s) verifie(s) en direct sur ${s.declared} declare(s)${s.capped ? " (echantillon plafonne)" : ""}`
    + (parsed.note ? `. ${parsed.note}` : "");

  // --- Liens disparus ---------------------------------------------------------------
  if (c.lost || c.sourceGone) {
    const gone = res.results.filter((r) => r.state === "lost" || r.state === "source-gone");
    F({
      rule: "backlinks-lost", severity: c.lost + c.sourceGone > s.checked * 0.25 ? "high" : "medium", effort: 0.6,
      title: `${c.lost + c.sourceGone} lien(s) entrant(s) declare(s) n'existent plus`,
      proof: `${base}. ${c.lost} page(s) source ne contiennent plus de lien vers le domaine, ${c.sourceGone} page(s) source ont disparu. Exemples: ${gone.slice(0, 4).map((g) => `${short(g.source)} (${g.reason})`).join(", ")}.`,
      fix: "Contacter les sites concernes ou remplacer ces liens. Un profil de liens declare mais perime surestime l'autorite reelle du domaine.",
      verifiability: "cross-checked",
    });
  }

  // --- Liens sans transmission d'autorite ---------------------------------------------
  if (c.nofollow) {
    const nf = res.results.filter((r) => r.state === "verified" && r.nofollow);
    F({
      rule: "backlinks-nofollow", severity: "low", effort: 0.3,
      title: `${c.nofollow} lien(s) verifie(s) sur ${c.verified} sont en nofollow`,
      proof: `${base}. Exemples: ${nf.slice(0, 4).map((r) => `${short(r.source)} (rel="${r.rel}")`).join(", ")}. Ces liens amenent du trafic mais ne transmettent pas d'autorite.`,
      fix: "A savoir pour ponderer le profil: ce n'est pas un defaut a corriger, c'est une realite a integrer dans l'evaluation.",
      verifiability: "cross-checked",
    });
  }

  // --- Liens depuis des pages desindexees ------------------------------------------------
  if (c.sourceNoindex) {
    const ni = res.results.filter((r) => r.sourceNoindex);
    F({
      rule: "backlinks-from-noindex", severity: "medium", effort: 0.3,
      title: `${c.sourceNoindex} lien(s) proviennent de pages en noindex`,
      proof: `${base}. Exemples: ${ni.slice(0, 3).map((r) => short(r.source)).join(", ")}. Une page que le moteur n'indexe pas ne transmet pratiquement rien.`,
      fix: "Ne pas compter ces liens dans l'evaluation du profil.",
      verifiability: "cross-checked",
    });
  }

  // --- Ce qu'on n'a PAS pu verifier ---------------------------------------------------------
  // Un pare-feu qui bloque notre crawler ne dit RIEN sur le lien. Le compter comme
  // perdu produirait des faux negatifs sur les sites les mieux proteges, donc souvent
  // les plus interessants.
  if (c.unverifiable) {
    const un = res.results.filter((r) => r.state === "unverifiable");
    F({
      rule: "backlinks-unverifiable", severity: "info", effort: 0,
      title: `${c.unverifiable} lien(s) n'ont pas pu etre verifies`,
      proof: `${base}. Causes: ${[...new Set(un.map((r) => r.reason))].slice(0, 3).join(", ")}. Ces liens ne sont comptes ni comme valides ni comme perdus: un pare-feu qui nous bloque ne dit rien sur l'existence du lien.`,
      fix: "Verification manuelle si ces sources comptent dans votre strategie.",
      verifiability: "inconclusive",
    });
  }

  if (c.dofollow) {
    strengths.push(`${c.dofollow} lien(s) entrant(s) verifies en direct aujourd'hui, transmettant de l'autorite`);
  }

  // --- Perimetre: ce que cette lane ne peut pas faire -----------------------------------------
  F({
    rule: "backlinks-discovery-out-of-scope", severity: "info", effort: 0,
    title: "Liens non declares, concurrents et attaques de liens: hors perimetre",
    proof: "Cette lane VERIFIE les liens fournis, elle n'en decouvre pas. Decouvrir des liens inconnus, analyser le profil d'un concurrent ou reperer une attaque de liens recente demande un index du web, que cet audit n'a pas.",
    fix: "Fournir un export plus complet (Search Console, ou un index de liens payant) pour elargir le perimetre de verification.",
    verifiability: "inconclusive",
  });

  return { findings: out, strengths };
}

function short(u) {
  try { const x = new URL(u); return x.host + (x.pathname === "/" ? "" : x.pathname.slice(0, 30)); } catch { return String(u).slice(0, 40); }
}
