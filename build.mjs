// Panoptic - generateur statique multilingue (refonte premium).
// Rend 6 pages completes (contenu bake dans le HTML pour le SEO), hreflang, <html lang>.
// Police Geist auto-hebergee (zero requete externe). Design dark-tech, accent vert verrouille.
//   node build.mjs   ->  index.html (fr, x-default) + en/ de/ es/ it/ nl/  (+ fonts/ a copier)
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, LANGS, AGENTS, FAM_ORDER, AGENT_TX, T, EXTRA } from "./src/i18n.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RENDER = "https://panoptic-audit.onrender.com/"; // serveur complet (offre code+prod)
const esc = (s) => String(s).replace(/&(?![a-z#])/g, "&amp;").replace(/</g, "&lt;");

const CSS = `
  @font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  @font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  :root{
    --bg:#080a09;--bg2:#0c0f0d;--panel:#0f1310;--line:#1b221d;--line2:#252e28;
    --ink:#f1f4f1;--mut:#98a29b;--dim:#5c665f;
    --acc:#4ff0a3;--acc2:#2fd88a;--acc-dim:#1e6b47;--acc-ghost:rgba(79,240,163,.08);
    --crit:#ff5d5d;--high:#ffa53d;--med:#ffd84d;--low:#5db4ff;
    --sans:Geist,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
    --mx:1180px;--pad:24px}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;
    -webkit-font-smoothing:antialiased;overflow-x:hidden;font-feature-settings:"ss01","cv01"}
  ::selection{background:var(--acc);color:#04140c}
  a{color:inherit;text-decoration:none}
  .mono{font-family:var(--mono)}
  .acc{color:var(--acc)}
  .wrap{max-width:var(--mx);margin:0 auto;padding:0 var(--pad)}
  body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
    background:radial-gradient(1100px 620px at 78% -8%,rgba(79,240,163,.10),transparent 60%),
      radial-gradient(760px 520px at -5% 12%,rgba(79,240,163,.05),transparent 55%);opacity:.9}
  .grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;
    background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
    background-size:56px 56px;
    -webkit-mask-image:radial-gradient(1000px 700px at 50% -5%,#000 20%,transparent 72%);
    mask-image:radial-gradient(1000px 700px at 50% -5%,#000 20%,transparent 72%);opacity:.35}
  main,nav,footer{position:relative;z-index:1}

  /* NAV */
  nav{position:sticky;top:0;z-index:60;backdrop-filter:blur(16px);background:rgba(8,10,9,.72);
    border-bottom:1px solid var(--line)}
  .nav{display:flex;align-items:center;gap:16px;height:66px}
  .logo{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.02em;font-size:18px;flex:none}
  .eye{width:24px;height:24px;border-radius:50%;border:2px solid var(--acc);display:grid;place-items:center;position:relative}
  .eye::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--acc);box-shadow:0 0 14px var(--acc)}
  .nlinks{display:flex;gap:30px;align-items:center;font-size:14.5px;color:var(--mut);margin-left:auto}
  .nlinks a{transition:color .2s}.nlinks a:hover{color:var(--ink)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:550;font-size:14.5px;
    padding:11px 20px;border-radius:100px;transition:transform .15s,background .2s,border-color .2s,box-shadow .2s;
    cursor:pointer;border:1px solid transparent;white-space:nowrap;font-family:var(--sans)}
  .btn:active{transform:translateY(1px)}
  .btn-p{background:var(--acc);color:#04140c;font-weight:600}
  .btn-p:hover{background:#63f4b1;box-shadow:0 0 0 4px var(--acc-ghost)}
  .btn-g{border-color:var(--line2);color:var(--ink)}
  .btn-g:hover{border-color:var(--acc-dim);background:rgba(255,255,255,.03)}
  .langsel{position:relative;flex:none}
  .langsel summary{list-style:none;cursor:pointer;font-family:var(--mono);font-size:13px;color:var(--mut);
    border:1px solid var(--line2);border-radius:100px;padding:8px 13px;display:flex;align-items:center;gap:7px}
  .langsel summary::-webkit-details-marker{display:none}
  .langsel summary:hover{border-color:var(--acc-dim);color:var(--ink)}
  .langsel summary .car{font-size:9px;color:var(--dim)}
  .langmenu{position:absolute;top:calc(100% + 8px);right:0;background:var(--panel);border:1px solid var(--line2);
    border-radius:12px;padding:6px;min-width:172px;box-shadow:0 24px 60px -18px rgba(0,0,0,.7)}
  .langmenu a{display:flex;justify-content:space-between;gap:14px;padding:9px 12px;border-radius:8px;font-size:14px;
    color:var(--mut);transition:background .15s,color .15s}
  .langmenu a:hover{background:var(--acc-ghost);color:var(--ink)}
  .langmenu a.on{color:var(--acc)}
  .langmenu a small{font-family:var(--mono);font-size:11px;color:var(--dim)}
  @media(max-width:900px){.nlinks{display:none}}

  /* HERO */
  .hero{display:grid;grid-template-columns:1.04fr .96fr;gap:52px;align-items:center;
    min-height:calc(100dvh - 66px);padding:40px 0 68px}
  .cli{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:13px;color:var(--mut);
    border:1px solid var(--line2);border-radius:100px;padding:8px 15px;margin-bottom:26px}
  .cli .p{color:var(--acc)}
  h1{font-size:clamp(40px,5.7vw,68px);line-height:1.0;letter-spacing:-.038em;font-weight:600;margin-bottom:24px}
  h1 em{font-style:normal;color:var(--acc)}
  .sub{font-size:19.5px;color:var(--mut);max-width:44ch;margin-bottom:34px;line-height:1.55}
  .cta-row{display:flex;gap:13px;flex-wrap:wrap}
  .btn-lg{padding:15px 27px;font-size:15.5px}
  @media(max-width:900px){.hero{grid-template-columns:1fr;gap:40px;min-height:0;padding-top:36px}h1{font-size:clamp(36px,10vw,52px)}}

  /* HERO PANEL (scanner + heatmap de risque) */
  .panel{border:1px solid var(--line2);border-radius:18px;overflow:hidden;position:relative;
    background:linear-gradient(180deg,#0e1310,#0a0d0b);
    box-shadow:0 40px 90px -40px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.03)}
  .panel::before{content:"";position:absolute;inset:0;border-radius:18px;padding:1px;pointer-events:none;
    background:linear-gradient(180deg,rgba(79,240,163,.28),transparent 40%);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
  .ptop{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line);
    font-family:var(--mono);font-size:12px;color:var(--dim)}
  .dot{width:10px;height:10px;border-radius:50%}
  .purl{margin-left:8px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pbody{padding:8px 8px 6px}
  .arow{display:grid;grid-template-columns:20px 1fr auto;gap:11px;align-items:center;padding:8px 12px;
    border-radius:9px;font-size:13.5px;transition:background .3s}
  .arow.run{background:var(--acc-ghost)}
  .arow .an{color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .arow.done .an,.arow.run .an{color:var(--ink)}
  .chip{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line2);position:relative;flex:none}
  .arow.run .chip{border-color:var(--acc);animation:spin 1s linear infinite}
  .arow.run .chip::after{content:"";position:absolute;inset:2px;border-radius:3px;border:1.5px solid transparent;border-top-color:var(--acc)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .arow.done .chip{border-color:var(--acc-dim);background:var(--acc-ghost)}
  .arow.done .chip::after{content:"\\2713";position:absolute;inset:0;display:grid;place-items:center;color:var(--acc);font-size:12px;font-weight:700}
  .cnt{font-family:var(--mono);font-size:12px;color:var(--dim);white-space:nowrap}
  .arow.done .cnt{color:var(--high)}.arow.clean .cnt{color:var(--acc)}
  .pmap{display:grid;grid-template-columns:repeat(15,1fr);gap:5px;padding:12px 16px 4px}
  .tile{aspect-ratio:1;border-radius:4px;background:var(--line);opacity:0;transform:scale(.6);
    animation:pop .5s cubic-bezier(.16,1,.3,1) forwards}
  .tile.ok{background:var(--acc-dim)}.tile.hit{background:var(--high)}.tile.crit{background:var(--crit)}
  @keyframes pop{to{opacity:1;transform:scale(1)}}
  .pmap-l{padding:2px 16px 12px;font-family:var(--mono);font-size:10.5px;color:var(--dim);display:flex;gap:14px}
  .pmap-l b{color:var(--mut)}
  .pfoot{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid var(--line)}
  .score{display:flex;align-items:baseline;gap:9px}
  .score b{font-family:var(--mono);font-size:34px;color:var(--acc);letter-spacing:-.03em;font-weight:600}
  .score span{font-size:12.5px;color:var(--dim)}
  .prog{height:4px;background:var(--line);border-radius:2px;flex:1;margin-left:22px;overflow:hidden}
  .prog i{display:block;height:100%;width:0;background:var(--acc);transition:width .5s}

  /* PROOF BAND */
  .proof{margin:6px 0 22px;padding:26px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .proof p{color:var(--mut);font-size:15px;max-width:64ch;margin-bottom:22px}
  .proof p b{color:var(--ink);font-weight:550}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line)}
  .stats>div{background:var(--bg);padding:4px 22px 4px 0}
  .stats b{display:block;font-family:var(--mono);font-size:24px;letter-spacing:-.02em;margin-bottom:5px}
  .stats span{font-size:13px;color:var(--mut)}
  @media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr);gap:22px 0}.stats>div{padding-right:0}}

  /* SECTIONS */
  section{padding:88px 0}
  .shead{margin-bottom:44px;max-width:70ch}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin-bottom:15px}
  h2{font-size:clamp(29px,3.9vw,44px);line-height:1.06;letter-spacing:-.03em;font-weight:600;max-width:20ch}
  .lead{font-size:17.5px;color:var(--mut);max-width:62ch;margin-top:18px;line-height:1.6}

  /* PROBLEM */
  .prob{text-align:center;max-width:820px;margin:0 auto}
  .prob h2{margin:0 auto;max-width:22ch}.prob .lead{margin:18px auto 0}
  .tools{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:34px}
  .tool{font-family:var(--mono);font-size:13px;color:var(--dim);border:1px solid var(--line);border-radius:100px;padding:8px 15px}
  .tool.us{color:#04140c;background:var(--acc);border-color:var(--acc);font-weight:600}

  /* PIPELINE */
  .pipe{display:grid;gap:0;position:relative;margin-left:8px}
  .pipe::before{content:"";position:absolute;left:23px;top:20px;bottom:20px;width:1px;background:linear-gradient(var(--acc-dim),var(--line))}
  .step{display:grid;grid-template-columns:48px 1fr;gap:26px;padding:22px 0;position:relative}
  .step .no{width:48px;height:48px;border-radius:12px;border:1px solid var(--line2);background:var(--panel);
    display:grid;place-items:center;font-family:var(--mono);font-size:15px;color:var(--acc);z-index:1}
  .step h4{font-size:19px;letter-spacing:-.01em;margin-bottom:7px;font-weight:550}
  .step p{font-size:15px;color:var(--mut);max-width:66ch}
  .step .tag{font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:100px;padding:3px 11px;margin-top:10px;display:inline-block}

  /* AGENTS */
  .fam{margin-bottom:30px}
  .fam-h{display:flex;align-items:center;gap:14px;margin-bottom:16px}
  .fam-h h3{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:550}
  .fam-h .ln{flex:1;height:1px;background:var(--line)}
  .fam-h .ct{font-family:var(--mono);font-size:12px;color:var(--dim)}
  .agrid{display:grid;gap:12px}
  .fam.f6 .agrid{grid-template-columns:repeat(3,1fr)}
  .fam.f4 .agrid{grid-template-columns:repeat(4,1fr)}
  .fam.f3 .agrid{grid-template-columns:repeat(3,1fr)}
  .fam.f2 .agrid{grid-template-columns:repeat(2,1fr)}
  .acard{border:1px solid var(--line);border-radius:16px;padding:22px;background:linear-gradient(180deg,var(--bg2),var(--bg));
    transition:border-color .25s,transform .25s,box-shadow .25s;position:relative}
  .acard:hover{border-color:var(--acc-dim);transform:translateY(-3px);box-shadow:0 20px 40px -24px rgba(0,0,0,.8)}
  .acard .num{font-family:var(--mono);font-size:12px;color:var(--acc);margin-bottom:12px}
  .acard h4{font-size:16.5px;letter-spacing:-.01em;margin-bottom:8px;font-weight:550}
  .acard p{font-size:13.5px;color:var(--mut);line-height:1.5;margin-bottom:15px}
  .fw{display:flex;flex-wrap:wrap;gap:6px}
  .fw span{font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:3px 8px}
  @media(max-width:900px){.fam.f6 .agrid,.fam.f4 .agrid,.fam.f3 .agrid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:520px){.agrid{grid-template-columns:1fr!important}}

  /* DIFFS (bento) */
  .diffs{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:14px}
  .diff{border:1px solid var(--line);border-radius:16px;padding:26px;background:var(--bg2);transition:border-color .25s,transform .25s}
  .diff:hover{border-color:var(--acc-dim);transform:translateY(-3px)}
  .diff.big{grid-row:span 2;background:linear-gradient(155deg,rgba(79,240,163,.07),transparent 55%),var(--bg2);border-color:var(--acc-dim)}
  .diff .ic{font-family:var(--mono);font-size:12px;color:var(--acc);margin-bottom:16px}
  .diff h4{font-size:18px;letter-spacing:-.01em;margin-bottom:10px;font-weight:550}
  .diff.big h4{font-size:25px;letter-spacing:-.02em}
  .diff p{font-size:14px;color:var(--mut);line-height:1.55}.diff.big p{font-size:16px}
  @media(max-width:820px){.diffs{grid-template-columns:1fr 1fr}.diff.big{grid-column:span 2;grid-row:auto}}
  @media(max-width:520px){.diffs{grid-template-columns:1fr}.diff.big{grid-column:auto}}

  /* REPORT / FINDING */
  .rep{display:grid;grid-template-columns:1fr 1.1fr;gap:52px;align-items:center}
  .fcard{border:1px solid var(--line2);border-radius:16px;background:linear-gradient(180deg,#0e1310,#0a0d0b);overflow:hidden;
    font-size:14px;box-shadow:0 36px 80px -44px rgba(0,0,0,.85)}
  .fcard .fh{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--mut)}
  .sev{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:6px;color:var(--crit);background:rgba(255,93,93,.12);border:1px solid rgba(255,93,93,.3)}
  .fcard .fb{padding:20px}
  .fcard h4{font-size:17px;letter-spacing:-.01em;margin-bottom:16px;font-family:var(--sans);color:var(--ink);font-weight:550}
  .frow{display:grid;grid-template-columns:108px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}
  .frow .k{font-family:var(--mono);color:var(--dim);font-size:11px;letter-spacing:.03em;text-transform:uppercase}
  .frow .v{color:var(--mut);line-height:1.5}.frow .v code{font-family:var(--mono);color:var(--acc);font-size:12.5px}
  .verdict{display:inline-flex;align-items:center;gap:7px;color:var(--acc);font-family:var(--mono);font-size:12px}
  .verdict .c{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--acc);display:grid;place-items:center;font-size:9px}
  @media(max-width:860px){.rep{grid-template-columns:1fr;gap:32px}}

  /* PRICING */
  .prices{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
  .price{border:1px solid var(--line);border-radius:18px;padding:30px;background:var(--bg2)}
  .price.hi{border-color:var(--acc-dim);background:linear-gradient(165deg,rgba(79,240,163,.07),transparent 60%),var(--bg2);position:relative}
  .price.hi::before{content:attr(data-badge);position:absolute;top:-11px;left:30px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:#04140c;background:var(--acc);padding:4px 12px;border-radius:100px;font-weight:600}
  .price .pn{font-size:15px;color:var(--mut);margin-bottom:12px;font-weight:550}
  .price .pp{font-size:36px;letter-spacing:-.02em;font-weight:600;margin-bottom:5px;font-family:var(--mono)}
  .price .pp small{font-size:15px;color:var(--dim);font-weight:400;font-family:var(--sans)}
  .price .pd{font-size:13.5px;color:var(--dim);margin-bottom:24px;min-height:40px}
  .price ul{list-style:none;display:grid;gap:12px;margin-bottom:28px}
  .price li{display:grid;grid-template-columns:18px 1fr;gap:10px;font-size:13.5px;color:var(--mut);line-height:1.45}
  .price li .tk{color:var(--acc);font-family:var(--mono);font-size:13px}
  .price .btn{width:100%}
  @media(max-width:820px){.prices{grid-template-columns:1fr}}

  /* FINAL + FOOTER */
  .final{text-align:center;padding:110px 0}
  .final h2{margin:0 auto;max-width:22ch}
  .final .lead{margin:20px auto 36px}.final .cta-row{justify-content:center}
  footer{border-top:1px solid var(--line);padding:44px 0;color:var(--dim);font-size:13.5px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
  .foot .logo{font-size:16px}

  /* reveal */
  .rv{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}
  .rv.in{opacity:1;transform:none}
  @media(prefers-reduced-motion:reduce){
    .rv{opacity:1;transform:none;transition:none}
    .arow.run .chip,.tile{animation:none;opacity:1;transform:none}
    html{scroll-behavior:auto}
  }
`;

// --- Scanner + heatmap (visuel produit reel du hero) ---
const SCAN_IDS = ["security", "infra", "deps", "data", "perf", "seo", "a11y", "legal", "cro"];
const SCAN_COUNTS = [2, 1, 3, 0, 2, 1, 4, 1, 0];
// Etat des 15 tuiles de la heatmap de risque (ordre = les 15 domaines).
const TILES = ["ok", "hit", "crit", "ok", "hit", "ok", "ok", "ok", "hit", "ok", "hit", "ok", "ok", "crit", "ok"];

function scannerJS(lang) {
  const short = SCAN_IDS.map((id) => AGENT_TX[lang][id][0].split(" / ")[0]);
  const one = { fr: "finding", en: "finding", de: "Finding", es: "finding", it: "finding", nl: "finding" }[lang];
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
function run(){rows.forEach(r=>{r.className="arow";r.querySelector(".cnt").textContent="";});shown=0;setScore();let i=0;const step=()=>{if(i>0)fin(i-1);if(i>=rows.length){setTimeout(run,2800);return;}rows[i].classList.add("run");i++;setTimeout(step,520);};setTimeout(step,400);}
if(reduce){shown=0;rows.forEach((r,k)=>{r.className="arow";fin(k);});}else{run();}
const rv=[...document.querySelectorAll(".rv:not(.in)")];
if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.06,rootMargin:"0px 0px -4% 0px"});rv.forEach(e=>io.observe(e));setTimeout(()=>rv.forEach(e=>e.classList.add("in")),1000);}else{rv.forEach(e=>e.classList.add("in"));}
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
  const t = { ...T[lang], ...EXTRA[lang] };
  const self = LANGS.find((l) => l.code === lang);
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l.htmllang}" href="${SITE}/${l.path}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;

  const stats = t.band.map(([b, p]) => `<div><b${b === "15" || b === "100%" ? ' class="acc"' : ""}>${b}</b><span>${p}</span></div>`).join("");
  const tiles = TILES.map((s, i) => `<span class="tile ${s}" style="animation-delay:${1.2 + i * 0.05}s"></span>`).join("");
  const steps = t.steps.map((s, i) => `<div class="step rv"><div class="no">${String(i + 1).padStart(2, "0")}</div><div><h4>${esc(s[0])}</h4><p>${esc(s[1])}</p><span class="tag">${esc(s[2])}</span></div></div>`).join("");
  const diffsSmall = t.diffs.slice(1).map((d, i) => `<div class="diff"><div class="ic">0${i + 2}</div><h4>${esc(d[0])}</h4><p>${esc(d[1])}</p></div>`).join("");
  const findRows = t.findRows.map((r) => `<div class="frow"><div class="k">${esc(r[0])}</div><div class="v">${r[1]}</div></div>`).join("");
  const prices = t.prices.map((p, i) => {
    const feats = p[4].map((x) => `<li><span class="tk">&#10003;</span>${esc(x)}</li>`).join("");
    const hi = i === 1;
    const href = i === 0 ? "/console/" : RENDER;
    return `<div class="price${hi ? " hi" : ""}"${hi ? ` data-badge="${esc(t.priceBadge)}"` : ""}><div class="pn">${esc(p[0])}</div><div class="pp">${p[1]}${p[2] ? ` <small>${esc(p[2])}</small>` : ""}</div><div class="pd">${esc(p[3])}</div><ul>${feats}</ul><a class="btn ${hi ? "btn-p" : "btn-g"}" href="${href}">${esc(p[5])}</a></div>`;
  }).join("");
  const tools = ["SEMrush", "Ahrefs", "Snyk", "Lighthouse", "OWASP ZAP", "Screaming Frog"].map((x) => `<span class="tool">${x}</span>`).join("") + `<span class="tool us">Panoptic</span>`;

  return `<!DOCTYPE html>
<html lang="${self.htmllang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t.metaTitle)}</title>
<meta name="description" content="${esc(t.metaDesc)}">
<link rel="canonical" href="${SITE}/${self.path}">
${alt}
<meta property="og:title" content="${esc(t.ogTitle)}">
<meta property="og:description" content="${esc(t.ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${self.htmllang}">
<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<div class="grid-bg"></div>
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
      <span class="cli"><span class="p">$</span> ${esc(t.scanUrl)}</span>
      <h1>${esc(t.heroH1[0])}<br>${esc(t.heroH1[1])}<br><em>${esc(t.heroH1[2])}</em></h1>
      <p class="sub">${esc(t.heroSub)}</p>
      <div class="cta-row">
        <a class="btn btn-p btn-lg" href="/console/">${esc(t.heroCta1)}</a>
        <a class="btn btn-g btn-lg" href="#report">${esc(t.heroCta2)}</a>
      </div>
    </div>
    <div class="panel rv in" aria-hidden="true">
      <div class="ptop"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="purl mono">${esc(t.scanUrl)}</span></div>
      <div class="pbody" id="scanRows"></div>
      <div class="pmap">${tiles}</div>
      <div class="pmap-l"><span><b>15</b> ${esc(t.famUnit)}</span><span><b class="acc">&#9632;</b> ok</span><span><b style="color:var(--high)">&#9632;</b> findings</span><span><b style="color:var(--crit)">&#9632;</b> critique</span></div>
      <div class="pfoot"><div class="score"><b id="scoreNum">0</b><span>${t.scoreLabel}</span></div><div class="prog"><i id="prog"></i></div></div>
    </div>
  </header>

  <div class="proof rv">
    <p>${t.proofLine.replace(/(15 domaines|15 domains|15 Domanen|15 dominios|15 domini|15 domeinen)/, "<b>$1</b>")}</p>
    <div class="stats">${stats}</div>
  </div>

  <section class="prob rv">
    <h2>${esc(t.problemH2)}</h2>
    <p class="lead">${esc(t.problemLead)}</p>
    <div class="tools">${tools}</div>
  </section>

  <section id="pipe">
    <div class="shead rv"><h2>${esc(t.pipeH2)}</h2><p class="lead">${esc(t.pipeLead)}</p></div>
    <div class="pipe">${steps}</div>
  </section>

  <section id="agents">
    <div class="shead rv"><div class="eyebrow">${esc(t.agentsEye)}</div><h2>${esc(t.agentsH2)}</h2><p class="lead">${esc(t.agentsLead)}</p></div>
    ${agentsHTML(lang)}
  </section>

  <section id="diff">
    <div class="shead rv"><h2>${esc(t.diffH2)}</h2><p class="lead">${esc(t.diffLead)}</p></div>
    <div class="diffs rv">
      <div class="diff big"><div class="ic">${esc(t.diffBigLabel)}</div><h4>${esc(t.diffs[0][0])}</h4><p>${esc(t.diffs[0][1])}</p></div>
      ${diffsSmall}
    </div>
  </section>

  <section id="report">
    <div class="rep">
      <div class="rv"><div class="eyebrow">${esc(t.reportEye)}</div><h2>${esc(t.reportH2)}</h2><p class="lead">${esc(t.reportLead)}</p>
        <div class="cta-row" style="margin-top:28px"><a class="btn btn-g btn-lg" href="${RENDER}api/audits/aud_mrrxfh7nqpkzxg/report" target="_blank" rel="noopener">${esc(t.seeReport)}</a></div>
      </div>
      <div class="fcard rv">
        <div class="fh"><span class="sev">${esc(t.findSev)}</span><span>SEC-014 &middot; ${esc(AGENT_TX[lang].security[0])}</span><span style="margin-left:auto;color:var(--dim)">CVSS 9.1</span></div>
        <div class="fb"><h4>${esc(t.findTitle)}</h4>${findRows}</div>
      </div>
    </div>
  </section>

  <section id="prix">
    <div class="shead rv"><h2>${esc(t.priceH2)}</h2></div>
    <div class="prices rv">${prices}</div>
  </section>

  <section class="final rv">
    <h2>${esc(t.finalH2)}</h2>
    <p class="lead">${esc(t.finalLead)}</p>
    <div class="cta-row"><a class="btn btn-p btn-lg" href="/console/">${esc(t.finalCta1)}</a><a class="btn btn-g btn-lg" href="#report">${esc(t.finalCta2)}</a></div>
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
console.log(`\n${n} pages generees. Racine = FR (x-default). Copier fonts/ dans public/fonts/ au deploiement.`);
