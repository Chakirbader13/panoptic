// Panoptic - generateur statique multilingue.
// Rend 6 pages completes (contenu bake dans le HTML pour le SEO), hreflang, <html lang>.
//   node build.mjs   ->  index.html (fr, x-default) + en/ de/ es/ it/ nl/
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, LANGS, AGENTS, FAM_ORDER, AGENT_TX, T } from "./src/i18n.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/&(?![a-z#])/g, "&amp;").replace(/</g, "&lt;");

const CSS = `
  :root{
    --bg:#0a0c0b;--bg2:#0e110f;--line:#1e2621;--ink:#eef2ee;--mut:#96a29a;--dim:#606b64;
    --acc:#3ee89e;--acc-dim:#1f7a55;--acc-ghost:#3ee89e18;--crit:#ff5c5c;--r:14px;--mx:1240px;
    --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,"Segoe UI",sans-serif;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  ::selection{background:var(--acc);color:#04120b}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:var(--mx);margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}.acc{color:var(--acc)}
  body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
    background:radial-gradient(900px 500px at 82% -5%,#3ee89e14,transparent 60%),radial-gradient(700px 500px at 0% 100%,#3ee89e0a,transparent 55%),linear-gradient(var(--line) 1px,transparent 1px) 0 0/64px 64px,linear-gradient(90deg,var(--line) 1px,transparent 1px) 0 0/64px 64px;
    -webkit-mask-image:radial-gradient(1200px 800px at 50% 0%,#000 30%,transparent 78%);mask-image:radial-gradient(1200px 800px at 50% 0%,#000 30%,transparent 78%);opacity:.5}
  main,nav,footer{position:relative;z-index:1}
  nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:#0a0c0bcc;border-bottom:1px solid var(--line)}
  .nav{display:flex;align-items:center;justify-content:space-between;height:64px;gap:18px}
  .logo{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:-.02em;font-size:18px;flex:none}
  .logo .eye{width:22px;height:22px;border-radius:50%;border:2px solid var(--acc);display:grid;place-items:center;position:relative}
  .logo .eye::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc)}
  .nlinks{display:flex;gap:28px;align-items:center;font-size:14.5px;color:var(--mut);margin-left:auto}
  .nlinks a{transition:color .2s}.nlinks a:hover{color:var(--ink)}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14.5px;padding:10px 18px;border-radius:10px;transition:transform .15s,background .2s,border-color .2s;cursor:pointer;border:1px solid transparent;white-space:nowrap}
  .btn:active{transform:translateY(1px)}
  .btn-p{background:var(--acc);color:#04120b}.btn-p:hover{background:#57f0ae}
  .btn-g{border-color:var(--line);color:var(--ink)}.btn-g:hover{border-color:var(--acc-dim);background:#ffffff06}
  .langsel{position:relative;flex:none}
  .langsel summary{list-style:none;cursor:pointer;font-family:var(--mono);font-size:13px;color:var(--mut);border:1px solid var(--line);border-radius:9px;padding:8px 12px;display:flex;align-items:center;gap:7px}
  .langsel summary::-webkit-details-marker{display:none}
  .langsel summary:hover{border-color:var(--acc-dim);color:var(--ink)}
  .langsel summary .car{font-size:9px;color:var(--dim)}
  .langsel[open] summary{border-color:var(--acc-dim);color:var(--ink)}
  .langmenu{position:absolute;top:calc(100% + 8px);right:0;background:#0e1210;border:1px solid var(--line);border-radius:11px;padding:6px;min-width:168px;box-shadow:0 20px 50px -20px #000}
  .langmenu a{display:flex;justify-content:space-between;gap:14px;padding:9px 12px;border-radius:7px;font-size:14px;color:var(--mut);transition:background .15s,color .15s}
  .langmenu a:hover{background:var(--acc-ghost);color:var(--ink)}
  .langmenu a.on{color:var(--acc)}
  .langmenu a small{font-family:var(--mono);font-size:11px;color:var(--dim)}
  @media(max-width:960px){.nlinks{display:none}}
  .hero{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;padding:clamp(56px,8vh,104px) 0 72px}
  .kicker{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);border:1px solid var(--acc-dim);border-radius:100px;padding:6px 13px;margin-bottom:22px}
  .kicker .pulse{width:7px;height:7px;border-radius:50%;background:var(--acc);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--acc-ghost)}50%{opacity:.5;box-shadow:0 0 0 6px transparent}}
  h1{font-size:clamp(38px,5.4vw,64px);line-height:1.02;letter-spacing:-.035em;font-weight:680;margin-bottom:22px}
  h1 em{font-style:normal;color:var(--acc)}
  .sub{font-size:19px;color:var(--mut);max-width:46ch;margin-bottom:32px;line-height:1.55}
  .cta-row{display:flex;gap:14px;flex-wrap:wrap}
  .btn-lg{padding:15px 26px;font-size:15.5px;border-radius:12px}
  @media(max-width:920px){.hero{grid-template-columns:1fr;gap:40px;padding-top:44px}}
  .scan{border:1px solid var(--line);border-radius:18px;background:linear-gradient(#0e1210,#0b0e0c);overflow:hidden;box-shadow:0 30px 80px -30px #000}
  .scan-top{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--dim)}
  .dot{width:10px;height:10px;border-radius:50%}
  .scan-url{margin-left:8px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .scan-body{padding:8px 8px 12px}
  .arow{display:grid;grid-template-columns:20px 1fr auto;gap:11px;align-items:center;padding:9px 12px;border-radius:9px;font-size:13.5px;transition:background .3s}
  .arow.run{background:var(--acc-ghost)}
  .arow .an{color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .arow.done .an,.arow.run .an{color:var(--ink)}
  .chip{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line);position:relative;flex:none}
  .arow.run .chip{border-color:var(--acc);animation:spin 1s linear infinite}
  .arow.run .chip::after{content:"";position:absolute;inset:2px;border-radius:3px;border:1.5px solid transparent;border-top-color:var(--acc)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .arow.done .chip{border-color:var(--acc-dim);background:var(--acc-ghost)}
  .arow.done .chip::after{content:"";position:absolute;inset:0;display:grid;place-items:center;color:var(--acc);font-size:12px;line-height:18px;text-align:center;font-weight:700}
  .cnt{font-family:var(--mono);font-size:12px;color:var(--dim);white-space:nowrap}
  .arow.done .cnt{color:#ff9d42}.arow.clean .cnt{color:var(--acc)}
  .scan-foot{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid var(--line);margin-top:4px}
  .score{display:flex;align-items:baseline;gap:8px}
  .score b{font-family:var(--mono);font-size:30px;color:var(--acc);letter-spacing:-.02em}
  .score span{font-size:12.5px;color:var(--dim)}
  .prog{height:4px;background:var(--line);border-radius:2px;flex:1;margin-left:20px;overflow:hidden}
  .prog i{display:block;height:100%;width:0;background:var(--acc);transition:width .4s}
  .band{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:8px 0 40px}
  .band>div{background:var(--bg2);padding:26px 24px}
  .band b{display:block;font-family:var(--mono);font-size:27px;letter-spacing:-.02em;margin-bottom:6px}
  .band p{font-size:13.5px;color:var(--mut)}
  @media(max-width:760px){.band{grid-template-columns:repeat(2,1fr)}}
  section{padding:64px 0}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin-bottom:14px}
  h2{font-size:clamp(28px,3.6vw,42px);line-height:1.08;letter-spacing:-.03em;font-weight:660;max-width:22ch}
  .lead{font-size:17px;color:var(--mut);max-width:62ch;margin-top:16px}
  .shead{margin-bottom:40px}
  .fam{margin-bottom:34px}
  .fam-h{display:flex;align-items:center;gap:14px;margin-bottom:16px}
  .fam-h h3{font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);font-weight:600}
  .fam-h .ln{flex:1;height:1px;background:var(--line)}
  .fam-h .ct{font-family:var(--mono);font-size:12px;color:var(--dim)}
  .agrid{display:grid;gap:12px}
  .fam.f6 .agrid{grid-template-columns:repeat(3,1fr)}
  .fam.f4 .agrid{grid-template-columns:repeat(4,1fr)}
  .fam.f3 .agrid{grid-template-columns:repeat(3,1fr)}
  .fam.f2 .agrid{grid-template-columns:repeat(2,1fr)}
  .acard{border:1px solid var(--line);border-radius:var(--r);padding:20px;background:var(--bg2);transition:border-color .25s,transform .25s,background .25s}
  .acard:hover{border-color:var(--acc-dim);transform:translateY(-3px);background:#101512}
  .acard .num{font-family:var(--mono);font-size:12px;color:var(--acc);margin-bottom:10px}
  .acard h4{font-size:16.5px;letter-spacing:-.01em;margin-bottom:8px;font-weight:620}
  .acard p{font-size:13.5px;color:var(--mut);line-height:1.5;margin-bottom:14px}
  .fw{display:flex;flex-wrap:wrap;gap:6px}
  .fw span{font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:3px 8px}
  @media(max-width:900px){.fam.f6 .agrid,.fam.f4 .agrid,.fam.f3 .agrid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.agrid{grid-template-columns:1fr!important}}
  .pipe{display:grid;gap:14px}
  .step{display:grid;grid-template-columns:64px 1fr;gap:24px;align-items:start;border:1px solid var(--line);border-radius:var(--r);padding:24px 26px;background:var(--bg2);position:relative;transition:border-color .25s}
  .step:hover{border-color:var(--acc-dim)}
  .step .no{font-family:var(--mono);font-size:34px;color:var(--acc-dim);font-weight:600;line-height:1}
  .step h4{font-size:19px;letter-spacing:-.01em;margin-bottom:7px}
  .step p{font-size:14.5px;color:var(--mut);max-width:72ch}
  .step .tag{position:absolute;top:24px;right:26px;font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:100px;padding:4px 11px}
  @media(max-width:640px){.step{grid-template-columns:1fr;gap:8px}.step .tag{display:none}}
  .diffs{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:14px}
  .diff{border:1px solid var(--line);border-radius:var(--r);padding:26px;background:var(--bg2);transition:border-color .25s,transform .25s}
  .diff:hover{border-color:var(--acc-dim);transform:translateY(-3px)}
  .diff.big{grid-row:span 2;background:linear-gradient(160deg,#101a15,#0c100e);border-color:#1c3a2b}
  .diff .ic{font-family:var(--mono);font-size:13px;color:var(--acc);margin-bottom:16px}
  .diff h4{font-size:18px;letter-spacing:-.01em;margin-bottom:9px;font-weight:620}
  .diff.big h4{font-size:24px}
  .diff p{font-size:14px;color:var(--mut);line-height:1.55}.diff.big p{font-size:15.5px}
  @media(max-width:820px){.diffs{grid-template-columns:1fr 1fr}.diff.big{grid-column:span 2;grid-row:auto}}
  @media(max-width:520px){.diffs{grid-template-columns:1fr}.diff.big{grid-column:auto}}
  .fnd-sec{display:grid;grid-template-columns:.85fr 1.15fr;gap:48px;align-items:center}
  .fcard{border:1px solid var(--line);border-radius:16px;background:linear-gradient(#0e1210,#0b0e0c);overflow:hidden;font-size:14px;box-shadow:0 30px 80px -40px #000}
  .fcard .fh{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--mut)}
  .sev{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 9px;border-radius:6px;color:var(--crit);background:#ff5c5c1a;border:1px solid #ff5c5c40}
  .fcard .fb{padding:18px}
  .fcard h4{font-size:17px;letter-spacing:-.01em;margin-bottom:14px;font-family:var(--sans);color:var(--ink)}
  .frow{display:grid;grid-template-columns:104px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}
  .frow .k{font-family:var(--mono);color:var(--dim);font-size:11.5px;letter-spacing:.03em;text-transform:uppercase}
  .frow .v{color:var(--mut);line-height:1.5}
  .frow .v code{font-family:var(--mono);color:var(--acc);font-size:12.5px}
  .verdict{display:inline-flex;align-items:center;gap:7px;color:var(--acc);font-family:var(--mono);font-size:12px}
  .verdict .c{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--acc);display:grid;place-items:center;font-size:9px}
  @media(max-width:860px){.fnd-sec{grid-template-columns:1fr;gap:32px}}
  .prices{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
  .price{border:1px solid var(--line);border-radius:16px;padding:30px;background:var(--bg2)}
  .price.hi{border-color:var(--acc-dim);background:linear-gradient(170deg,#101a15,#0c100e);position:relative}
  .price.hi::before{content:attr(data-badge);position:absolute;top:-11px;left:30px;font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:#04120b;background:var(--acc);padding:4px 11px;border-radius:100px;font-weight:700}
  .price .pn{font-size:15px;color:var(--mut);margin-bottom:12px;font-weight:600}
  .price .pp{font-size:34px;letter-spacing:-.02em;font-weight:660;margin-bottom:4px}
  .price .pp small{font-size:15px;color:var(--dim);font-weight:400}
  .price .pd{font-size:13.5px;color:var(--dim);margin-bottom:22px;min-height:38px}
  .price ul{list-style:none;display:grid;gap:11px;margin-bottom:26px}
  .price li{display:grid;grid-template-columns:18px 1fr;gap:10px;font-size:13.5px;color:var(--mut);line-height:1.45}
  .price li .tk{color:var(--acc);font-family:var(--mono);font-size:13px}
  .price .btn{width:100%;justify-content:center}
  @media(max-width:820px){.prices{grid-template-columns:1fr}}
  .final{text-align:center;padding:96px 0}
  .final h2{margin:0 auto;max-width:24ch}
  .final .lead{margin:18px auto 34px}.final .cta-row{justify-content:center}
  footer{border-top:1px solid var(--line);padding:40px 0;color:var(--dim);font-size:13.5px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
  .foot .logo{font-size:16px}
  .rv{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}
  .rv.in{opacity:1;transform:none}
  @media(prefers-reduced-motion:reduce){.rv{opacity:1;transform:none;transition:none}.kicker .pulse,.arow.run .chip{animation:none}html{scroll-behavior:auto}}
`;

// agents du scanner (visuel heros) + comptes fixes
const SCAN_IDS = ["security", "infra", "deps", "data", "perf", "seo", "a11y", "legal", "cro"];
const SCAN_COUNTS = [2, 1, 3, 0, 2, 1, 4, 1, 0];

function scannerJS(lang) {
  const short = SCAN_IDS.map((id) => AGENT_TX[lang][id][0].split(" / ")[0]);
  const t = T[lang];
  const one = { fr: "finding", en: "finding", de: "Finding", es: "finding", it: "finding", nl: "finding" }[lang];
  const clean = t.prices[0][1]; // reutilise "Gratuit/Free..." ? non. mot "propre"
  const cleanWord = { fr: "propre", en: "clean", de: "sauber", es: "limpio", it: "pulito", nl: "schoon" }[lang];
  return `
const reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
const rowsEl=document.getElementById("scanRows");
const list=${JSON.stringify(short.map((n, i) => [n, SCAN_COUNTS[i]]))};
rowsEl.innerHTML=list.map(([n])=>'<div class="arow"><span class="chip"></span><span class="an">'+n+'</span><span class="cnt"></span></div>').join("");
const rows=[...rowsEl.querySelectorAll(".arow")];
const scoreEl=document.getElementById("scoreNum"),progEl=document.getElementById("prog");
let shown=0;
function setScore(){const d=rows.filter(r=>r.classList.contains("done")).length;progEl.style.width=(d/rows.length*100)+"%";scoreEl.textContent=Math.max(0,Math.round(100-(shown*shown)/(shown*shown+42)*100-shown*2));}
function fin(i){const r=rows[i],c=list[i][1];r.classList.remove("run");r.classList.add("done");if(c===0)r.classList.add("clean");r.querySelector(".cnt").textContent=c?(c+" "+${JSON.stringify(one)}+(c>1?"s":"")):${JSON.stringify(cleanWord)};shown+=c;setScore();}
function run(){rows.forEach(r=>{r.className="arow";r.querySelector(".cnt").textContent="";});shown=0;setScore();let i=0;const step=()=>{if(i>0)fin(i-1);if(i>=rows.length){setTimeout(run,2600);return;}rows[i].classList.add("run");i++;setTimeout(step,520);};setTimeout(step,400);}
if(reduce){shown=0;rows.forEach((r,k)=>{r.className="arow";fin(k);});}else{run();}
const rv=[...document.querySelectorAll(".rv:not(.in)")];
if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.12,rootMargin:"0px 0px -8% 0px"});rv.forEach(e=>io.observe(e));setTimeout(()=>rv.forEach(e=>e.classList.add("in")),2500);}else{rv.forEach(e=>e.classList.add("in"));}
`;
}

function agentsHTML(lang) {
  return FAM_ORDER.map((f) => {
    const list = AGENTS.filter((a) => a.fam === f.k);
    const cards = list.map((a) => {
      const [name, mission] = AGENT_TX[lang][a.id];
      return `<div class="acard"><div class="num">A${String(a.n).padStart(2, "0")}</div><h4>${esc(name)}</h4><p>${esc(mission)}</p><div class="fw">${a.fw.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
    }).join("");
    return `<div class="fam ${f.cls} rv"><div class="fam-h"><h3>${esc(T[lang].famLabel[f.k])}</h3><span class="ln"></span><span class="ct">${String(list.length).padStart(2, "0")} ${esc(T[lang].famUnit)}</span></div><div class="agrid">${cards}</div></div>`;
  }).join("");
}

function langSwitcher(cur) {
  const items = LANGS.map((l) => `<a href="/${l.path}"${l.code === cur ? ' class="on"' : ""} hreflang="${l.htmllang}">${esc(l.name)}<small>${l.code.toUpperCase()}</small></a>`).join("");
  return `<details class="langsel"><summary>${cur.toUpperCase()}<span class="car">&#9662;</span></summary><div class="langmenu">${items}</div></details>`;
}

function render(lang) {
  const t = T[lang];
  const self = LANGS.find((l) => l.code === lang);
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l.htmllang}" href="${SITE}/${l.path}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;

  const band = t.band.map(([b, p]) => `<div><b${b === "15" || b === "100%" ? ' class="acc"' : ""}>${b}</b><p>${p}</p></div>`).join("");
  const steps = t.steps.map((s, i) => `<div class="step rv"><div class="no">${String(i + 1).padStart(2, "0")}</div><div><span class="tag">${esc(s[2])}</span><h4>${esc(s[0])}</h4><p>${esc(s[1])}</p></div></div>`).join("");
  const diffsSmall = t.diffs.slice(1).map((d, i) => `<div class="diff"><div class="ic">0${i + 2}</div><h4>${esc(d[0])}</h4><p>${esc(d[1])}</p></div>`).join("");
  const findRows = t.findRows.map((r) => `<div class="frow"><div class="k">${esc(r[0])}</div><div class="v">${r[1]}</div></div>`).join("");
  const prices = t.prices.map((p, i) => {
    const feats = p[4].map((f) => `<li><span class="tk">&#10003;</span>${esc(f)}</li>`).join("");
    const hi = i === 1;
    const href = i === 0 ? "/console/" : "#";
    return `<div class="price${hi ? " hi" : ""}"${hi ? ` data-badge="${esc(t.priceBadge)}"` : ""}><div class="pn">${esc(p[0])}</div><div class="pp">${p[1]}${p[2] ? ` <small>${esc(p[2])}</small>` : ""}</div><div class="pd">${esc(p[3])}</div><ul>${feats}</ul><a class="btn ${hi ? "btn-p" : "btn-g"}" href="${href}">${esc(p[5])}</a></div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="${self.htmllang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t.metaTitle)}</title>
<meta name="description" content="${esc(t.metaDesc)}">
<link rel="canonical" href="${SITE}/${self.path}">
${alternates}
<meta property="og:title" content="${esc(t.ogTitle)}">
<meta property="og:description" content="${esc(t.ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${self.htmllang}">
<style>${CSS}</style>
</head>
<body>
<nav>
  <div class="wrap nav">
    <a class="logo" href="/${self.path}"><span class="eye"></span>Panoptic</a>
    <div class="nlinks">
      <a href="#agents">${esc(t.nav[0])}</a>
      <a href="#pipe">${esc(t.nav[1])}</a>
      <a href="#diff">${esc(t.nav[2])}</a>
      <a href="#prix">${esc(t.nav[3])}</a>
    </div>
    ${langSwitcher(lang)}
    <a class="btn btn-p" href="/console/">${esc(t.navCta)}</a>
  </div>
</nav>
<main class="wrap">
  <header class="hero">
    <div class="rv in">
      <span class="kicker"><span class="pulse"></span>${esc(t.heroKicker)}</span>
      <h1>${esc(t.heroH1[0])}<br>${esc(t.heroH1[1])}<br><em>${esc(t.heroH1[2])}</em></h1>
      <p class="sub">${esc(t.heroSub)}</p>
      <div class="cta-row">
        <a class="btn btn-p btn-lg" href="/console/">${esc(t.heroCta1)}</a>
        <a class="btn btn-g btn-lg" href="#finding">${esc(t.heroCta2)}</a>
      </div>
    </div>
    <div class="scan rv in" aria-hidden="true">
      <div class="scan-top"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="scan-url mono">${esc(t.scanUrl)}</span></div>
      <div class="scan-body" id="scanRows"></div>
      <div class="scan-foot"><div class="score"><b id="scoreNum">0</b><span>${t.scoreLabel}</span></div><div class="prog"><i id="prog"></i></div></div>
    </div>
  </header>

  <div class="band rv">${band}</div>

  <section id="agents">
    <div class="shead rv"><div class="eyebrow">${esc(t.agentsEye)}</div><h2>${esc(t.agentsH2)}</h2><p class="lead">${esc(t.agentsLead)}</p></div>
    ${agentsHTML(lang)}
  </section>

  <section id="pipe">
    <div class="shead rv"><div class="eyebrow">${esc(t.pipeEye)}</div><h2>${esc(t.pipeH2)}</h2><p class="lead">${esc(t.pipeLead)}</p></div>
    <div class="pipe">${steps}</div>
  </section>

  <section id="diff">
    <div class="shead rv"><h2>${esc(t.diffH2)}</h2><p class="lead">${esc(t.diffLead)}</p></div>
    <div class="diffs rv">
      <div class="diff big"><div class="ic">${esc(t.diffBigLabel)}</div><h4>${esc(t.diffs[0][0])}</h4><p>${esc(t.diffs[0][1])}</p></div>
      ${diffsSmall}
    </div>
  </section>

  <section id="finding">
    <div class="fnd-sec">
      <div class="rv"><div class="eyebrow">${esc(t.findEye)}</div><h2>${esc(t.findH2)}</h2><p class="lead">${esc(t.findLead)}</p></div>
      <div class="fcard rv">
        <div class="fh"><span class="sev">${esc(t.findSev)}</span><span>SEC-014 &middot; ${esc(AGENT_TX[lang].security[0])}</span><span style="margin-left:auto;color:var(--dim)">CVSS 9.1</span></div>
        <div class="fb"><h4>${esc(t.findTitle)}</h4>${findRows}</div>
      </div>
    </div>
  </section>

  <section id="prix">
    <div class="shead rv"><div class="eyebrow">${esc(t.priceEye)}</div><h2>${esc(t.priceH2)}</h2></div>
    <div class="prices rv">${prices}</div>
  </section>

  <section class="final rv">
    <h2>${esc(t.finalH2)}</h2>
    <p class="lead">${esc(t.finalLead)}</p>
    <div class="cta-row"><a class="btn btn-p btn-lg" href="/console/">${esc(t.finalCta1)}</a><a class="btn btn-g btn-lg" href="#finding">${esc(t.finalCta2)}</a></div>
  </section>
</main>
<footer><div class="wrap foot"><a class="logo" href="/${self.path}"><span class="eye"></span>Panoptic</a><span>${t.footDomains}</span><span>&copy; 2026 Panoptic</span></div></footer>
<script>${scannerJS(lang)}</script>
</body>
</html>`;
}

let n = 0;
for (const l of LANGS) {
  const dir = l.path ? join(ROOT, l.path.replace(/\/$/, "")) : ROOT;
  if (l.path) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), render(l.code));
  n++;
  console.log(`  ecrit  /${l.path}index.html  (${l.code})`);
}
console.log(`\n${n} pages generees. Racine = FR (x-default).`);
