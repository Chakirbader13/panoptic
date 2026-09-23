// Panoptic - rapport d'audit editorial, autonome, imprimable en PDF (Cmd+P / bouton).
// Pilote par les donnees de l'audit: score global pondere, tableau de bord par domaine,
// findings groupes par priorite, points forts. Aucune dependance.
const esc = (s) => String(s ?? "").replace(/&(?![a-z#])/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eur = (n) => Math.round(n || 0).toLocaleString("fr-FR");
const SEV = {
  critical: ["Critique", "#c0392b", "#fdecea"], high: ["Eleve", "#d97706", "#fdf3e6"],
  medium: ["Moyen", "#b8860b", "#fbf6e3"], low: ["Faible", "#2563eb", "#eaf0fd"], info: ["Info", "#6b7280", "#f1f2f4"],
};
const TIERS = [
  { key: "P0", label: "Urgent", sub: "risque financier, juridique ou securite actif", sevs: ["critical"] },
  { key: "P1", label: "Important", sub: "a corriger sous 7 jours", sevs: ["high"] },
  { key: "P2", label: "A planifier", sub: "sous 30 jours", sevs: ["medium"] },
  { key: "P3", label: "Backlog", sub: "faible priorite", sevs: ["low", "info"] },
];
const sectionNo = (king, upsell) => String((king ? 3 : 2) + (upsell ? 2 : 1)).padStart(2, "0");
const scoreColor = (n) => (n >= 80 ? "#15803d" : n >= 50 ? "#b8860b" : "#c0392b");

// Logs serveur: la seule source qui dit ce que les moteurs ont REELLEMENT fait.
function logsHtml(l) {
  if (!l?.stats?.parsed) return "";
  const bots = Object.values(l.byBot || {}).sort((a, b) => b.hits - a.hits).slice(0, 6);
  const rows = bots.map((b) => {
    const v = l.verdicts?.[Object.keys(l.byBot).find((k) => l.byBot[k] === b)] || {};
    const tag = v.verdict === "authentique" ? '<span class="pstat p-pret">authentifie</span>'
      : v.verdict === "usurpe" ? '<span class="pstat p-bloque">usurpe</span>'
      : v.verdict ? `<span class="pstat p-partiel">${esc(v.verdict)}</span>` : "";
    return `<tr><td><b>${esc(b.label)}</b> ${tag}</td><td class="mono">${b.hits.toLocaleString("fr-FR")}</td>
      <td class="mono">${b.uniquePaths}</td><td class="mono">${b.errors}</td></tr>`;
  }).join("");
  return `<div class="cit">
    <div class="cit-h"><b>Ce que les moteurs ont reellement explore</b>
      <span>${l.stats.parsed.toLocaleString("fr-FR")} requetes &middot; ${esc(l.period)} &middot; format ${esc(l.stats.format)}</span></div>
    <div class="cit-k">
      <div><span class="cit-n" style="color:${scoreColor(100 - (l.cross?.wasteRatio ?? 0))}">${l.cross?.wasteRatio ?? 0}%</span><small>du budget d'exploration gaspille</small></div>
      <div><span class="cit-n">${l.cross?.coverage ?? "-"}%</span><small>du sitemap reellement explore</small></div>
      <div><span class="cit-n">${(l.cross?.activeOrphans || []).length}</span><small>orphelines encore visitees</small></div>
    </div>
    ${rows ? `<div class="tscroll"><table class="ktab"><thead><tr><th>Robot</th><th>Visites</th><th>URL distinctes</th><th>Erreurs</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    <p class="cit-note">Le user-agent est declaratif: chaque robot est confirme par double controle DNS (inverse puis direct). Un robot non authentifie n'est pas compte comme un moteur.</p>
  </div>`;
}

// Positions reelles issues de la Search Console du proprietaire.
function positionsHtml(p) {
  if (!p?.pages?.length) return "";
  const rows = p.pages.slice(0, 6).map((x) => `<tr>
    <td>${esc(String(x.page).replace(/^https?:\/\/[^/]+/, "") || "/")}</td>
    <td class="mono">${x.impressions.toLocaleString("fr-FR")}</td><td class="mono">${x.clicks}</td>
    <td class="mono">${(x.ctr * 100).toFixed(1)}%</td><td class="mono">${x.position ?? "-"}</td></tr>`).join("");
  return `<div class="cit">
    <div class="cit-h"><b>Positions reelles (Search Console)</b>
      <span>${esc(p.property)} &middot; ${p.period.days} jours</span></div>
    <div class="cit-k">
      <div><span class="cit-n">${p.totals.impressions.toLocaleString("fr-FR")}</span><small>impressions</small></div>
      <div><span class="cit-n">${p.totals.clicks.toLocaleString("fr-FR")}</span><small>clics</small></div>
      <div><span class="cit-n">${p.totals.impressions ? ((p.totals.clicks / p.totals.impressions) * 100).toFixed(1) : 0}%</span><small>taux de clic</small></div>
    </div>
    <div class="tscroll"><table class="ktab"><thead><tr><th>Page</th><th>Impressions</th><th>Clics</th><th>CTR</th><th>Position</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cit-note">Donnee du proprietaire, pas une estimation. Elle ne couvre que ce site: aucune comparaison concurrentielle n'est possible par ce canal.</p>
  </div>`;
}

// Liens entrants: verification, pas decouverte.
function backlinksHtml(b) {
  if (!b?.counts) return "";
  const c = b.counts;
  return `<div class="cit">
    <div class="cit-h"><b>Liens entrants verifies un a un</b>
      <span>${b.sample.checked} verifies sur ${b.sample.declared} declares</span></div>
    <div class="cit-k">
      <div><span class="cit-n" style="color:#15803d">${c.dofollow}</span><small>liens vivants transmettant l'autorite</small></div>
      <div><span class="cit-n">${c.nofollow}</span><small>en nofollow</small></div>
      <div><span class="cit-n" style="color:${c.lost + c.sourceGone ? "#c0392b" : "#15803d"}">${c.lost + c.sourceGone}</span><small>disparus</small></div>
      <div><span class="cit-n">${c.unverifiable}</span><small>non verifiables</small></div>
    </div>
    <p class="cit-note">Panoptic verifie les liens fournis, il n'en decouvre pas: cela demanderait un index du web. Un lien non verifiable (pare-feu, interstitiel) n'est compte ni comme valide ni comme perdu.</p>
  </div>`;
}

// Deux lectures du meme site: ce que sert le serveur, ce que voit un navigateur.
// Le lecteur n'a pas a connaitre la difference entre HTML brut et DOM rendu: on lui
// dit qui voit quoi, et ce que ca lui coute.
function renderDeltaHtml(render, delta) {
  if (!render?.available || !delta) return "";
  const pct = delta.visibleRatio;
  const col = pct >= 90 ? "#15803d" : pct >= 50 ? "#b8860b" : "#c0392b";
  const issues = [
    [delta.jsonldJsOnly, "page(s) dont les donnees structurees n'existent qu'apres JavaScript"],
    [delta.canonChanged, "page(s) dont la canonical change entre le serveur et le navigateur"],
    [delta.titleChanged, "page(s) dont le titre est reecrit par JavaScript"],
    [delta.linkGap, "page(s) dont le maillage interne n'existe qu'apres JavaScript"],
    [delta.noindexInjected, "page(s) qui se desindexent apres JavaScript"],
  ].filter(([n]) => n > 0);
  return `<div class="cit">
    <div class="cit-h"><b>Ce que Google voit, ce que les moteurs de reponse IA ne voient pas</b>
      <span>${delta.pages} page(s) rendues dans Chromium</span></div>
    <div class="cit-k">
      <div><span class="cit-n" style="color:${col}">${pct}%</span><small>du contenu present sans JavaScript</small></div>
      <div><span class="cit-n">${delta.rawWords.toLocaleString("fr-FR")}</span><small>mots servis par le serveur</small></div>
      <div><span class="cit-n">${delta.renderedWords.toLocaleString("fr-FR")}</span><small>mots apres rendu</small></div>
      <div><span class="cit-n">${delta.rawLinks} / ${delta.renderedLinks}</span><small>liens internes servis / rendus</small></div>
    </div>
    ${issues.length
      ? `<ul class="cit-list">${issues.map(([n, l]) => `<li><b>${n}</b> ${esc(l)}</li>`).join("")}</ul>`
      : `<p class="cit-note">Aucun signal SEO ne depend de l'execution du JavaScript : le site est lisible a l'identique par les moteurs de recherche et par les moteurs de reponse.</p>`}
    <p class="cit-note">Googlebot execute JavaScript, les crawlers des moteurs de reponse (GPTBot, PerplexityBot, ClaudeBot) ne l'executent pas. Tout ce qui n'apparait qu'apres rendu est invisible pour eux.</p>
  </div>`;
}

// Citations IA REELLEMENT mesurees. Presente comme une mesure datee et echantillonnee,
// jamais comme une verite stable: une reponse d'IA n'est pas reproductible.
function citationsHtml(c) {
  if (!c || c.state !== "observed") return "";
  const s = c.sample || {};
  const rows = (c.topSources || []).slice(0, 6).map((r) => `<tr>
    <td><b>${esc(r.domain)}</b>${r.isSite ? ' <span class="pstat p-pret">votre site</span>' : ""}</td>
    <td class="mono">${r.count}</td><td class="mono">${r.share}%</td></tr>`).join("");
  return `<div class="cit">
    <div class="cit-h"><b>Citations mesurees dans les moteurs de reponse IA</b>
      <span>${esc((s.providers || []).join(", "))} &middot; ${s.prompts} question(s) &middot; ${s.successful} reponse(s)</span></div>
    <div class="cit-k">
      <div><span class="cit-n" style="color:${scoreColor(c.citationRate)}">${c.citationRate}%</span><small>reponses citant le site</small></div>
      <div><span class="cit-n">${c.mentionRate}%</span><small>mentions verifiees de la marque</small></div>
      ${c.ambiguousRate ? `<div><span class="cit-n" style="color:#b8860b">${c.ambiguousRate}%</span><small>mentions hors sujet (homonymie)</small></div>` : ""}
      <div><span class="cit-n">${c.aheadCount ?? 0}</span><small>sources citees plus souvent</small></div>
    </div>
    ${rows ? `<div class="tscroll"><table class="ktab"><thead><tr><th>Source citee</th><th>Citations</th><th>Part</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    <p class="cit-note">Mesure par echantillon a la date de l'audit. Les moteurs de reponse ne sont pas deterministes : ces taux se comparent d'un audit a l'autre, ils ne se lisent pas comme une part de marche.</p>
  </div>`;
}

function verdict(score) {
  if (score >= 85) return "Solide. Quelques finitions.";
  if (score >= 70) return "Bonne base, points a securiser.";
  if (score >= 50) return "Fondations a consolider.";
  return "Chantiers prioritaires importants.";
}

function domainCard(d) {
  if (d.evaluated === false) {
    return `<div class="dcard dna">
      <div class="dtop"><span class="dlabel">${esc(d.label)}</span><span class="dscore" style="color:#9aa39c;font-size:13px">non evalue</span></div>
      <div class="dbar"><i style="width:0"></i></div>
      <p class="dnote">${esc(d.note)}</p>
    </div>`;
  }
  const col = scoreColor(d.score);
  return `<div class="dcard">
    <div class="dtop"><span class="dlabel">${esc(d.label)}${d.partial ? ' <span class="dpart">partiel</span>' : ""}</span><span class="dscore" style="color:${col}">${d.score}<small>/100</small></span></div>
    <div class="dbar"><i style="width:${d.score}%;background:${col}"></i></div>
    <p class="dnote">${esc(d.note)}</p>
  </div>`;
}

function findingCard(f, locked) {
  const [lab, col, bg] = SEV[f.severity] || SEV.info;
  const loc = f.location?.file ? `${esc(f.location.file)}:${f.location.line}` : esc(f.location?.url || "");
  const b = f.business || {};
  const money = `${b.kind === "gain" ? "+" : ""}${eur(b.low)} - ${eur(b.high)} €`;
  const raised = f.raisedBy && f.raisedBy.length > 1 ? ` &middot; remonte par ${f.raisedBy.join(", ")}` : "";
  // Offre gratuite: le diagnostic est complet, la reponse (comment corriger) est le produit paye.
  const fix = locked
    ? `<p class="ffix flock">Correctif detaille : reserve a l'Audit complet, ou applique pour vous par notre equipe.</p>`
    : `<p class="ffix"><b>Correctif :</b> ${esc(f.fix?.summary || "")}</p>`;
  return `<div class="fcard" style="border-left-color:${col}">
    <div class="fhead"><span class="sev" style="color:${col};background:${bg}">${lab}</span><h4>${esc(f.title)}</h4></div>
    <div class="fproof">${esc(String(f.evidence?.proof || "").slice(0, 300))}</div>
    ${fix}
    <div class="fmeta">
      <span>${esc(f.agent)}${f.cwe ? " &middot; " + esc(f.cwe) : ""}${raised}</span>
      <span>${f.effort ?? "?"} j &middot; <b style="color:${col}">${money}</b> est.</span>
    </div>
  </div>`;
}

export function renderReport(rec, opts = {}) {
  const locked = opts.tier === "free" || rec.tier === "free";
  const f = rec.findings || [];
  const s = rec.summary || {};
  const gScore = s.weightedScore ?? rec.score ?? 0;
  const date = new Date(rec.generatedAt || rec.created_at || Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const domains = s.byDomain || [];
  // Score KING (SEO + GEO transversal). Declare tot: il decale la numerotation des
  // sections suivantes.
  const k = s.king || rec.king || null;
  const hasKing = Boolean(k && k.score != null);
  const evald = domains.filter((d) => d.evaluated !== false && d.score != null);
  // Points forts: uniquement des domaines pleinement evalues (pas les "partiels").
  const strengths = domains.filter((d) => d.evaluated !== false && !d.partial && d.score >= 85);

  // Bandeau eyebrow: familles couvertes.
  const fams = [...new Set(domains.map((d) => d.family))].map((x) => x.toUpperCase()).join(" &middot; ");

  // Synthese auto: domaine le plus faible / le plus fort.
  const weakest = [...evald].sort((a, b) => a.score - b.score)[0];
  const strongest = [...evald].sort((a, b) => b.score - a.score)[0];
  const naCount = domains.length - evald.length;
  const naNote = naCount ? ` ${naCount} domaine(s) non evaluable(s) en boite noire (audit complet du code requis).` : "";
  const summaryLine = evald.length
    ? `Point fort : <b>${esc(strongest.label)}</b> (${strongest.score}/100). Point faible : <b>${esc(weakest.label)}</b> (${weakest.score}/100), a traiter en priorite.${naNote}`
    : "";

  const dashboard = domains.map(domainCard).join("");
  const weighting = domains.map((d) => `${esc(d.label)} ${Math.round((d.weight / (domains.reduce((a, x) => a + x.weight, 0) || 1)) * 100)}%`).join(" &middot; ");

  const tiersHtml = TIERS.map((t) => {
    const items = f.filter((x) => t.sevs.includes(x.severity));
    if (!items.length) return "";
    return `<div class="tier">
      <div class="tier-h"><span class="tier-tag tier-${t.key}">${t.key}</span><h3>${esc(t.label)} <span>&mdash; ${esc(t.sub)}</span></h3><span class="tier-ct">${items.length} item${items.length > 1 ? "s" : ""}</span></div>
      ${items.map((x) => findingCard(x, locked)).join("")}
    </div>`;
  }).join("");

  const upsellHtml = locked && f.length ? `
  <section>
    <h2><span class="n">${hasKing ? "04" : "03"}</span>Debloquer les correctifs</h2>
    <div class="upsell">
      <p>Ce scan gratuit montre <b>ce qui cloche et ce que cela coute</b>. L'<b>Audit complet (490 €)</b> fournit
      chaque correctif detaille, lit votre code source pour remonter a la cause, et notre equipe peut
      <b>appliquer les corrections pour vous</b> : mises a jour, patchs, configuration, jusqu'a la pull request sur votre depot.</p>
      <a class="upbtn" href="https://panopticaudit.com/#prix">Passer a l'Audit complet</a>
    </div>
  </section>` : "";

  const strengthsHtml = strengths.length ? `
    <section>
      <h2><span class="n">${sectionNo(hasKing, locked && f.length)}</span>Ce qui est deja excellent</h2>
      <p class="lead">Verifie et mesure, a preserver lors des correctifs.</p>
      <div class="sgrid">${strengths.map((d) => `<div class="scard"><div class="stitle"><span class="dot"></span>${esc(d.label)} <b>${d.score}/100</b></div><p>${esc(d.note)}</p></div>`).join("")}</div>
    </section>` : "";

  // --- Bloc KING: vue SEO + GEO transversale ------------------------------------------
  // Affiche le score, sa COUVERTURE, et ce qui n'a pas pu etre mesure. Un score
  // sans sa couverture laisse croire a une evaluation complete: on refuse ca.
  const kingHtml = hasKing ? `
  <section>
    <h2><span class="n">02</span>Visibilite : score KING</h2>
    <p class="lead">Vue transversale SEO et moteurs de reponse IA, composee sur neuf axes ponderes.
    Seuls les constats verifies comptent ; un axe non mesure vaut <i>n/a</i> et son poids est redistribue.</p>
    <div class="kinghead">
      <div class="kingnum" style="color:${scoreColor(k.score)}">${k.score}<small>/100</small></div>
      <div class="kingband">
        <b>${esc(k.band)}</b>
        <p>${esc(k.meaning)}</p>
        <span class="kingcov">Couverture de la mesure : ${k.coverage}%${k.redistributed ? ` &middot; ${k.lostWeight} points de ponderation redistribues` : ""}</span>
      </div>
    </div>
    <div class="kgrid">${k.subscores.map((d) => {
      if (!d.measured) {
        return `<div class="kcard kna"><div class="ktop"><span>${esc(d.label)}</span><span class="kna-lab">n/a</span></div>
          <div class="kbar"><i style="width:0"></i></div><p>${esc(d.reason || "non mesure")}</p></div>`;
      }
      const col = scoreColor(d.score);
      return `<div class="kcard"><div class="ktop"><span>${esc(d.label)}</span><b style="color:${col}">${d.score}</b></div>
        <div class="kbar"><i style="width:${d.score}%;background:${col}"></i></div>
        <p>poids ${d.weight}% &middot; ${esc(d.detail || "aucun finding")}</p></div>`;
    }).join("")}</div>
    ${k.geo?.components ? `<div class="kgeo"><b>Detail citabilite IA</b> ${Object.entries({
      citability: "citabilite", readability: "lisibilite structurelle", multimodal: "blocs extractibles",
      authority: "autorite et marque", technical: "accessibilite technique",
    }).map(([key, lab]) => k.geo.components[key] == null ? "" : `<span class="chip">${lab} <b>${k.geo.components[key]}</b></span>`).join("")}</div>` : ""}
    ${Array.isArray(k.platforms) && k.platforms.length ? `
    <div class="tscroll"><table class="ktab"><thead><tr><th>Moteur de reponse</th><th>Etat</th><th>Pourquoi</th></tr></thead><tbody>
      ${k.platforms.map((p) => `<tr><td><b>${esc(p.platform)}</b></td>
        <td><span class="pstat p-${p.status}">${esc(p.status)}</span></td>
        <td>${esc(p.reason)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    ${logsHtml(k.logs)}
    ${positionsHtml(k.positions)}
    ${backlinksHtml(k.backlinks)}
    ${renderDeltaHtml(k.render, k.renderDelta)}
    ${citationsHtml(k.citations)}
    ${Array.isArray(k.notMeasured) && k.notMeasured.length ? `
    <div class="knot"><b>Hors perimetre de cet audit</b>
      <ul>${k.notMeasured.map((n) => `<li><b>${esc(n.label)}</b> : ${esc(n.reason)} Debloquerait : ${esc(n.unlocks)}</li>`).join("")}</ul>
    </div>` : ""}
  </section>` : "";

  const bySeverity = s.bySeverity || {};
  const sevChips = Object.entries(bySeverity).filter(([, v]) => v).map(([k, v]) => { const [lab, col] = SEV[k]; return `<span class="chip"><b style="color:${col}">${v}</b> ${lab.toLowerCase()}</span>`; }).join("");

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Audit Panoptic - ${esc(rec.target)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page{margin:14mm}
  :root{--ink:#1a1f1c;--mut:#5c6660;--dim:#8b948e;--line:#e6e9e6;--acc:#0f9d63;--paper:#fbfcfb}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14.5px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--paper)}
  .mono,code,.fproof,.dscore,.tier-tag,.tier-ct{font-family:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace}
  .wrap{max-width:920px;margin:0 auto;padding:0 26px 60px}
  /* HERO */
  .hero{background:#0f1a16;color:#eaf0ec;margin-bottom:38px;border-bottom:4px solid var(--acc)}
  .hero-in{max-width:920px;margin:0 auto;padding:38px 26px 34px;display:grid;grid-template-columns:1fr auto;gap:30px;align-items:start}
  .eyebrow{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.18em;color:#7fb79c;margin-bottom:12px}
  .hero h1{font-size:34px;letter-spacing:-.02em;line-height:1;margin-bottom:12px}
  .hmeta{font-family:ui-monospace,monospace;font-size:12px;color:#93a89d;margin-bottom:18px}
  .hsum{font-size:15.5px;color:#c9d6cf;max-width:60ch;line-height:1.55}
  .gscore{text-align:right;white-space:nowrap}
  .gscore .num{font-family:ui-monospace,monospace;font-size:62px;font-weight:700;line-height:1;letter-spacing:-.03em}
  .gscore .lab{font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.12em;color:#7fb79c;margin-top:4px}
  .verdict{display:inline-block;margin-top:14px;font-size:12.5px;color:#e8c39a;border:1px solid #4a5b52;border-radius:100px;padding:5px 13px}
  @media(max-width:640px){.hero-in{grid-template-columns:1fr}.gscore{text-align:left}}
  /* SECTIONS */
  section{margin:40px 0}
  h2{font-size:23px;letter-spacing:-.01em;margin-bottom:6px;display:flex;align-items:baseline;gap:12px}
  h2 .n{font-family:ui-monospace,monospace;font-size:14px;color:var(--acc)}
  .lead{color:var(--mut);margin-bottom:22px;max-width:70ch}
  /* DASHBOARD */
  .dgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:820px){.dgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:520px){.dgrid{grid-template-columns:1fr}}
  .dcard{border:1px solid var(--line);border-radius:12px;padding:16px 16px 14px;background:#fff}
  .dtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
  .dlabel{font-weight:600;font-size:13.5px;line-height:1.2}
  .dscore{font-size:20px;font-weight:700}.dscore small{font-size:11px;color:var(--dim);font-weight:400}
  .dbar{height:5px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:9px}
  .dbar i{display:block;height:100%;border-radius:3px}
  .dnote{font-size:11.5px;color:var(--mut);line-height:1.45}
  .weighting{font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);margin-top:16px}
  /* KING: score transversal SEO + GEO */
  .kinghead{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:20px 22px;background:#fff;margin-bottom:18px}
  .kingnum{font-family:ui-monospace,monospace;font-size:52px;font-weight:700;line-height:1;letter-spacing:-.03em}
  .kingnum small{font-size:17px;color:var(--dim);font-weight:400}
  .kingband b{display:block;font-size:16px;letter-spacing:-.01em}
  .kingband p{color:var(--mut);font-size:13.5px;margin:3px 0 7px;max-width:62ch}
  .kingcov{font-family:ui-monospace,monospace;font-size:11px;color:var(--dim)}
  .kgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:820px){.kgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.kinghead{grid-template-columns:1fr}}
  @media(max-width:520px){.kgrid{grid-template-columns:1fr}}
  @media(max-width:480px){.wrap{padding-left:18px;padding-right:18px}.hero-in{padding-left:18px;padding-right:18px}}
  .kcard{border:1px solid var(--line);border-radius:11px;padding:13px 14px;background:#fff}
  .ktop{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;margin-bottom:8px}
  .ktop b{font-family:ui-monospace,monospace;font-size:15px}
  .kbar{height:5px;background:#eef1ee;border-radius:3px;overflow:hidden}
  .kbar i{display:block;height:100%}
  .kcard p{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--dim);margin-top:7px;line-height:1.45}
  .kna{background:#fafbfa}.kna-lab{font-family:ui-monospace,monospace;font-size:12px;color:#9aa39c}
  .kgeo{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12.5px}
  .kgeo>b{margin-right:4px}
  .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
  .ktab{width:100%;min-width:420px;border-collapse:collapse;margin-top:18px;font-size:12.5px}
  .ktab th{text-align:left;font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.09em;color:var(--dim);text-transform:uppercase;padding:0 10px 7px 0;border-bottom:1px solid var(--line)}
  .ktab td{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--mut)}
  .ktab td b{color:var(--ink)}
  .pstat{font-family:ui-monospace,monospace;font-size:10.5px;padding:2px 8px;border-radius:100px;white-space:nowrap}
  .p-pret{color:#15803d;background:#e8f5ee}.p-partiel{color:#b8860b;background:#fbf6e3}.p-bloque{color:#c0392b;background:#fdecea}
  .cit{margin-top:20px;border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#fff}
  .cit-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .cit-h span{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--dim)}
  .cit-k{display:flex;gap:26px;flex-wrap:wrap}
  .cit-k>div{display:flex;flex-direction:column}
  .cit-n{font-family:ui-monospace,monospace;font-size:26px;font-weight:700;line-height:1.1}
  .cit-k small{font-size:11.5px;color:var(--mut);margin-top:2px}
  .cit-list{margin:14px 0 0 18px;font-size:12.5px;color:var(--mut);line-height:1.7}
  .cit-list b{color:var(--ink);font-family:ui-monospace,monospace}
  .cit-note{font-size:11.5px;color:var(--dim);margin-top:12px;line-height:1.5}
  .mono{font-family:ui-monospace,monospace}
  .knot{margin-top:18px;border-left:3px solid var(--line);padding:2px 0 2px 14px}
  .knot b{font-size:12.5px}
  .knot ul{margin:6px 0 0 16px;color:var(--mut);font-size:12.5px;line-height:1.6}
  .chips{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
  .chip{border:1px solid var(--line);border-radius:100px;padding:4px 12px;font-size:12.5px;color:var(--mut)}
  /* TIERS / FINDINGS */
  .tier{margin-bottom:26px}
  .tier-h{display:flex;align-items:center;gap:12px;margin:22px 0 12px}
  .tier-tag{font-size:11px;font-weight:700;color:#fff;border-radius:6px;padding:3px 8px}
  .tier-P0{background:#c0392b}.tier-P1{background:#d97706}.tier-P2{background:#b8860b}.tier-P3{background:#6b7280}
  .tier-h h3{font-size:16px}.tier-h h3 span{color:var(--dim);font-weight:400;font-size:13.5px}
  .tier-ct{margin-left:auto;font-size:12px;color:var(--dim)}
  .fcard{border:1px solid var(--line);border-left-width:3px;border-radius:10px;padding:16px 18px;background:#fff;margin-bottom:12px;break-inside:avoid}
  .fhead{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
  .sev{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:5px;white-space:nowrap;margin-top:2px}
  .fhead h4{font-size:15.5px;line-height:1.35;font-weight:620}
  .fproof{font-size:12px;background:#f4f6f5;border:1px solid var(--line);border-radius:7px;padding:9px 11px;color:#3c4641;margin-bottom:11px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
  .ffix{font-size:13.5px;color:#374039;margin-bottom:11px}
  .flock{color:var(--dim);font-style:italic;border:1px dashed var(--line);border-radius:7px;padding:8px 11px;background:#fafbfa}
  .upsell{border:1px solid #bfe3cf;background:#f2faf5;border-radius:14px;padding:22px 24px;max-width:70ch}
  .upsell p{font-size:14.5px;color:#2f3a34;line-height:1.6;margin-bottom:16px}
  .upbtn{display:inline-block;background:var(--acc);color:#fff;border-radius:100px;padding:11px 22px;font-weight:600;font-size:14px;text-decoration:none}
  .upbtn:hover{background:#0c8654}
  .fmeta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);border-top:1px solid var(--line);padding-top:9px}
  /* STRENGTHS */
  .sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  @media(max-width:760px){.sgrid{grid-template-columns:1fr}}
  .scard{border:1px solid #cfe6d8;background:#f3faf6;border-radius:12px;padding:16px}
  .stitle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-bottom:7px}
  .stitle b{margin-left:auto;color:#15803d;font-family:ui-monospace,monospace}
  .stitle .dot{width:9px;height:9px;border-radius:50%;background:#15803d}
  .scard p{font-size:12.5px;color:var(--mut)}
  /* NOTE + FOOTER */
  .estnote{font-size:11.5px;color:var(--dim);margin-top:10px;font-style:italic}
  footer{border-top:1px solid var(--line);margin-top:44px;padding-top:16px;font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);text-align:center}
  footer b{color:var(--acc)}
  /* DOWNLOAD BTN */
  .dl{position:fixed;bottom:22px;right:22px;background:var(--acc);color:#fff;border:none;border-radius:100px;padding:13px 22px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px -6px rgba(15,157,99,.5);z-index:10}
  /* Sur petit ecran, le FAB flottant est resserre dans le coin et on reserve de la
     place en bas pour qu'il ne recouvre jamais la fin du contenu. */
  @media(max-width:520px){.dl{bottom:14px;right:14px;padding:11px 18px;font-size:13px}body{padding-bottom:78px}}
  .dl:hover{background:#0c8654}
  @media print{
    body{background:#fff}.dl{display:none}
    .hero,.tier-tag,.sev,.dbar i,.dot{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .fcard,.dcard,.scard,.kcard,.kinghead{break-inside:avoid}
  }
</style></head><body>
<header class="hero"><div class="hero-in">
  <div>
    <div class="eyebrow">AUDIT PANOPTIC${fams ? " &middot; " + fams : ""}</div>
    <h1>${esc(rec.target.replace(/^https?:\/\//, ""))}</h1>
    <div class="hmeta">${domains.length} domaines &middot; ${f.length} findings &middot; ${date}</div>
    <p class="hsum">${summaryLine}</p>
  </div>
  <div class="gscore">
    <div class="num" style="color:${scoreColor(gScore)}">${gScore}</div>
    <div class="lab">SCORE GLOBAL PONDERE</div>
    <div class="verdict">${verdict(gScore)}</div>
  </div>
</div></header>

<div class="wrap">
  <section>
    <h2><span class="n">01</span>Tableau de bord</h2>
    <div class="dgrid">${dashboard || '<p class="lead">Aucun domaine.</p>'}</div>
    <div class="chips">${sevChips}</div>
    ${weighting ? `<div class="weighting">Ponderation : ${weighting}</div>` : ""}
  </section>

  ${kingHtml}

  <section>
    <h2><span class="n">${hasKing ? "03" : "02"}</span>Findings par priorite</h2>
    <p class="lead">Dedupliques sur les ${domains.length} domaines, classes par risque reel. Effort et impact estimes par finding.</p>
    ${tiersHtml || '<p class="lead">Aucun finding.</p>'}
  </section>

  ${upsellHtml}

  ${strengthsHtml}

  <p class="estnote">Les montants sont des estimations ${s.calibrated ? "calibrees sur les donnees fournies (trafic x conversion)" : "indicatives par gravite"}, pas des mesures. Effort en jours-homme.</p>
</div>

<footer><b>Panoptic</b> &middot; ${(rec.agents || domains.map((d) => d.id)).length} auditeurs specialises &middot; ${esc(rec.target.replace(/^https?:\/\//, ""))} &middot; ${date}</footer>

<button class="dl" onclick="window.print()">Telecharger le PDF</button>
</body></html>`;
}
