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
const scoreColor = (n) => (n >= 80 ? "#15803d" : n >= 50 ? "#b8860b" : "#c0392b");

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

function findingCard(f) {
  const [lab, col, bg] = SEV[f.severity] || SEV.info;
  const loc = f.location?.file ? `${esc(f.location.file)}:${f.location.line}` : esc(f.location?.url || "");
  const b = f.business || {};
  const money = `${b.kind === "gain" ? "+" : ""}${eur(b.low)} - ${eur(b.high)} €`;
  const raised = f.raisedBy && f.raisedBy.length > 1 ? ` &middot; remonte par ${f.raisedBy.join(", ")}` : "";
  return `<div class="fcard" style="border-left-color:${col}">
    <div class="fhead"><span class="sev" style="color:${col};background:${bg}">${lab}</span><h4>${esc(f.title)}</h4></div>
    <div class="fproof">${esc(String(f.evidence?.proof || "").slice(0, 300))}</div>
    <p class="ffix"><b>Correctif :</b> ${esc(f.fix?.summary || "")}</p>
    <div class="fmeta">
      <span>${esc(f.agent)}${f.cwe ? " &middot; " + esc(f.cwe) : ""}${raised}</span>
      <span>${f.effort ?? "?"} j &middot; <b style="color:${col}">${money}</b> est.</span>
    </div>
  </div>`;
}

export function renderReport(rec) {
  const f = rec.findings || [];
  const s = rec.summary || {};
  const gScore = s.weightedScore ?? rec.score ?? 0;
  const date = new Date(rec.generatedAt || rec.created_at || Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const domains = s.byDomain || [];
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
      ${items.map(findingCard).join("")}
    </div>`;
  }).join("");

  const strengthsHtml = strengths.length ? `
    <section>
      <h2><span class="n">04</span>Ce qui est deja excellent</h2>
      <p class="lead">Verifie et mesure, a preserver lors des correctifs.</p>
      <div class="sgrid">${strengths.map((d) => `<div class="scard"><div class="stitle"><span class="dot"></span>${esc(d.label)} <b>${d.score}/100</b></div><p>${esc(d.note)}</p></div>`).join("")}</div>
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
  @media(max-width:820px){.dgrid{grid-template-columns:repeat(2,1fr)}}
  .dcard{border:1px solid var(--line);border-radius:12px;padding:16px 16px 14px;background:#fff}
  .dtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
  .dlabel{font-weight:600;font-size:13.5px;line-height:1.2}
  .dscore{font-size:20px;font-weight:700}.dscore small{font-size:11px;color:var(--dim);font-weight:400}
  .dbar{height:5px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:9px}
  .dbar i{display:block;height:100%;border-radius:3px}
  .dnote{font-size:11.5px;color:var(--mut);line-height:1.45}
  .weighting{font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);margin-top:16px}
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
  .dl:hover{background:#0c8654}
  @media print{
    body{background:#fff}.dl{display:none}
    .hero,.tier-tag,.sev,.dbar i,.dot{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .fcard,.dcard,.scard{break-inside:avoid}
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

  <section>
    <h2><span class="n">02</span>Findings par priorite</h2>
    <p class="lead">Dedupliques sur les ${domains.length} domaines, classes par risque reel. Effort et impact estimes par finding.</p>
    ${tiersHtml || '<p class="lead">Aucun finding.</p>'}
  </section>

  ${strengthsHtml}

  <p class="estnote">Les montants sont des estimations ${s.calibrated ? "calibrees sur les donnees fournies (trafic x conversion)" : "indicatives par gravite"}, pas des mesures. Effort en jours-homme.</p>
</div>

<footer><b>Panoptic</b> &middot; ${(rec.agents || domains.map((d) => d.id)).length} auditeurs specialises &middot; ${esc(rec.target.replace(/^https?:\/\//, ""))} &middot; ${date}</footer>

<button class="dl" onclick="window.print()">Telecharger le PDF</button>
</body></html>`;
}
