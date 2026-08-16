// Panoptic SEO KING - lane technique.
// Indexabilite, crawlabilite, canonicals, redirections, rendu. C'est la lane qui
// decide si le reste sert a quelque chose: une page non indexable a un contenu parfait
// pour personne.

import { crawlerMatrix, isAllowed } from "../robots.js";
import { canonicalChains, sameSite } from "../graph.js";
import { textOf, stripNoise } from "../html.js";

export const id = "technical";

export function run(ctx) {
  const { scope, deep, graph } = ctx;
  const out = [];
  const F = (r) => out.push({ dimensions: ["technical"], url: scope.url, ...r });
  const strengths = [];
  const origin = scope.origin;
  const short = (u) => (u || "").replace(origin, "") || "/";

  // --- robots.txt -------------------------------------------------------------------
  const robots = deep?.robots;
  if (robots?.state === "observed") {
    if (!robots.present && robots.servedAsHtml) {
      F({
        rule: "robots-served-as-html", severity: "medium", effort: 0.2,
        title: "robots.txt renvoie du HTML au lieu d'un fichier texte",
        proof: `GET ${origin}/robots.txt -> ${robots.status}, contenu HTML. Les crawlers ne trouvent aucune directive.`,
        fix: "Servir un vrai fichier texte a /robots.txt (une SPA qui repond 200 sur toutes les routes masque son absence).",
        verifiability: "self-evident",
      });
    } else if (!robots.present) {
      F({
        rule: "no-robots", severity: "low", effort: 0.1,
        title: "robots.txt absent",
        proof: `GET ${origin}/robots.txt -> ${robots.status}.`,
        fix: "Ajouter un robots.txt qui reference le sitemap. Sans lui tout est crawlable, mais on perd la declaration du sitemap.",
        verifiability: "self-evident",
      });
    } else {
      strengths.push("robots.txt present et servi en texte brut");
      const parsed = robots.parsed;

      // Directive Sitemap: c'est le canal de decouverte le plus fiable.
      if (!parsed.sitemaps.length) {
        F({
          rule: "robots-no-sitemap-directive", severity: "low", effort: 0.1,
          title: "robots.txt ne declare aucun sitemap",
          proof: `${parsed.groups.length} groupe(s) de regles, aucune ligne "Sitemap:".`,
          fix: `Ajouter "Sitemap: ${origin}/sitemap.xml" a la fin du robots.txt.`,
          verifiability: "self-evident",
        });
      } else strengths.push(`Sitemap declare dans robots.txt (${parsed.sitemaps.length})`);

      // Matrice bot x URL. On teste les chemins REELLEMENT publies (sitemap + crawl):
      // un Disallow sur /admin/ ou /api/ est une decision saine, pas un defaut.
      const published = publishedPaths(graph, deep, origin);
      const matrix = crawlerMatrix(parsed, published);
      ctx.crawlerMatrix = matrix;

      for (const bot of matrix) {
        if (!bot.blockedCount) continue;
        // Un blocage d'entrainement IA est une DECISION editoriale legitime. On
        // l'expose en info, jamais en defaut: beaucoup de sites le veulent.
        if (bot.kind === "ai-train") {
          F({
            rule: `ai-train-blocked-${bot.ua.toLowerCase()}`, severity: "info", effort: 0.1,
            title: `${bot.label} bloque (collecte d'entrainement ${bot.platform})`,
            proof: `${bot.blockedCount}/${published.length} URL publiees bloquees. Regle decisive: ${bot.sample.rule} (groupe "${bot.sample.group}").`,
            fix: "Aucune action requise si c'est voulu. Bloquer l'entrainement n'empeche pas d'etre cite par les moteurs de reponse temps reel.",
            verifiability: "cross-checked",
            dimensions: ["geo"],
          });
          continue;
        }
        const isSearch = bot.kind === "search";
        F({
          rule: `crawler-blocked-${bot.ua.toLowerCase()}`,
          severity: isSearch ? "critical" : "high",
          effort: 0.1,
          title: isSearch
            ? `${bot.label} bloque sur des URL publiees: le site sort de l'index`
            : `${bot.label} bloque: aucune citation possible sur ${bot.platform}`,
          proof: `${bot.blockedCount}/${published.length} URL publiees bloquees pour ${bot.ua}. Regle decisive: ${bot.sample.rule} (groupe "${bot.sample.group}"). Exemple: ${short(bot.blockedPaths[0])}.`,
          fix: `Retirer ou restreindre la regle ${bot.sample.rule} du groupe "${bot.sample.group}" dans robots.txt.`,
          verifiability: "cross-checked",
          dimensions: isSearch ? ["technical"] : ["geo"],
        });
      }
      const okBots = matrix.filter((b) => !b.blockedCount && b.kind !== "ai-train");
      if (okBots.length) strengths.push(`${okBots.length} crawlers de recherche et de reponse IA ont acces aux URL publiees`);

      // Ressources de RENDU bloquees. Verifier le statut d'une page ne suffit pas:
      // si /_next/, /assets/ ou /static/ est en Disallow, Googlebot recupere bien le
      // HTML mais ne peut ni charger le CSS ni executer le JS. Il voit une page
      // deconstruite, l'evaluation mobile s'effondre et le contenu injecte disparait.
      // Panne silencieuse classique: aucun outil ne signale la page comme bloquee.
      const homeHtmlForAssets = graph.get(scope.url)?.html || "";
      const assets = [];
      for (const m of homeHtmlForAssets.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) assets.push({ kind: "script", href: m[1] });
      for (const m of homeHtmlForAssets.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) assets.push({ kind: "style", href: m[1] });
      const blockedAssets = [];
      for (const a of assets) {
        let path;
        try {
          const u = new URL(a.href, scope.url);
          if (u.origin !== origin) continue;   // un CDN tiers n'est pas regi par NOTRE robots.txt
          path = u.pathname;
        } catch { continue; }
        const verdict = isAllowed(parsed, "Googlebot", path);
        if (!verdict.allowed) blockedAssets.push({ ...a, path, rule: verdict.rule, group: verdict.group });
      }
      if (blockedAssets.length) {
        const styles = blockedAssets.filter((a) => a.kind === "style").length;
        F({
          rule: "render-resources-blocked",
          severity: styles ? "critical" : "high",
          effort: 0.2,
          title: `${blockedAssets.length} ressource(s) de rendu bloquee(s) pour Googlebot`,
          proof: blockedAssets.slice(0, 4).map((a) => `${a.kind === "style" ? "CSS" : "JS"} ${a.path} bloque par ${a.rule} (groupe "${a.group}")`).join(" | ")
            + `. Googlebot recupere le HTML mais ne peut pas ${styles ? "charger la feuille de style" : "executer ce script"}: il evalue une page deconstruite.`,
          fix: "Autoriser explicitement les repertoires d'assets dans robots.txt (ex: Allow: /_next/, Allow: /assets/). Bloquer du CSS ou du JS de rendu n'apporte aucun benefice.",
          verifiability: "cross-checked",
          dimensions: ["technical", "performance"],
        });
      } else if (assets.length) {
        strengths.push(`Les ${assets.length} ressources de rendu (CSS et JS) sont accessibles a Googlebot`);
      }

      // Une regle hors groupe est silencieusement ignoree par tous les crawlers.
      if (parsed.unknownDirectives.length) {
        const orphanRules = parsed.unknownDirectives.filter((d) => /^(allow|disallow)\s*:/i.test(d));
        if (orphanRules.length) {
          F({
            rule: "robots-orphan-rules", severity: "medium", effort: 0.1,
            title: `${orphanRules.length} regle(s) robots.txt hors de tout groupe User-agent`,
            proof: `Ignorees par les crawlers (RFC 9309 2.2.1): ${orphanRules.slice(0, 3).join(" | ")}`,
            fix: "Placer chaque Allow/Disallow sous une ligne User-agent.",
            verifiability: "self-evident",
          });
        }
      }
    }
  }

  // --- Canonicals -------------------------------------------------------------------
  const pages = graph.crawledPages();
  const noCanon = pages.filter((p) => !p.canonicalNormalized);
  if (noCanon.length) {
    F({
      rule: "missing-canonical", severity: "medium", effort: 0.2,
      title: `Balise canonical absente sur ${noCanon.length} page(s)`,
      proof: `Pages sans <link rel="canonical">: ${noCanon.slice(0, 6).map((p) => short(p.url)).join(", ")}. Sans canonical, Google choisit seul l'URL a indexer.`,
      fix: "Ajouter une canonical auto-referente absolue sur chaque page indexable.",
      verifiability: "self-evident",
    });
  } else if (pages.length) strengths.push(`Canonical presente sur les ${pages.length} pages analysees`);

  const multiCanon = pages.filter((p) => (p.canonicalCount || 0) > 1);
  if (multiCanon.length) {
    F({
      rule: "multiple-canonical", severity: "high", effort: 0.2,
      title: `Plusieurs balises canonical sur ${multiCanon.length} page(s)`,
      proof: `Google ignore l'ensemble des canonicals quand elles sont multiples. Pages: ${multiCanon.slice(0, 5).map((p) => `${short(p.url)} (${p.canonicalCount})`).join(", ")}`,
      fix: "N'emettre qu'une seule balise canonical par page (souvent un template et un composant l'ajoutent chacun).",
      verifiability: "self-evident",
    });
  }

  // Cross-origin = canonical vers un autre DOMAINE ENREGISTRABLE. apex<->www et
  // sous-domaines d'un meme domaine sont du meme site (consolidation standard),
  // pas une fuite d'indexation: sameSite les exclut pour tuer le faux positif.
  const crossOrigin = pages.filter((p) => p.canonicalNormalized && !sameSite(p.canonicalNormalized, origin));
  if (ctx.alias) {
    // Toutes les pages pointent vers le meme autre domaine: configuration d'alias
    // deliberee, pas un defaut. On l'expose pour que le lecteur sache que ce
    // domaine n'est pas celui qui doit ranker, et on s'arrete la.
    F({
      rule: "alias-domain", severity: "info", effort: 0,
      title: `Ce domaine est un alias: tout se canonicalise vers ${ctx.alias.canonicalOrigin}`,
      proof: `${ctx.alias.pages}/${ctx.alias.total} pages canoniques pointent vers ${ctx.alias.canonicalOrigin} (${ctx.alias.ratio}%). C'est le schema attendu d'un alias de marque ou d'un domaine de preproduction: ce domaine ne doit pas etre indexe.`,
      fix: `Aucune action si c'est voulu. Pour auditer le domaine qui doit ranker, relancer sur ${ctx.alias.canonicalOrigin}.`,
      verifiability: "cross-checked",
    });
    strengths.push(`Canonicalisation d'alias coherente vers ${ctx.alias.canonicalOrigin} sur toutes les pages`);
  } else if (crossOrigin.length) {
    F({
      rule: "cross-origin-canonical", severity: "critical", effort: 0.2,
      title: `${crossOrigin.length} page(s) se canonicalisent vers un autre domaine`,
      proof: crossOrigin.slice(0, 4).map((p) => `${short(p.url)} -> ${p.canonicalNormalized}`).join(" | ") + `. Seules ${crossOrigin.length} pages sur ${pages.length} partent ailleurs: ce n'est donc pas un alias de domaine mais une fuite d'indexation.`,
      fix: "Verifier que le domaine cible est bien le domaine canonique voulu. Sinon corriger la generation de la canonical.",
      verifiability: "cross-checked",
    });
  }

  for (const c of canonicalChains(graph)) {
    F({
      rule: c.loop ? "canonical-loop" : "canonical-chain",
      severity: c.loop ? "critical" : "high", effort: 0.3,
      title: c.loop ? "Boucle de canonical entre deux pages" : "Chaine de canonical (A -> B -> C)",
      url: c.from,
      proof: `${short(c.from)} -> ${short(c.via)} -> ${short(c.to)}. Google ne suit pas les chaines de canonical: il choisit lui-meme l'URL indexee.`,
      fix: c.loop ? "Casser la boucle: chaque page pointe vers l'URL finale voulue." : "Pointer directement vers l'URL finale.",
      verifiability: "cross-checked",
    });
  }

  // Canonical vers une page noindex: contradiction qui desindexe les deux.
  for (const p of pages) {
    if (!p.canonicalNormalized || p.canonicalNormalized === p.url) continue;
    const target = graph.nodes.get(p.canonicalNormalized);
    if (target?.noindex) {
      F({
        rule: "canonical-to-noindex", severity: "high", effort: 0.2,
        title: "Canonical pointant vers une page en noindex",
        url: p.url,
        proof: `${short(p.url)} -> canonical ${short(target.url)}, or cette cible porte noindex. Les deux URL sortent de l'index.`,
        fix: "Soit retirer le noindex de la cible, soit corriger la canonical.",
        verifiability: "cross-checked",
      });
    }
  }

  // --- Statuts HTTP -----------------------------------------------------------------
  const broken = graph.allCrawled().filter((n) => n.status >= 400 || n.error);
  if (broken.length) {
    const server = broken.filter((n) => n.status >= 500);
    F({
      rule: server.length ? "server-errors" : "broken-pages",
      severity: server.length ? "critical" : "high", effort: 0.4,
      title: server.length
        ? `${server.length} page(s) en erreur serveur (5xx)`
        : `${broken.length} page(s) liee(s) en erreur (4xx)`,
      proof: broken.slice(0, 8).map((n) => `${short(n.url)} -> ${n.error ? "injoignable" : n.status}`).join(", "),
      fix: "Corriger ou rediriger en 301 vers l'equivalent le plus proche, puis mettre a jour les liens sources.",
      verifiability: "self-evident",
    });
  }

  // --- Variantes d'origine ------------------------------------------------------------
  for (const [key, v] of Object.entries(deep?.variants || {})) {
    if (v.state !== "observed") continue;
    const label = key === "http" ? "HTTP (non securise)" : "l'autre variante de domaine (www / sans www)";
    if (v.duplicate) {
      F({
        rule: `duplicate-origin-${key}`, severity: "high", effort: 0.2,
        title: `Le site repond en 200 sur ${label} sans rediriger`,
        proof: `${v.target} -> ${v.status} (final: ${v.final}). Chaque page existe alors en double, l'autorite se divise entre les deux versions.`,
        fix: `Rediriger ${label} en 301 vers ${origin}.`,
        verifiability: "cross-checked",
      });
    } else if (v.loop) {
      F({
        rule: `redirect-loop-${key}`, severity: "critical", effort: 0.3,
        title: `Boucle de redirection sur ${label}`,
        proof: v.chain.map((c) => `${c.url} -> ${c.status}`).join(" | "),
        fix: "Corriger la regle de redirection: la cible se redirige vers la source.",
        verifiability: "cross-checked",
      });
    } else if (v.hops > 2) {
      F({
        rule: `redirect-chain-${key}`, severity: "medium", effort: 0.2,
        title: `Chaine de ${v.hops} redirections depuis ${label}`,
        proof: v.chain.map((c) => `${short(c.url)} -> ${c.status}`).join(" | ") + ". Chaque saut coute du budget de crawl et de la latence.",
        fix: "Rediriger en un seul saut vers l'URL finale.",
        verifiability: "cross-checked",
      });
    }
  }
  const cleanVariants = Object.entries(deep?.variants || {}).filter(([, v]) => v.state === "observed" && !v.duplicate && !v.loop);
  if (cleanVariants.length === 2) strengths.push("HTTP et la variante www redirigent proprement vers le domaine canonique");

  // --- 404 --------------------------------------------------------------------------
  const nf = deep?.notFound;
  if (nf?.state === "observed" && nf.soft404) {
    F({
      rule: "soft-404", severity: "high", effort: 0.3,
      title: "Les URL inexistantes renvoient 200 au lieu de 404",
      proof: `GET ${nf.probe} -> 200 (${nf.bytes} octets)${nf.mentionsNotFound ? ", la page affiche pourtant un message d'erreur" : ""}. Google indexe alors des URL vides a l'infini.`,
      fix: "Renvoyer un vrai code 404 sur les routes inconnues. Sur Netlify: une regle de fallback avec status 404 au lieu de 200.",
      verifiability: "cross-checked",
    });
  } else if (nf?.state === "observed" && nf.status === 404) {
    strengths.push("Les URL inexistantes renvoient un vrai 404");
  }

  // --- Rendu: le contenu existe-t-il sans JavaScript ? ------------------------------
  // Determinant pour les moteurs de reponse IA: la plupart n'executent pas JS.
  const homeNode = graph.get(scope.url);
  if (homeNode?.html) {
    const raw = homeNode.html;
    const noScriptText = textOf(raw);
    const words = (noScriptText.match(/\S+/g) || []).length;
    const scriptBytes = (raw.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join("").length;
    const ratio = raw.length ? Math.round((scriptBytes / raw.length) * 100) : 0;
    // Quand le rendu navigateur a tourne, c'est la lane render-delta qui mesure
    // l'ecart pour de vrai. On ne double pas le constat avec une heuristique.
    if (words < 120 && scriptBytes > 5000 && !ctx.render?.available) {
      F({
        rule: "client-side-rendering", severity: "critical", effort: 1.5,
        title: "Contenu rendu cote client: invisible sans JavaScript",
        proof: `Le HTML servi contient ${words} mots de texte pour ${ratio}% de JavaScript. Les crawlers de reponse IA (GPTBot, PerplexityBot, ClaudeBot) n'executent pas JS: ils voient une page vide.`,
        fix: "Passer en rendu serveur ou pre-rendu (SSG) pour les pages a indexer.",
        verifiability: "self-evident",
        dimensions: ["technical", "geo"],
      });
    } else if (words >= 300) {
      strengths.push(`Contenu present dans le HTML servi (${words} mots sans JavaScript): lisible par les crawlers IA`);
    }
  }

  // --- Signaux d'accueil -------------------------------------------------------------
  const metas = homeNode?.metas;
  if (metas && !metas.name.viewport) {
    F({
      rule: "missing-viewport", severity: "high", effort: 0.1,
      title: "Meta viewport absente (non mobile-friendly)",
      proof: "Aucune <meta name=\"viewport\"> sur l'accueil. L'index de Google est mobile-first.",
      fix: '<meta name="viewport" content="width=device-width, initial-scale=1">',
      verifiability: "self-evident",
    });
  }
  if (metas && !metas.charset && !metas.httpEquiv["content-type"]) {
    F({
      rule: "missing-charset", severity: "low", effort: 0.1,
      title: "Encodage non declare dans le HTML",
      proof: "Ni <meta charset> ni http-equiv Content-Type sur l'accueil.",
      fix: 'Ajouter <meta charset="utf-8"> en premiere ligne du <head>.',
      verifiability: "self-evident",
    });
  }
  if (homeNode && !homeNode.lang) {
    F({
      rule: "missing-html-lang", severity: "medium", effort: 0.1,
      title: "Attribut lang absent sur <html>",
      proof: "<html> sans attribut lang: les moteurs et les lecteurs d'ecran doivent deviner la langue.",
      fix: 'Ajouter lang="fr" (ou la locale de la page) sur la balise <html>.',
      verifiability: "self-evident",
      dimensions: ["technical", "architecture"],
    });
  }

  // --- X-Robots-Tag en en-tete ---------------------------------------------------------
  const headerNoindex = (deep?.sitemapUrlChecks || []).filter((c) => c.state === "observed" && /noindex/i.test(c.xRobots || ""));
  if (headerNoindex.length) {
    F({
      rule: "x-robots-noindex", severity: "critical", effort: 0.2,
      title: `${headerNoindex.length} URL du sitemap desindexee(s) par l'en-tete X-Robots-Tag`,
      proof: headerNoindex.slice(0, 4).map((c) => `${short(c.url)}: X-Robots-Tag: ${c.xRobots}`).join(" | ") + ". Invisible dans le HTML, souvent oublie apres une recette.",
      fix: "Retirer l'en-tete X-Robots-Tag noindex de la configuration serveur pour ces routes.",
      verifiability: "cross-checked",
    });
  }

  // --- Structure des URLs ---------------------------------------------------------------
  const badUrls = pages.filter((p) => /[A-Z]/.test(p.path) || /_/.test(p.path) || p.path.length > 115);
  if (badUrls.length) {
    F({
      rule: "url-structure", severity: "low", effort: 0.5,
      title: `${badUrls.length} URL(s) a la structure fragile (majuscules, underscores ou tres longues)`,
      proof: badUrls.slice(0, 5).map((p) => p.path).join(", "),
      fix: "Minuscules, tirets plutot qu'underscores, chemins courts. Ne changer une URL existante qu'avec une 301.",
      verifiability: "self-evident",
      dimensions: ["architecture"],
    });
  }

  return { findings: out, strengths };
}

// Chemins reellement publies: sitemap d'abord (declaration explicite du proprietaire),
// complete par le crawl. C'est ce qui evite de crier au loup sur un Disallow: /api/.
function publishedPaths(graph, deep, origin) {
  const paths = new Set(["/"]);
  for (const e of deep?.sitemapEntries || []) {
    try { paths.add(new URL(e.loc).pathname); } catch { /* ignore */ }
  }
  for (const n of graph.crawledPages()) {
    try { paths.add(new URL(n.url).pathname); } catch { /* ignore */ }
  }
  return [...paths].slice(0, 40);
}
