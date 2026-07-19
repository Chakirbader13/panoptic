// Panoptic - generation du rapport d'audit en HTML autonome (imprimable en PDF).
// Aucune dependance: le navigateur imprime en PDF (Cmd+P / --print-to-pdf).
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SEV = { critical: ["Critique", "#c0392b"], high: ["Eleve", "#d97706"], medium: ["Moyen", "#b8860b"], low: ["Faible", "#2563eb"], info: ["Info", "#6b7280"] };
const eur = (n) => (n || 0).toLocaleString("fr-FR");

export function renderReport(rec) {
  const f = rec.findings || [];
  const s = rec.summary || {};
  const by = s.bySeverity || {};
  const date = new Date(rec.generatedAt || rec.created_at || Date.now()).toLocaleString("fr-FR");
  const scoreColor = rec.score >= 80 ? "#16a34a" : rec.score >= 50 ? "#d97706" : "#c0392b";

  const rows = f.map((x, i) => {
    const [lab, col] = SEV[x.severity] || SEV.info;
    const loc = x.location?.file ? `${esc(x.location.file)}:${x.location.line}` : esc(x.location?.url || "");
    const raised = x.raisedBy && x.raisedBy.length > 1 ? ` <span class="raise">remonte par ${x.raisedBy.join(", ")}</span>` : "";
    return `<tr class="fin">
      <td class="n">${i + 1}</td>
      <td><span class="sev" style="background:${col}">${lab}</span></td>
      <td>
        <div class="ti">${esc(x.title)}${raised}</div>
        <div class="me">${esc(x.agent)}${x.cwe ? " &middot; " + esc(x.cwe) : ""} &middot; ${loc}</div>
        <div class="fx"><b>Correctif:</b> ${esc(x.fix?.summary || "")}</div>
      </td>
      <td class="num">${x.effort ?? ""} j</td>
      <td class="num">${x.business?.gain_eur ? "+" + eur(x.business.gain_eur) : eur(x.business?.risk_eur)} &euro;</td>
    </tr>`;
  }).join("");

  const sevChips = Object.entries(by).map(([k, v]) => {
    const [lab, col] = SEV[k] || SEV.info;
    return `<span class="chip"><b style="color:${col}">${v}</b> ${lab.toLowerCase()}</span>`;
  }).join("");

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Rapport Panoptic - ${esc(rec.target)}</title>
<style>
  @page{margin:16mm}
  *{box-sizing:border-box}
  body{font:14px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;color:#1a1f1c;margin:0;padding:32px;max-width:900px;margin:0 auto}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0e1210;padding-bottom:18px;margin-bottom:24px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px}
  .eye{width:20px;height:20px;border-radius:50%;border:2px solid #16a34a;display:inline-grid;place-items:center}
  .eye::after{content:"";width:7px;height:7px;border-radius:50%;background:#16a34a}
  .meta{text-align:right;font-size:12px;color:#6b7280}
  h1{font-size:22px;margin:0 0 4px}
  .hero{display:flex;gap:28px;align-items:center;background:#f6f8f7;border:1px solid #e3e8e5;border-radius:12px;padding:22px 24px;margin-bottom:22px}
  .score{font-size:52px;font-weight:800;line-height:1;color:${scoreColor}}
  .score small{font-size:16px;color:#6b7280;font-weight:500}
  .kpis{display:flex;gap:26px;flex-wrap:wrap}
  .kpi b{display:block;font-size:20px}
  .kpi span{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
  .chips{margin:6px 0 22px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px}
  .chip{border:1px solid #e3e8e5;border-radius:20px;padding:4px 12px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-bottom:1px solid #e3e8e5;padding-bottom:6px;margin:26px 0 12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:10px 8px;border-bottom:1px solid #eef1ef;vertical-align:top}
  .fin .n{color:#9ca3af;width:22px}
  .sev{color:#fff;font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;white-space:nowrap;text-transform:uppercase}
  .ti{font-weight:600;font-size:13.5px}
  .me{color:#6b7280;font-family:ui-monospace,monospace;font-size:11px;margin:3px 0}
  .fx{color:#374151;font-size:12px}
  .raise{color:#16a34a;font-weight:500;font-size:11px}
  .num{text-align:right;white-space:nowrap;color:#374151}
  .road{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:10px 0}
  .road div{border:1px solid #e3e8e5;border-radius:10px;padding:14px}
  .road b{font-size:22px;display:block}.road span{font-size:11px;color:#6b7280}
  footer{margin-top:30px;padding-top:14px;border-top:1px solid #e3e8e5;font-size:11px;color:#9ca3af;text-align:center}
  @media print{body{padding:0}.fin{break-inside:avoid}}
</style></head><body>
<header>
  <div class="brand"><span class="eye"></span>Panoptic</div>
  <div class="meta">Rapport d'audit<br>${date}</div>
</header>
<h1>${esc(rec.target)}</h1>
<div class="hero">
  <div class="score">${rec.score ?? "-"}<small>/100</small></div>
  <div class="kpis">
    <div class="kpi"><b>${f.length}</b><span>findings</span></div>
    <div class="kpi"><b>${(rec.agents || []).length}</b><span>domaines</span></div>
    <div class="kpi"><b>${s.effortDays ?? "-"} j</b><span>effort total</span></div>
    <div class="kpi"><b>${eur(s.riskEur)} &euro;</b><span>risque</span></div>
    <div class="kpi"><b>+${eur(s.gainEur)} &euro;</b><span>gain potentiel</span></div>
  </div>
</div>
<div class="chips">${sevChips}</div>

<h2>Roadmap</h2>
<div class="road">
  <div><b style="color:#c0392b">${s.roadmap?.immediat?.length ?? 0}</b><span>Immediat (critique)</span></div>
  <div><b style="color:#d97706">${s.roadmap?.semaine?.length ?? 0}</b><span>Sous 7 jours (eleve)</span></div>
  <div><b style="color:#b8860b">${s.roadmap?.mois?.length ?? 0}</b><span>Sous 30 jours (moyen)</span></div>
  <div><b style="color:#6b7280">${s.roadmap?.backlog?.length ?? 0}</b><span>Backlog</span></div>
</div>

<h2>Findings (${f.length}) &middot; par severite puis impact/effort</h2>
<table><tbody>${rows || '<tr><td colspan="5">Aucun finding.</td></tr>'}</tbody></table>

<footer>Genere par Panoptic &middot; ${(rec.agents || []).join(", ") || "audit"} &middot; ${date}</footer>
</body></html>`;
}
