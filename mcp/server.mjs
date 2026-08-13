#!/usr/bin/env node
// Panoptic MCP server - expose l'audit de site comme outil MCP (Model Context Protocol)
// pour Claude Code, Cursor et tout agent compatible. JSON-RPC 2.0 sur stdio, zero dependance.
//
// Enregistrement (Claude Code): claude mcp add panoptic -- node /chemin/mcp/server.mjs
// L'agent appelle alors l'outil `panoptic_scan` puis corrige lui-meme les findings.
//
// Difference avec squirrelscan: le moteur est DETERMINISTE (semgrep/axe/Lighthouse/OSV,
// jamais de LLM tiers) et lit le CODE + la production; l'agent recoit des faits verifies.
import { runAudit, countAtOrAbove } from "../engine/audit.mjs";
import { createInterface } from "node:readline";

const PROTOCOL = "2024-11-05";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const TOOLS = [
  {
    name: "panoptic_scan",
    description: "Audite un site web (securite, SEO, performance, accessibilite, RGPD, conversion, etc.) sur sa production et, si un depot est fourni, son code source. Renvoie des findings verifies (chaque faux positif est filtre) avec severite, localisation et correctif. Ideal avant de corriger un site: lance ceci, puis applique les correctifs.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL du site a auditer (https://...)" },
        maxPages: { type: "number", description: "Profondeur de crawl multi-pages (1-30, defaut 1). >1 active axe-core/Lighthouse." },
        repoPath: { type: "string", description: "Chemin local du depot pour auditer aussi le code source (secrets, dependances CVE, architecture)." },
        failOn: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Optionnel: renvoie shouldFail=true si un finding atteint cette severite." },
      },
      required: ["url"],
    },
  },
];

async function callTool(name, args) {
  if (name !== "panoptic_scan") throw new Error("outil inconnu: " + name);
  let url = String(args.url || "").trim();
  if (!url) throw new Error("url requise");
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const r = await runAudit(url, {
    repoPath: args.repoPath || null,
    maxPages: Math.max(1, Math.min(30, Number(args.maxPages) || 1)),
  });
  const s = r.summary || {};
  // Reponse compacte et exploitable par un agent: synthese + findings essentiels.
  const findings = (r.findings || []).map((f) => ({
    severity: f.severity, agent: f.agent, title: f.title,
    location: f.location?.file ? `${f.location.file}:${f.location.line}` : (f.location?.url || null),
    fix: f.fix?.summary || null, verdict: f.check?.verdict || null,
  }));
  const summary = {
    target: r.target,
    healthScore: s.weightedScore ?? r.score,
    findingsTotal: findings.length,
    bySeverity: s.bySeverity || {},
    effortDays: s.effortDays ?? null,
    agentsRan: r.agents,
    ...(args.failOn ? { shouldFail: countAtOrAbove(r.findings, args.failOn) > 0 } : {}),
  };
  const text = `Audit Panoptic de ${r.target}\nScore de sante: ${summary.healthScore}/100 - ${findings.length} findings\n\n` +
    findings.slice(0, 30).map((f) => `[${f.severity}] ${f.title}${f.location ? " (" + f.location + ")" : ""}${f.fix ? "\n  -> " + f.fix : ""}`).join("\n");
  // On renvoie a la fois du texte lisible et les donnees structurees.
  return { content: [{ type: "text", text }], structuredContent: { summary, findings } };
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "panoptic", version: "1.0.0" } });
  }
  if (method === "notifications/initialized") return; // notification, pas de reponse
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    callTool(name, args || {})
      .then((result) => ok(id, result))
      .catch((e) => ok(id, { content: [{ type: "text", text: "Erreur audit: " + e.message }], isError: true }));
    return;
  }
  if (method === "ping") return ok(id, {});
  if (id !== undefined) err(id, -32601, "methode inconnue: " + method);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  try { handle(msg); } catch (e) { if (msg.id !== undefined) err(msg.id, -32603, e.message); }
});
