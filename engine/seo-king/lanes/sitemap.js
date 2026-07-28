// Panoptic SEO KING - lane sitemap et decouverte.
// Le sitemap est une DECLARATION du proprietaire: "voici les pages qui comptent".
// Les defauts qui coutent le plus cher sont les contradictions entre cette
// declaration et ce que le site fait reellement.

import { parseLastmod } from "../xml.js";
import { sameOrigin } from "../graph.js";

export const id = "sitemap";

export function run(ctx) {
  const { scope, deep, graph } = ctx;
  const out = [];
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";
  const F = (r) => out.push({ dimensions: ["architecture"], url: scope.url, ...r });

  const sitemaps = deep?.sitemaps || [];
  const allEntries = deep?.sitemapEntries || [];
  const ok = sitemaps.filter((s) => s.ok);

  // Partition par origine. Un sitemap qui declare un autre domaine ne decrit pas CE
  // site: analyser ses URL comme si elles etaient locales produit des orphelines et
  // des trous de couverture entierement fictifs.
  const entries = allEntries.filter((e) => sameOrigin(e.loc, origin));
  const foreign = allEntries.filter((e) => !sameOrigin(e.loc, origin));

  if (!sitemaps.length || (!ok.length && sitemaps.every((s) => s.state === "observed"))) {
    const html = sitemaps.find((s) => s.servedAsHtml);
    F({
      rule: "no-sitemap", severity: "medium", effort: 0.3,
      title: html ? "sitemap.xml renvoie du HTML au lieu du XML" : "sitemap.xml absent",
      proof: html
        ? `GET ${html.loc} -> ${html.status} avec du HTML. Un serveur qui repond 200 sur toutes les routes masque l'absence de sitemap.`
        : sitemaps.map((s) => `${short(s.loc)} -> ${s.error || s.status || "?"}`).join(", ") || "Aucun sitemap trouve.",
      fix: "Generer un sitemap.xml valide et le declarer dans robots.txt.",
      verifiability: "self-evident",
    });
    return { findings: out, strengths };
  }

  strengths.push(`Sitemap valide: ${allEntries.length} URL declaree(s) sur ${ok.length} fichier(s)`);

  // URL d'un autre domaine dans le sitemap. Sur un alias c'est attendu. Sinon un
  // sitemap ne peut declarer que des URL du domaine ou il est publie: Google ignore
  // les autres.
  if (foreign.length) {
    const origins = [...new Set(foreign.map((e) => { try { return new URL(e.loc).origin; } catch { return "?"; } }))];
    if (ctx.alias) {
      F({
        rule: "sitemap-points-to-canonical", severity: "info", effort: 0,
        title: `Le sitemap declare les URL de ${origins.join(", ")}`,
        proof: `${foreign.length} URL d'un autre domaine, coherent avec la configuration d'alias detectee (canonicals vers ${ctx.alias.canonicalOrigin}).`,
        fix: `Aucune action. L'analyse de couverture du sitemap doit se faire sur ${ctx.alias.canonicalOrigin}.`,
        verifiability: "cross-checked",
      });
    } else {
      F({
        rule: "sitemap-foreign-urls", severity: "medium", effort: 0.3,
        title: `${foreign.length} URL du sitemap appartiennent a un autre domaine`,
        proof: `Origines declarees: ${origins.join(", ")}. Exemple: ${foreign[0].loc}. Un sitemap ne peut declarer que des URL du domaine ou il est publie; les autres sont ignorees.`,
        fix: "Publier un sitemap par domaine, ne listant que les URL de ce domaine.",
        verifiability: "cross-checked",
      });
    }
  }

  // Toute la suite ne porte QUE sur les URL de ce domaine.
  if (!entries.length) {
    return { findings: out, strengths, skipped: foreign.length ? `sitemap dedie a ${[...new Set(foreign.map((e) => { try { return new URL(e.loc).origin; } catch { return "?"; } }))].join(", ")}` : "sitemap vide" };
  }

  // --- Contradictions entre le sitemap et la realite -------------------------------
  const checks = (deep?.sitemapUrlChecks || []).filter((c) => c.state === "observed" && sameOrigin(c.url, origin));
  const checkedCount = checks.length;
  const sampled = deep?.coverage?.sitemapUrls === "sampled" || checkedCount < entries.length;
  const scopeNote = sampled ? ` (echantillon de ${checkedCount}/${entries.length} URL)` : "";

  const dead = checks.filter((c) => c.status >= 400 || c.status === 0);
  if (dead.length) {
    F({
      rule: "sitemap-dead-urls", severity: "high", effort: 0.3,
      title: `${dead.length} URL du sitemap ne repondent pas${scopeNote}`,
      proof: dead.slice(0, 6).map((c) => `${short(c.url)} -> ${c.error ? "injoignable" : c.status}`).join(", ") + ". Un sitemap qui declare des URL mortes perd la confiance du crawler pour toutes les autres.",
      fix: "Retirer ces URL du sitemap ou reparer les pages.",
      verifiability: sampled ? "sampled" : "cross-checked",
    });
  }

  const redirected = checks.filter((c) => c.status >= 300 && c.status < 400);
  if (redirected.length) {
    F({
      rule: "sitemap-redirects", severity: "medium", effort: 0.3,
      title: `${redirected.length} URL du sitemap sont des redirections${scopeNote}`,
      proof: redirected.slice(0, 5).map((c) => `${short(c.url)} -> ${c.status} vers ${short(c.location || "?")}`).join(", ") + ". Le sitemap doit lister les URL finales, pas des etapes.",
      fix: "Remplacer chaque URL redirigee par sa destination finale.",
      verifiability: sampled ? "sampled" : "cross-checked",
    });
  }
  if (!dead.length && !redirected.length && checkedCount) {
    strengths.push(`Les ${checkedCount} URL du sitemap verifiees repondent en 200 sans redirection`);
  }

  // Une page en noindex dans le sitemap: on demande de l'indexer et on l'interdit.
  const noindexInSitemap = entries
    .map((e) => graph.get(e.loc))
    .filter((n) => n && n.noindex);
  if (noindexInSitemap.length) {
    F({
      rule: "sitemap-noindex-conflict", severity: "high", effort: 0.2,
      title: `${noindexInSitemap.length} URL du sitemap portent noindex`,
      proof: noindexInSitemap.slice(0, 5).map((n) => short(n.url)).join(", ") + ". Le sitemap demande l'indexation, la page l'interdit: signal contradictoire envoye au crawler.",
      fix: "Retirer ces URL du sitemap, ou retirer leur noindex si elles doivent etre indexees.",
      verifiability: "cross-checked",
    });
  }

  // Une page canonicalisee ailleurs n'a rien a faire dans le sitemap.
  const canonElsewhere = entries
    .map((e) => graph.get(e.loc))
    .filter((n) => n && n.canonicalNormalized && n.canonicalNormalized !== n.url);
  if (canonElsewhere.length) {
    F({
      rule: "sitemap-canonical-conflict", severity: "medium", effort: 0.2,
      title: `${canonElsewhere.length} URL du sitemap se canonicalisent vers une autre URL`,
      proof: canonElsewhere.slice(0, 4).map((n) => `${short(n.url)} -> ${short(n.canonicalNormalized)}`).join(" | "),
      fix: "Ne lister dans le sitemap que les URL canoniques.",
      verifiability: "cross-checked",
    });
  }

  // --- lastmod ------------------------------------------------------------------------
  const lastmods = entries.map((e) => ({ loc: e.loc, ...parseLastmod(e.lastmod) }));
  const missing = lastmods.filter((l) => !l.present);
  const invalid = lastmods.filter((l) => l.present && !l.valid);
  const future = lastmods.filter((l) => l.ms && l.ms > Date.now() + 86400000);
  const present = lastmods.filter((l) => l.present && l.valid);

  if (missing.length === lastmods.length && lastmods.length) {
    F({
      rule: "sitemap-no-lastmod", severity: "low", effort: 0.2,
      title: "Aucune date lastmod dans le sitemap",
      proof: `${lastmods.length} URL sans <lastmod>. Le crawler ne sait pas quoi recrawler en priorite apres une mise a jour.`,
      fix: "Emettre un lastmod ISO 8601 refletant la vraie date de derniere modification du contenu.",
      verifiability: "self-evident",
    });
  } else if (invalid.length) {
    F({
      rule: "sitemap-invalid-lastmod", severity: "low", effort: 0.2,
      title: `${invalid.length} date(s) lastmod hors format W3C`,
      proof: invalid.slice(0, 4).map((l) => `${short(l.loc)}: "${l.raw}"`).join(", ") + ". Google ignore le champ lastmod du sitemap entier des qu'il le juge peu fiable.",
      fix: "Utiliser le format ISO 8601 (2026-07-27 ou 2026-07-27T10:00:00+02:00).",
      verifiability: "self-evident",
    });
  }
  if (future.length) {
    F({
      rule: "sitemap-future-lastmod", severity: "medium", effort: 0.2,
      title: `${future.length} date(s) lastmod dans le futur`,
      proof: future.slice(0, 4).map((l) => `${short(l.loc)}: ${l.raw}`).join(", ") + ". Une date future est le signal le plus net d'un lastmod fabrique; Google cesse alors de s'y fier.",
      fix: "N'emettre lastmod que depuis la vraie date de modification du contenu.",
      verifiability: "self-evident",
    });
  }
  // Toutes les dates identiques = generateur qui stampe la date du build, pas du contenu.
  if (present.length > 4) {
    const uniq = new Set(present.map((l) => l.raw));
    if (uniq.size === 1) {
      F({
        rule: "sitemap-uniform-lastmod", severity: "low", effort: 0.3,
        title: "Toutes les URL declarent le meme lastmod",
        proof: `${present.length} URL portent "${present[0].raw}". C'est la signature d'une date de build, pas d'une date de contenu: le signal de fraicheur ne vaut plus rien.`,
        fix: "Faire porter a chaque URL la date de derniere modification de son propre contenu.",
        verifiability: "self-evident",
      });
    } else strengths.push(`lastmod differencie par page (${uniq.size} dates distinctes)`);
  }

  // --- Couverture: sitemap contre maillage interne --------------------------------------
  const inSitemap = new Set(entries.map((e) => graph.get(e.loc)?.url).filter(Boolean));
  const crawled = graph.crawledPages().filter((p) => !p.noindex && p.status === 200);

  const notInSitemap = crawled.filter((p) => !inSitemap.has(p.url));
  if (notInSitemap.length && entries.length) {
    F({
      rule: "pages-missing-from-sitemap", severity: "medium", effort: 0.2,
      title: `${notInSitemap.length} page(s) indexable(s) absente(s) du sitemap`,
      proof: notInSitemap.slice(0, 8).map((p) => short(p.url)).join(", ") + `. Elles sont liees dans le site mais non declarees (${entries.length} URL au sitemap).`,
      fix: "Ajouter ces URL au sitemap, ou les passer en noindex si elles ne doivent pas etre indexees.",
      verifiability: "cross-checked",
    });
  }

  // Orpheline: declaree au sitemap mais aucun lien interne n'y mene.
  const orphans = entries
    .map((e) => graph.get(e.loc))
    .filter((n) => n && n.inLinks.length === 0 && n.url !== graph.home);
  if (orphans.length) {
    F({
      rule: "orphan-pages", severity: "high", effort: 0.4,
      title: `${orphans.length} page(s) orpheline(s): declarees au sitemap, aucun lien interne`,
      proof: orphans.slice(0, 6).map((n) => short(n.url)).join(", ") + ". Une page sans lien entrant ne recoit aucune autorite interne et est crawlee rarement.",
      fix: "Lier ces pages depuis la navigation, un hub thematique ou une page parente pertinente.",
      verifiability: "cross-checked",
      dimensions: ["architecture"],
    });
  } else if (entries.length > 1) {
    strengths.push("Toutes les URL du sitemap recoivent au moins un lien interne");
  }

  return { findings: out, strengths };
}
