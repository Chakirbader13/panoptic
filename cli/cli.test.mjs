// Test CLI + MCP: exit codes, sortie JSON, protocole MCP. Utilise un serveur HTTP local
// (pas de reseau externe) pour rester deterministe en CI.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "panoptic.mjs");
const MCP = join(HERE, "..", "mcp", "server.mjs");

// Site de test: 1 page avec des defauts nets (pas de h1, pas de CTA, pas de viewport).
const PAGE = `<!doctype html><html><head><title>x</title></head><body><p>bonjour</p></body></html>`;
const server = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

function run(cmd, args, input) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", er = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (er += d));
    p.on("close", (code) => resolve({ code, out, er }));
    if (input != null) p.stdin.write(input);
    p.stdin.end();
  });
}

// 1. CLI --json: sortie JSON parsable avec les cles attendues.
let r = await run("node", [CLI, "scan", base, "--json"]);
ok(r.code === 0, "CLI --json exit 0");
let data = null; try { data = JSON.parse(r.out); } catch {}
ok(data && data.target && Array.isArray(data.findings), "CLI --json produit un audit structure");
ok(data && data.summary && typeof data.summary.weightedScore === "number", "summary.weightedScore present");

// 2. --fail-on: le site de test a des findings medium (no-h1, viewport) -> exit 1.
r = await run("node", [CLI, "scan", base, "--fail-on", "medium", "--quiet"]);
ok(r.code === 1, "CLI --fail-on medium casse le build (exit 1) quand il y a des findings medium+");

// 3. --fail-on critical: pas de critique sur ce site -> exit 0.
r = await run("node", [CLI, "scan", base, "--fail-on", "critical", "--quiet"]);
ok(r.code === 0, "CLI --fail-on critical exit 0 quand aucun critique");

// 4. usage sans target -> exit 2.
r = await run("node", [CLI, "scan"]);
ok(r.code === 2, "CLI sans url exit 2 (usage)");

// 5. MCP: initialize + tools/list + tools/call en une session stdio.
const req = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "panoptic_scan", arguments: { url: base } } },
].map((m) => JSON.stringify(m)).join("\n") + "\n";
r = await run("node", [MCP], req);
const lines = r.out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const init = lines.find((l) => l.id === 1);
ok(init && init.result?.serverInfo?.name === "panoptic", "MCP initialize renvoie serverInfo panoptic");
const list = lines.find((l) => l.id === 2);
ok(list && list.result?.tools?.[0]?.name === "panoptic_scan", "MCP tools/list expose panoptic_scan");
const call = lines.find((l) => l.id === 3);
ok(call && call.result?.structuredContent?.summary?.target, "MCP tools/call renvoie un audit structure");
ok(call && Array.isArray(call.result?.content) && call.result.content[0].type === "text", "MCP tools/call renvoie du texte lisible");

server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
