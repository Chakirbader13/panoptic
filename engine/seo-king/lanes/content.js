// Panoptic SEO KING - lane contenu et E-E-A-T.
//
// Perimetre volontairement restreint pour ne pas doubler l'agent "contenu" de
// Panoptic (orthographe, ton, i18n) ni l'agent CRO (proposition de valeur, CTA).
// Ici: les signaux d'EXPERIENCE, EXPERTISE, AUTORITE et CONFIANCE, plus la
// substance reelle des pages. C'est ce que Google evalue depuis les mises a jour
// "helpful content", et ce qu'un moteur de reponse regarde avant de citer.

import { wordsOf, freshnessSignals, detectLang } from "../text.js";

export const id = "content";

// Pages de confiance attendues sur un site professionnel. Leur absence est un
// signal negatif direct, et en France certaines sont une obligation legale.
const TRUST_PAGES = [
  { key: "contact", re: /(contact|nous-ecrire|nous-contacter)/i, label: "contact" },
  { key: "about", re: /(a-propos|about|qui-sommes-nous|equipe|team|notre-histoire)/i, label: "a propos / equipe" },
  { key: "legal", re: /(mentions-legales|legal|impressum|conditions|cgv|cgu|terms)/i, label: "mentions legales / conditions" },
  { key: "privacy", re: /(confidentialite|privacy|donnees-personnelles|rgpd|gdpr)/i, label: "confidentialite" },
];

export function run(ctx) {
  const { scope, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["content"], url: scope.url, ...r });

  const pages = graph.crawledPages().filter((p) => !p.noindex);
  if (!pages.length) return { findings: out, strengths, skipped: "aucune page indexable analysable" };

  // --- Pages de confiance ---------------------------------------------------------------
  // On cherche dans les URL connues ET dans les liens sortants de l'accueil: une page
  // de contact non crawlee mais liee compte tout autant.
  const home = graph.get(scope.url);
  const knownPaths = [...graph.list().map((n) => n.path || ""), ...(home?.outLinks || []).map((e) => e.to.replace(origin, ""))];
  const linkText = (home?.allLinks || []).map((l) => `${l.href} ${l.effectiveAnchor}`).join(" ");
  const missingTrust = TRUST_PAGES.filter((t) => !knownPaths.some((p) => t.re.test(p)) && !t.re.test(linkText));
  if (missingTrust.length) {
    const legal = missingTrust.some((t) => t.key === "legal" || t.key === "privacy");
    F({
      rule: "missing-trust-pages", severity: legal ? "medium" : "low", effort: 0.4,
      title: `Page(s) de confiance introuvable(s): ${missingTrust.map((t) => t.label).join(", ")}`,
      proof: `Ni dans les URL analysees ni dans les liens de l'accueil. Ces pages sont le premier endroit ou un evaluateur, humain ou algorithmique, verifie a qui il a affaire.`,
      fix: "Publier ces pages et les lier depuis le pied de page.",
      verifiability: "cross-checked",
      dimensions: ["content", "entity"],
    });
  } else strengths.push("Pages de confiance presentes (contact, a propos, mentions, confidentialite)");

  // --- Signaux d'auteur -------------------------------------------------------------------
  const substantial = pages.filter((p) => wordsOf(p.text || "").length > 600);
  if (substantial.length) {
    const withAuthor = substantial.filter((p) => hasAuthorSignal(p));
    if (withAuthor.length === 0) {
      F({
        rule: "no-authorship", severity: "medium", effort: 0.5,
        title: `${substantial.length} page(s) de fond sans auteur identifie`,
        url: substantial[0].url,
        proof: substantial.slice(0, 4).map((p) => `${short(p.url)} (${wordsOf(p.text).length} mots)`).join(", ") + ". Aucun nom d'auteur, rel=author, schema Person ni bloc de signature. L'expertise n'est attribuee a personne.",
        fix: "Signer les contenus de fond: nom, fonction, et un lien vers une page de presentation. Declarer author en JSON-LD.",
        verifiability: "cross-checked",
        dimensions: ["content", "entity"],
      });
    } else if (withAuthor.length < substantial.length) {
      F({
        rule: "partial-authorship", severity: "low", effort: 0.3,
        title: `${substantial.length - withAuthor.length} page(s) de fond sur ${substantial.length} sans auteur`,
        proof: substantial.filter((p) => !hasAuthorSignal(p)).slice(0, 4).map((p) => short(p.url)).join(", "),
        fix: "Appliquer la signature d'auteur a tous les contenus de fond, pas seulement au blog.",
        verifiability: "cross-checked",
      });
    } else strengths.push(`Les ${withAuthor.length} contenus de fond portent une signature d'auteur`);
  }

  // --- Dates ------------------------------------------------------------------------------
  if (substantial.length) {
    const undated = substantial.filter((p) => !freshnessSignals(p.html || "", p.text || "").hasAny);
    if (undated.length) {
      F({
        rule: "content-undated", severity: "low", effort: 0.3,
        title: `${undated.length} page(s) de fond sans date visible`,
        proof: undated.slice(0, 4).map((p) => short(p.url)).join(", ") + ". Sans date, impossible de juger si l'information est encore valable: les moteurs de reponse ecartent les sources non datees quand la question est sensible au temps.",
        fix: "Afficher la date de publication et, si le contenu evolue, la date de derniere mise a jour, avec <time datetime>.",
        verifiability: "cross-checked",
        dimensions: ["content", "geo"],
      });
    }
  }

  // --- Sources citees ------------------------------------------------------------------------
  const citing = substantial.filter((p) => (p.externalLinks || []).filter((l) => !/^(mailto|tel)/i.test(l.href)).length >= 2);
  if (substantial.length >= 2 && citing.length === 0) {
    F({
      rule: "no-external-citations", severity: "low", effort: 0.4,
      title: "Aucun contenu de fond ne cite de source externe",
      proof: `${substantial.length} page(s) de plus de 600 mots, aucune ne renvoie vers au moins deux sources externes. Une affirmation sans source est invérifiable, donc peu reprise.`,
      fix: "Sourcer les affirmations factuelles vers l'etude, la documentation officielle ou le texte de loi cite.",
      verifiability: "cross-checked",
      dimensions: ["content", "geo"],
    });
  } else if (citing.length) strengths.push(`${citing.length} contenu(s) de fond citent des sources externes`);

  // --- Contenu mince -------------------------------------------------------------------------
  // Une page utilitaire courte est normale. Une page DECLAREE indexable et pauvre ne l'est pas.
  const thin = pages.filter((p) => {
    const w = wordsOf(p.text || "").length;
    return w > 0 && w < 150 && p.inSitemap;
  });
  if (thin.length) {
    F({
      rule: "thin-indexable-content", severity: "medium", effort: 0.6,
      title: `${thin.length} page(s) declarees au sitemap avec moins de 150 mots`,
      url: thin[0].url,
      proof: thin.slice(0, 5).map((p) => `${short(p.url)} (${wordsOf(p.text).length} mots)`).join(", ") + ". Le sitemap les presente comme importantes, leur contenu ne le justifie pas.",
      fix: "Etoffer ces pages, les fusionner avec une page proche, ou les retirer du sitemap si elles sont utilitaires.",
      verifiability: "cross-checked",
    });
  }

  // --- Promesses non etayees --------------------------------------------------------------------
  // Un superlatif sans chiffre ni source est le signal type d'un contenu non fiable.
  const claimRe = /\b(le meilleur|la meilleure|numero 1|n°1|leader (?:du|de la|mondial|europeen|francais)|the best|#1|leading)\b/i;
  const claiming = pages.filter((p) => claimRe.test(p.text || ""));
  const unbacked = claiming.filter((p) => !/\b\d[\d\s.,]*\s*(%|clients?|utilisateurs?|entreprises?|ans|projets?|avis)\b/i.test(p.text || ""));
  if (unbacked.length) {
    F({
      rule: "unbacked-superlatives", severity: "low", effort: 0.3,
      title: `${unbacked.length} page(s) revendiquent une position dominante sans aucun chiffre`,
      url: unbacked[0].url,
      proof: unbacked.slice(0, 3).map((p) => `${short(p.url)}: "${(claimRe.exec(p.text) || [""])[0]}"`).join(" | ") + ". Aucune donnee chiffree dans la page pour l'etayer.",
      fix: "Remplacer le superlatif par une preuve verifiable (nombre de clients, anciennete, resultat mesure), ou le retirer.",
      verifiability: "self-evident",
      dimensions: ["content", "geo"],
    });
  }

  return { findings: out, strengths };
}

function hasAuthorSignal(page) {
  const html = page.html || "";
  if (/rel\s*=\s*["']author["']/i.test(html)) return true;
  if (/"author"\s*:/i.test(html)) return true;
  if (/\b(itemprop\s*=\s*["']author["'])/i.test(html)) return true;
  if (/class\s*=\s*["'][^"']*\b(author|byline|signature|auteur)\b/i.test(html)) return true;
  if (/\b(par|by|von|por|di)\s+[A-ZÀ-Ý][\p{L}'-]+\s+[A-ZÀ-Ý][\p{L}'-]+/u.test(page.text || "")) return true;
  return false;
}
