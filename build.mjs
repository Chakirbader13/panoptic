// Panoptic - generateur statique multilingue (refonte 2026-07).
// Rend 6 pages completes (contenu bake dans le HTML pour le SEO), hreflang, <html lang>.
// Police Geist auto-hebergee (zero requete externe). Dark obsidienne, accent vert verrouille.
//   node build.mjs   ->  index.html (fr, x-default) + en/ de/ es/ it/ nl/
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, LANGS, AGENTS, FAM_ORDER, AGENT_TX, T } from "./src/i18n.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RENDER = "https://panoptic-audit.onrender.com/"; // serveur complet (offre code+prod)
const REPORT_URL = RENDER + "api/audits/aud_mrrxfh7nqpkzxg/report";
const esc = (s) => String(s).replace(/&(?![a-z#])/g, "&amp;").replace(/</g, "&lt;");
const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&hellip;/g, "...").replace(/&euro;/g, "EUR").replace(/&middot;/g, "-").replace(/&rarr;/g, "->").replace(/&#10003;/g, "");

const CSS = `
  @font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  @font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  :root{
    --bg:#070a08;--bg2:#0c0f0d;--panel:#0f1310;--line:#1b221d;--line2:#27302a;
    --ink:#f2f5f2;--mut:#a4aea7;--dim:#7e8a81;
    --acc:#4ff0a3;--acc2:#2fd88a;--acc-dim:#1e6b47;--acc-ghost:rgba(79,240,163,.08);
    --crit:#ff5d5d;--high:#ffa53d;
    --sans:Geist,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
    --mx:1200px;--pad:24px;--r:16px}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;
    -webkit-font-smoothing:antialiased;overflow-x:hidden;font-feature-settings:"ss01","cv01"}
  ::selection{background:var(--acc);color:#04140c}
  a{color:inherit;text-decoration:none}
  a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:4px}
  .mono{font-family:var(--mono)}
  .acc{color:var(--acc)}
  .wrap{max-width:var(--mx);margin:0 auto;padding:0 var(--pad)}
  .skip{position:absolute;left:-9999px;top:0;z-index:100;background:var(--acc);color:#04140c;
    padding:10px 18px;border-radius:0 0 10px 0;font-weight:600;font-size:14px}
  .skip:focus{left:0}
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
  nav{position:sticky;top:0;z-index:60;backdrop-filter:blur(16px);background:rgba(7,10,8,.74);
    border-bottom:1px solid var(--line)}
  .nav{display:flex;align-items:center;gap:16px;height:68px}
  .logo{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.02em;font-size:18px;flex:none}
  .eye{width:24px;height:24px;border-radius:50%;border:2px solid var(--acc);display:grid;place-items:center;position:relative;flex:none}
  .eye::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--acc)}
  .nlinks{display:flex;gap:28px;align-items:center;font-size:14.5px;color:var(--mut);margin-left:auto}
  .nlinks a{transition:color .2s}.nlinks a:hover{color:var(--ink)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:560;font-size:14.5px;
    padding:11px 20px;border-radius:100px;transition:transform .15s,background .2s,border-color .2s,box-shadow .2s;
    cursor:pointer;border:1px solid transparent;white-space:nowrap;font-family:var(--sans)}
  .btn:active{transform:translateY(1px) scale(.99)}
  .btn-p{background:var(--acc);color:#04140c;font-weight:640}
  .btn-p:hover{background:#63f4b1;box-shadow:0 0 0 4px var(--acc-ghost);transform:translateY(-1px)}
  .btn-g{border-color:var(--line2);color:var(--ink)}
  .btn-g:hover{border-color:var(--acc-dim);background:rgba(255,255,255,.03);transform:translateY(-1px)}
  .langsel{position:relative;flex:none}
  .langsel summary{list-style:none;cursor:pointer;font-family:var(--mono);font-size:13px;color:var(--mut);
    border:1px solid var(--line2);border-radius:100px;padding:8px 13px;display:flex;align-items:center;gap:7px}
  .langsel summary::-webkit-details-marker{display:none}
  .langsel summary:hover{border-color:var(--acc-dim);color:var(--ink)}
  .langsel summary .car{font-size:9px;color:var(--dim)}
  .langmenu{position:absolute;top:calc(100% + 8px);right:0;background:var(--panel);border:1px solid var(--line2);
    border-radius:12px;padding:6px;min-width:176px;box-shadow:0 24px 60px -18px rgba(0,0,0,.7)}
  .langmenu a{display:flex;justify-content:space-between;gap:14px;padding:9px 12px;border-radius:8px;font-size:14px;
    color:var(--mut);transition:background .15s,color .15s}
  .langmenu a:hover{background:var(--acc-ghost);color:var(--ink)}
  .langmenu a.on{color:var(--acc)}
  .langmenu a small{font-family:var(--mono);font-size:11px;color:var(--dim)}
  @media(max-width:960px){.nlinks{display:none}}

  /* HERO */
  .hero{display:grid;grid-template-columns:1.06fr .94fr;gap:56px;align-items:center;
    min-height:calc(100dvh - 68px);padding:36px 0 72px}
  .cli{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:13px;color:var(--mut);
    border:1px solid var(--line2);border-radius:100px;padding:8px 15px;margin-bottom:28px}
  .cli .p{color:var(--acc)}
  h1{font-size:clamp(44px,6.2vw,84px);line-height:.98;letter-spacing:-.045em;font-weight:640;margin-bottom:26px}
  h1 em{font-style:normal;color:var(--acc)}
  .sub{font-size:clamp(17px,1.6vw,20px);color:var(--mut);max-width:46ch;margin-bottom:36px;line-height:1.55}
  .cta-row{display:flex;gap:13px;flex-wrap:wrap}
  .btn-lg{padding:16px 28px;font-size:15.5px}
  @media(max-width:960px){.hero{grid-template-columns:1fr;gap:42px;min-height:0;padding-top:40px}h1{font-size:clamp(38px,10.5vw,56px)}}

  /* HERO PANEL (scanner + heatmap, reflet du produit reel) */
  .panel{border:1px solid var(--line2);border-radius:20px;overflow:hidden;position:relative;
    background:linear-gradient(180deg,#0e1310,#0a0d0b);
    box-shadow:0 40px 90px -40px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.03)}
  .panel::before{content:"";position:absolute;inset:0;border-radius:20px;padding:1px;pointer-events:none;
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
  .pmap-l{padding:2px 16px 12px;font-family:var(--mono);font-size:11px;color:var(--dim);display:flex;gap:14px}
  .pmap-l b{color:var(--mut)}
  .pfoot{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid var(--line)}
  .score{display:flex;align-items:baseline;gap:9px}
  .score b{font-family:var(--mono);font-size:34px;color:var(--acc);letter-spacing:-.03em;font-weight:600}
  .score span{font-size:12.5px;color:var(--dim)}
  .prog{height:4px;background:var(--line);border-radius:2px;flex:1;margin-left:22px;overflow:hidden}
  .prog i{display:block;height:100%;width:0;background:var(--acc);transition:width .5s}

  /* PROOF BAND */
  .proof{margin:6px 0 22px;padding:28px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .proof p{color:var(--mut);font-size:15px;max-width:64ch;margin-bottom:24px}
  .proof p b{color:var(--ink);font-weight:560}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line)}
  .stats>div{background:var(--bg);padding:4px 22px 4px 0}
  .stats b{display:block;font-family:var(--mono);font-size:25px;letter-spacing:-.02em;margin-bottom:6px}
  .stats span{font-size:13px;color:var(--mut)}
  @media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr);gap:22px 0}.stats>div{padding-right:12px}}

  /* SECTIONS */
  section{padding:96px 0}
  .shead{margin-bottom:48px;max-width:72ch}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin-bottom:15px}
  h2{font-size:clamp(31px,4.3vw,50px);line-height:1.04;letter-spacing:-.033em;font-weight:620;max-width:21ch}
  .lead{font-size:17.5px;color:var(--mut);max-width:64ch;margin-top:18px;line-height:1.6}

  /* PROBLEM */
  .prob{text-align:center;max-width:860px;margin:0 auto}
  .prob h2{margin:0 auto;max-width:23ch}.prob .lead{margin:18px auto 0}
  .tools{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:36px}
  .tool{font-family:var(--mono);font-size:13px;color:var(--mut);border:1px solid var(--line);border-radius:100px;padding:8px 15px}
  .tool.us{color:#04140c;background:var(--acc);border-color:var(--acc);font-weight:600}

  /* PIPELINE - rail choregraphies au scroll: segments qui se remplissent, etape active qui "ping" */
  .pipe{display:grid;gap:0;position:relative;margin-left:8px;max-width:900px}
  .pipe::before{content:"";position:absolute;left:27px;top:26px;bottom:26px;width:2px;background:var(--line)}
  .step{display:grid;grid-template-columns:56px 1fr;gap:30px;padding:30px 0;position:relative}
  .step::before{content:"";position:absolute;left:27px;top:0;bottom:0;width:2px;
    background:linear-gradient(var(--acc),var(--acc2));transform:scaleY(0);transform-origin:top;
    transition:transform .7s cubic-bezier(.16,1,.3,1)}
  .step.on::before{transform:scaleY(1)}
  .step .no{width:56px;height:56px;border-radius:14px;border:1px solid var(--line2);background:var(--panel);
    display:grid;place-items:center;font-family:var(--mono);font-size:17px;color:var(--dim);z-index:1;position:relative;
    transition:background .45s,color .45s,border-color .45s,transform .45s,box-shadow .45s}
  .step.on .no{background:var(--acc);border-color:var(--acc);color:#04140c;font-weight:700;transform:scale(1.06);
    box-shadow:0 0 0 5px var(--acc-ghost),0 14px 34px -14px rgba(79,240,163,.45)}
  .step.cur .no::after{content:"";position:absolute;inset:-7px;border-radius:19px;border:1.5px solid var(--acc);
    animation:ping 1.8s cubic-bezier(.16,1,.3,1) infinite}
  @keyframes ping{0%{transform:scale(.82);opacity:.9}80%,100%{transform:scale(1.3);opacity:0}}
  .step h3{font-size:23px;letter-spacing:-.018em;margin-bottom:8px;font-weight:600;transition:color .45s}
  .step p{font-size:15.5px;color:var(--mut);max-width:62ch}
  .step .tag{font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:100px;padding:4px 12px;margin-top:12px;display:inline-block;transition:border-color .45s,color .45s}
  .step.on .tag{border-color:var(--acc-dim);color:var(--acc)}
  body.js .step>div{opacity:.32;transform:translateX(14px);transition:opacity .6s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1)}
  body.js .step.on>div{opacity:1;transform:none}
  @media(max-width:560px){.step{grid-template-columns:44px 1fr;gap:18px;padding:24px 0}
    .step .no{width:44px;height:44px;border-radius:11px;font-size:14px}
    .pipe::before,.step::before{left:21px}.step.cur .no::after{border-radius:15px}
    .step h3{font-size:19px}}

  /* AGENTS - grille de couverture unifiee */
  .cov{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .cov-h{grid-column:1/-1;display:flex;align-items:center;gap:14px;margin:22px 0 4px}
  .cov-h:first-child{margin-top:0}
  .cov-h h3{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);font-weight:560}
  .cov-h .ln{flex:1;height:1px;background:var(--line)}
  .cov-h .ct{font-family:var(--mono);font-size:12px;color:var(--dim)}
  .cv{border:1px solid var(--line);border-radius:14px;padding:19px 20px;background:linear-gradient(180deg,var(--bg2),var(--bg));
    transition:border-color .25s,transform .25s,box-shadow .25s}
  .cv:hover{border-color:var(--acc-dim);transform:translateY(-3px);box-shadow:0 20px 40px -24px rgba(0,0,0,.8)}
  .cv .top{display:flex;align-items:baseline;gap:10px;margin-bottom:7px}
  .cv .num{font-family:var(--mono);font-size:11.5px;color:var(--acc)}
  .cv h4{font-size:16px;letter-spacing:-.01em;font-weight:560}
  .cv p{font-size:13.5px;color:var(--mut);line-height:1.5;margin-bottom:13px}
  .fw{display:flex;flex-wrap:wrap;gap:6px}
  .fw span{font-family:var(--mono);font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:6px;padding:3px 8px}
  @media(max-width:900px){.cov{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.cov{grid-template-columns:1fr}}

  /* DIFFS (bento) */
  .diffs{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:14px}
  .diff{border:1px solid var(--line);border-radius:var(--r);padding:28px;background:var(--bg2);transition:border-color .25s,transform .25s}
  .diff:hover{border-color:var(--acc-dim);transform:translateY(-3px)}
  .diff.big{grid-row:span 2;background:linear-gradient(155deg,rgba(79,240,163,.08),transparent 55%),var(--bg2);border-color:var(--acc-dim);
    display:flex;flex-direction:column;justify-content:center}
  .diff.tint{background:linear-gradient(200deg,rgba(79,240,163,.05),transparent 60%),var(--bg2)}
  .diff h3{font-size:18px;letter-spacing:-.01em;margin-bottom:10px;font-weight:560}
  .diff.big h3{font-size:26px;letter-spacing:-.02em;max-width:16ch}
  .diff p{font-size:14px;color:var(--mut);line-height:1.55}.diff.big p{font-size:16px;max-width:52ch}
  @media(max-width:840px){.diffs{grid-template-columns:1fr 1fr}.diff.big{grid-column:span 2;grid-row:auto}}
  @media(max-width:560px){.diffs{grid-template-columns:1fr}.diff.big{grid-column:auto}}

  /* REPORT / FINDING */
  .rep{display:grid;grid-template-columns:1fr 1.1fr;gap:56px;align-items:center}
  .fcard{border:1px solid var(--line2);border-radius:var(--r);background:linear-gradient(180deg,#0e1310,#0a0d0b);overflow:hidden;
    font-size:14px;box-shadow:0 36px 80px -44px rgba(0,0,0,.85)}
  .fcard .fh{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--mut)}
  .sev{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:6px;color:var(--crit);background:rgba(255,93,93,.12);border:1px solid rgba(255,93,93,.3)}
  .fcard .fb{padding:20px}
  .fcard h3{font-size:17px;letter-spacing:-.01em;margin-bottom:16px;font-family:var(--sans);color:var(--ink);font-weight:560}
  .frow{display:grid;grid-template-columns:112px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}
  .frow .k{font-family:var(--mono);color:var(--dim);font-size:11px;letter-spacing:.03em;text-transform:uppercase}
  .frow .v{color:var(--mut);line-height:1.5}.frow .v code{font-family:var(--mono);color:var(--acc);font-size:12.5px}
  .verdict{display:inline-flex;align-items:center;gap:7px;color:var(--acc);font-family:var(--mono);font-size:12px}
  .verdict .c{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--acc);display:grid;place-items:center;font-size:9px}
  .fex{font-family:var(--mono);font-size:11px;color:var(--dim);margin-left:auto}
  @media(max-width:880px){.rep{grid-template-columns:1fr;gap:34px}}

  /* BENCHMARK */
  .bench{border:1px solid var(--acc-dim);border-radius:22px;padding:clamp(32px,5vw,60px);
    background:radial-gradient(900px 420px at 12% -20%,rgba(79,240,163,.10),transparent 60%),var(--bg2);
    display:grid;grid-template-columns:1.1fr .9fr;gap:44px;align-items:center}
  .bench h2{max-width:14ch}
  .bench .lead{margin-top:16px}
  .bench .cta-row{margin-top:30px}
  .bstats{display:grid;gap:0}
  .bstats>div{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:baseline;padding:18px 0;border-top:1px solid var(--line2)}
  .bstats>div:first-child{border-top:0}
  .bstats b{font-family:var(--mono);font-size:clamp(34px,4vw,52px);letter-spacing:-.03em;color:var(--acc);font-weight:600;min-width:2ch}
  .bstats span{font-size:14.5px;color:var(--mut);line-height:1.45}
  @media(max-width:840px){.bench{grid-template-columns:1fr;gap:24px}}

  /* PRICING */
  .prices{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start;margin-top:8px}
  .price{border:1px solid var(--line);border-radius:18px;padding:30px;background:var(--bg2);transition:border-color .25s,transform .25s}
  .price:hover{border-color:var(--line2);transform:translateY(-3px)}
  .price.hi{border-color:var(--acc-dim);background:linear-gradient(165deg,rgba(79,240,163,.07),transparent 60%),var(--bg2);position:relative}
  .price.hi:hover{border-color:var(--acc2)}
  .price.hi::before{content:attr(data-badge);position:absolute;top:-11px;left:30px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:#04140c;background:var(--acc);padding:4px 12px;border-radius:100px;font-weight:600}
  .price .pn{font-size:15px;color:var(--mut);margin-bottom:12px;font-weight:560}
  .price .pp{font-size:36px;letter-spacing:-.02em;font-weight:600;margin-bottom:5px;font-family:var(--mono)}
  .price .pp small{font-size:15px;color:var(--dim);font-weight:400;font-family:var(--sans)}
  .price .pd{font-size:13.5px;color:var(--mut);margin-bottom:24px;min-height:40px}
  .price ul{list-style:none;display:grid;gap:12px;margin-bottom:28px}
  .price li{display:grid;grid-template-columns:18px 1fr;gap:10px;font-size:13.5px;color:var(--mut);line-height:1.45}
  .price li .tk{color:var(--acc);font-family:var(--mono);font-size:13px}
  .price .btn{width:100%}
  @media(max-width:840px){.prices{grid-template-columns:1fr}}

  /* FAQ - split sticky + cartes accordeon exclusives */
  :root{interpolate-size:allow-keywords}
  .faqwrap{display:grid;grid-template-columns:.85fr 1.15fr;gap:64px;align-items:start}
  .faqhead{position:sticky;top:110px}
  .faqhead .lead{margin-top:16px}
  .faqhead .cta-row{margin-top:30px}
  .qa{border:1px solid var(--line);border-radius:16px;background:var(--bg2);margin-bottom:12px;overflow:hidden;
    transition:border-color .3s,transform .3s,background .3s}
  .qa:hover{border-color:var(--line2);transform:translateY(-2px)}
  .qa[open]{border-color:var(--acc-dim);background:linear-gradient(165deg,rgba(79,240,163,.06),transparent 55%),var(--bg2);transform:none}
  .qa summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;
    padding:20px 22px;font-size:16.5px;font-weight:560;letter-spacing:-.01em}
  .qa summary::-webkit-details-marker{display:none}
  .qa summary:hover .qq{color:var(--acc)}
  .qq{transition:color .25s}
  .qa[open] .qq{color:var(--ink)}
  .qtag{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);
    border:1px solid var(--line);border-radius:100px;padding:4px 11px;white-space:nowrap;transition:color .3s,border-color .3s}
  .qa[open] .qtag{color:var(--acc);border-color:var(--acc-dim)}
  .pm{width:30px;height:30px;border-radius:50%;border:1px solid var(--line2);display:grid;place-items:center;
    color:var(--mut);font-family:var(--mono);font-size:16px;line-height:1;flex:none;
    transition:transform .35s cubic-bezier(.16,1,.3,1),background .3s,color .3s,border-color .3s}
  .qa[open] .pm{transform:rotate(45deg);background:var(--acc);border-color:var(--acc);color:#04140c}
  .qa::details-content{block-size:0;overflow:clip;
    transition:block-size .45s cubic-bezier(.16,1,.3,1),content-visibility .45s allow-discrete}
  .qa[open]::details-content{block-size:auto}
  .qa .ans{margin:0 22px;padding:16px 0 22px;border-top:1px solid var(--line);font-size:15px;color:var(--mut);line-height:1.65;max-width:58ch}
  @media(max-width:880px){.faqwrap{grid-template-columns:1fr;gap:34px}.faqhead{position:static}}
  @media(max-width:560px){.qa summary{grid-template-columns:1fr auto;padding:17px 18px}.qtag{display:none}.qa .ans{margin:0 18px}}

  /* FINAL + FOOTER */
  .final{text-align:center;padding:116px 0}
  .final h2{margin:0 auto;max-width:22ch;font-size:clamp(34px,4.8vw,56px)}
  .final .lead{margin:20px auto 38px}.final .cta-row{justify-content:center}
  footer{border-top:1px solid var(--line);padding:48px 0 40px;color:var(--dim);font-size:13.5px}
  .foot{display:grid;grid-template-columns:1.4fr 1fr;gap:32px;align-items:start}
  .foot .logo{font-size:16px;color:var(--ink);margin-bottom:12px}
  .foot .tag{max-width:44ch;line-height:1.55}
  .flinks{display:flex;gap:26px;justify-content:flex-end;flex-wrap:wrap}
  .flinks a{color:var(--mut);transition:color .2s}.flinks a:hover{color:var(--acc)}
  .fbot{grid-column:1/-1;display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding-top:22px;margin-top:8px;flex-wrap:wrap}
  @media(max-width:720px){.foot{grid-template-columns:1fr}.flinks{justify-content:flex-start}}

  /* reveal */
  .rv{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}
  .rv.in{opacity:1;transform:none}
  @media(prefers-reduced-motion:reduce){
    .rv{opacity:1;transform:none;transition:none}
    .arow.run .chip,.tile{animation:none;opacity:1;transform:none}
    .btn,.cv,.diff,.price{transition:none}
    .step::before,.step .no,.step .tag,body.js .step>div{transition:none}
    .qa,.qa .pm,.qa .qtag,.qa .qq{transition:none}
    .qa::details-content{transition:none}
    .step.cur .no::after{animation:none;display:none}
    body.js .step>div{opacity:1;transform:none}
    html{scroll-behavior:auto}
  }
`;

// --- Scanner + heatmap (visuel produit reel du hero) ---
const SCAN_IDS = ["security", "infra", "deps", "data", "perf", "seo", "a11y", "legal", "cro"];
const SCAN_COUNTS = [2, 1, 3, 0, 2, 1, 4, 1, 0];
// Etat des 15 tuiles de la heatmap de risque (ordre = les 15 domaines).
const TILES = ["ok", "hit", "crit", "ok", "hit", "ok", "ok", "ok", "hit", "ok", "hit", "ok", "ok", "crit", "ok"];
// Legende heatmap: [constats, critique] par langue.
const LEGEND = {
  fr: ["constats", "critique"], en: ["findings", "critical"], de: ["Findings", "kritisch"],
  es: ["hallazgos", "crítico"], it: ["rilievi", "critico"], nl: ["bevindingen", "kritiek"],
};

function scannerJS(lang) {
  const short = SCAN_IDS.map((id) => AGENT_TX[lang][id][0].split(" / ")[0]);
  const one = { fr: "constat", en: "finding", de: "Finding", es: "hallazgo", it: "rilievo", nl: "bevinding" }[lang];
  const many = { fr: "constats", en: "findings", de: "Findings", es: "hallazgos", it: "rilievi", nl: "bevindingen" }[lang];
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
function fin(i){const r=rows[i],c=list[i][1];r.classList.remove("run");r.classList.add("done");if(c===0)r.classList.add("clean");r.querySelector(".cnt").textContent=c?(c+" "+(c>1?${JSON.stringify(many)}:${JSON.stringify(one)})):${JSON.stringify(cleanWord)};shown+=c;setScore();}
function run(){rows.forEach(r=>{r.className="arow";r.querySelector(".cnt").textContent="";});shown=0;setScore();let i=0;const step=()=>{if(i>0)fin(i-1);if(i>=rows.length){setTimeout(run,2800);return;}rows[i].classList.add("run");i++;setTimeout(step,520);};setTimeout(step,400);}
if(reduce){shown=0;rows.forEach((r,k)=>{r.className="arow";fin(k);});}else{run();}
const rv=[...document.querySelectorAll(".rv:not(.in)")];
if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.06,rootMargin:"0px 0px -4% 0px"});rv.forEach(e=>io.observe(e));setTimeout(()=>rv.forEach(e=>e.classList.add("in")),1000);}else{rv.forEach(e=>e.classList.add("in"));}
document.body.classList.add("js");
const steps=[...document.querySelectorAll(".pipe .step")];
function allOn(){steps.forEach(s=>s.classList.add("on"));}
if(steps.length){
  if(reduce||!("IntersectionObserver" in window)){allOn();}
  else{
    const so=new IntersectionObserver(es=>{
      es.forEach(e=>{
        const s=e.target,i=steps.indexOf(s);
        if(e.isIntersecting){s.classList.add("on");steps.forEach(x=>x.classList.toggle("cur",x===s));}
        else if(e.boundingClientRect.top>0){
          s.classList.remove("on");
          if(s.classList.contains("cur")){s.classList.remove("cur");const p=steps[i-1];if(p&&p.classList.contains("on"))p.classList.add("cur");}
        }
      });
    },{rootMargin:"-36% 0px -36% 0px",threshold:0});
    steps.forEach(s=>so.observe(s));
    setTimeout(()=>{if(!steps.some(x=>x.classList.contains("on"))&&steps[0].getBoundingClientRect().top<innerHeight*.64)steps[0].classList.add("on","cur");},900);
  }
}
`;
}

// Grille de couverture unifiee: 4 intercalaires de famille + 15 tuiles compactes.
function agentsHTML(lang, t) {
  return FAM_ORDER.map((f) => {
    const list = AGENTS.filter((a) => a.fam === f.k);
    const cards = list.map((a) => {
      const [name, mission] = AGENT_TX[lang][a.id];
      return `<div class="cv"><div class="top"><span class="num">A${String(a.n).padStart(2, "0")}</span><h4>${esc(name)}</h4></div><p>${esc(mission)}</p><div class="fw">${a.fw.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
    }).join("");
    return `<div class="cov-h"><h3>${esc(t.famLabel[f.k])}</h3><span class="ln"></span><span class="ct">${String(list.length).padStart(2, "0")} ${esc(t.famUnit)}</span></div>${cards}`;
  }).join("");
}

function langSwitcher(cur, label) {
  const items = LANGS.map((l) => `<a href="/${l.path}"${l.code === cur ? ' class="on"' : ""} hreflang="${l.htmllang}" lang="${l.htmllang}">${esc(l.name)}<small>${l.code.toUpperCase()}</small></a>`).join("");
  return `<details class="langsel"><summary aria-label="${esc(label)}">${cur.toUpperCase()}<span class="car" aria-hidden="true">&#9662;</span></summary><div class="langmenu">${items}</div></details>`;
}

function jsonLd(t, self) {
  const app = {
    "@context": "https://schema.org", "@type": "SoftwareApplication",
    name: "Panoptic", applicationCategory: "DeveloperApplication",
    operatingSystem: "Web", url: SITE + "/" + self.path,
    description: plain(t.metaDesc), inLanguage: self.htmllang,
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "EUR", name: plain(t.prices[0][0]) },
      { "@type": "Offer", price: "490", priceCurrency: "EUR", name: plain(t.prices[1][0]) },
      { "@type": "Offer", price: "190", priceCurrency: "EUR", name: plain(t.prices[2][0]) },
    ],
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: t.faqs.map(([q, a]) => ({
      "@type": "Question", name: plain(q),
      acceptedAnswer: { "@type": "Answer", text: plain(a) },
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(app)}</script>\n<script type="application/ld+json">${JSON.stringify(faq)}</script>`;
}

function render(lang) {
  const t = T[lang];
  const self = LANGS.find((l) => l.code === lang);
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l.htmllang}" href="${SITE}/${l.path}">`).join("\n") +
    `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;

  const stats = t.band.map(([b, p], i) => `<div><b${i === 0 || i === 2 ? ' class="acc"' : ""}>${b}</b><span>${p}</span></div>`).join("");
  const tiles = TILES.map((s, i) => `<span class="tile ${s}" style="animation-delay:${1.2 + i * 0.05}s"></span>`).join("");
  const steps = t.steps.map((s, i) => `<div class="step rv"><div class="no" aria-hidden="true">${String(i + 1).padStart(2, "0")}</div><div><h3>${esc(s[0])}</h3><p>${esc(s[1])}</p><span class="tag">${esc(s[2])}</span></div></div>`).join("");
  const diffsSmall = t.diffs.slice(1).map((d, i) => `<div class="diff${i === 1 ? " tint" : ""}"><h3>${esc(d[0])}</h3><p>${esc(d[1])}</p></div>`).join("");
  const findRows = t.findRows.map((r) => `<div class="frow"><div class="k">${esc(r[0])}</div><div class="v">${r[1]}</div></div>`).join("");
  const bstats = t.benchStats.map(([b, p]) => `<div><b>${b}</b><span>${esc(p)}</span></div>`).join("");
  const faqs = t.faqs.map(([q, a], i) => `<details class="qa" name="faq"${i === 0 ? " open" : ""}><summary><span class="qtag">${esc(t.faqTags[i])}</span><span class="qq">${esc(q)}</span><span class="pm" aria-hidden="true">+</span></summary><div class="ans">${esc(a)}</div></details>`).join("");
  const prices = t.prices.map((p, i) => {
    const feats = p[4].map((x) => `<li><span class="tk" aria-hidden="true">&#10003;</span>${esc(x)}</li>`).join("");
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
${jsonLd(t, self)}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<div class="grid-bg" aria-hidden="true"></div>
<nav aria-label="Panoptic">
  <div class="wrap nav">
    <a class="logo" href="/${self.path}"><span class="eye" aria-hidden="true"></span>Panoptic</a>
    <div class="nlinks">
      <a href="#agents">${esc(t.nav[0])}</a>
      <a href="#pipe">${esc(t.nav[1])}</a>
      <a href="#diff">${esc(t.nav[2])}</a>
      <a href="#prix">${esc(t.nav[3])}</a>
    </div>
    ${langSwitcher(lang, t.langLabel)}
    <a class="btn btn-p" href="/console/">${esc(t.navCta)}</a>
  </div>
</nav>

<main class="wrap" id="main">
  <header class="hero">
    <div class="rv in">
      <span class="cli"><span class="p">$</span> ${esc(t.scanUrl)}</span>
      <h1>${esc(t.heroH1[0])}<br>${esc(t.heroH1[1])}<br><em>${esc(t.heroH1[2])}</em></h1>
      <p class="sub">${esc(t.heroSub)}</p>
      <div class="cta-row">
        <a class="btn btn-p btn-lg" href="/console/">${esc(t.navCta)}</a>
        <a class="btn btn-g btn-lg" href="#report">${esc(t.heroCta2)}</a>
      </div>
    </div>
    <div class="panel rv in" aria-hidden="true">
      <div class="ptop"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="purl mono">${esc(t.scanUrl)}</span></div>
      <div class="pbody" id="scanRows"></div>
      <div class="pmap">${tiles}</div>
      <div class="pmap-l"><span><b>15</b> ${esc(t.famUnit)}</span><span><b class="acc">&#9632;</b> ok</span><span><b style="color:var(--high)">&#9632;</b> ${esc(LEGEND[lang][0])}</span><span><b style="color:var(--crit)">&#9632;</b> ${esc(LEGEND[lang][1])}</span></div>
      <div class="pfoot"><div class="score"><b id="scoreNum">0</b><span>${t.scoreLabel}</span></div><div class="prog"><i id="prog"></i></div></div>
    </div>
  </header>

  <div class="proof rv">
    <p>${t.proofLine.replace(/(15 domaines|15 domains|15 Domänen|15 dominios|15 domini|15 domeinen)/, "<b>$1</b>")}</p>
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
    <div class="cov rv">${agentsHTML(lang, t)}</div>
  </section>

  <section id="diff">
    <div class="shead rv"><h2>${esc(t.diffH2)}</h2><p class="lead">${esc(t.diffLead)}</p></div>
    <div class="diffs rv">
      <div class="diff big"><h3>${esc(t.diffs[0][0])}</h3><p>${esc(t.diffs[0][1])}</p></div>
      ${diffsSmall}
    </div>
  </section>

  <section id="report">
    <div class="rep">
      <div class="rv"><div class="eyebrow">${esc(t.reportEye)}</div><h2>${esc(t.reportH2)}</h2><p class="lead">${esc(t.reportLead)}</p>
        <div class="cta-row" style="margin-top:28px"><a class="btn btn-g btn-lg" href="${REPORT_URL}" target="_blank" rel="noopener">${esc(t.seeReport)}</a></div>
      </div>
      <div class="fcard rv">
        <div class="fh"><span class="sev">${esc(t.findSev)}</span><span>SEC-014 &middot; ${esc(AGENT_TX[lang].security[0])}</span><span class="fex">${esc(t.findExample)}</span></div>
        <div class="fb"><h3>${esc(t.findTitle)}</h3>${findRows}</div>
      </div>
    </div>
  </section>

  <section id="bench">
    <div class="bench rv">
      <div><h2>${esc(t.benchH2)}</h2><p class="lead">${esc(t.benchLead)}</p>
        <div class="cta-row"><a class="btn btn-p btn-lg" href="/benchmark/">${esc(t.benchCta)}</a></div>
      </div>
      <div class="bstats">${bstats}</div>
    </div>
  </section>

  <section id="prix">
    <div class="shead rv"><h2>${esc(t.priceH2)}</h2><p class="lead">${esc(t.priceLead)}</p></div>
    <div class="prices rv">${prices}</div>
  </section>

  <section id="faq">
    <div class="faqwrap rv">
      <div class="faqhead"><h2>${esc(t.faqH2)}</h2><p class="lead">${esc(t.faqLead)}</p>
        <div class="cta-row"><a class="btn btn-p btn-lg" href="/console/">${esc(t.navCta)}</a></div>
      </div>
      <div>${faqs}</div>
    </div>
  </section>

  <section class="final rv">
    <h2>${esc(t.finalH2)}</h2>
    <p class="lead">${esc(t.finalLead)}</p>
    <div class="cta-row"><a class="btn btn-p btn-lg" href="/console/">${esc(t.navCta)}</a><a class="btn btn-g btn-lg" href="${REPORT_URL}" target="_blank" rel="noopener">${esc(t.heroCta2)}</a></div>
  </section>
</main>

<footer><div class="wrap foot">
  <div><a class="logo" href="/${self.path}"><span class="eye" aria-hidden="true"></span>Panoptic</a><p class="tag">${esc(t.footTag)}</p></div>
  <div class="flinks"><a href="/console/">${esc(t.footLinks[0])}</a><a href="/benchmark/">${esc(t.footLinks[1])}</a><a href="${REPORT_URL}" target="_blank" rel="noopener">${esc(t.footLinks[2])}</a></div>
  <div class="fbot"><span>&copy; 2026 Panoptic</span><span class="mono">code + prod</span></div>
</div></footer>
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
