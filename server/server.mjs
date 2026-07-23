#!/usr/bin/env node
// Panoptic - serveur d'audit. REST + SSE (progression live) + dashboard + rapports.
//   node server.mjs         (port 8787, stockage local ou Supabase si env)
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { store, tenantFromKey } from "./store.js";
import { computeTrend, diffFindings } from "../engine/trends.js";
import { queue } from "./queue.js";
import { renderReport } from "./report.js";
import { buildFixBundle, buildPrCommand } from "./fixbundle.js";
import { openAuditPR } from "./github.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-api-key" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  // Equipes: la cle resout tenant + role (owner|member|viewer). Retro-compat: une cle
  // seule reste owner de son tenant (store.resolveKey fallback).
  const auth = await store.resolveKey(req.headers["x-api-key"]);
  const tenant = auth.tenant;
  const canWrite = auth.role === "owner" || auth.role === "member";
  const isOwner = auth.role === "owner";
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    // --- API ---
    if (p === "/api/audits" && req.method === "POST") {
      if (!canWrite) return send(res, 403, { error: "role insuffisant (lecture seule)" });
      const body = await readBody(req);
      const target = body.target;
      if (!target) return send(res, 400, { error: "target requis" });
      // Le champ repo peut etre un chemin local OU une URL git a cloner.
      const repoRaw = body.repoUrl || body.repoPath || null;
      const repoUrl = repoRaw && /^https?:\/\//.test(repoRaw) ? repoRaw : null;
      const repoPath = repoRaw && !repoUrl ? repoRaw : null;
      const businessParams = body.businessParams || null;
      // Surcharge navigateur par audit (axe/Lighthouse): true force ON meme en prod-only
      // (offre premium boite-noire / benchmark), false force OFF. Sinon defaut = code+prod.
      const browserScan = typeof body.browserScan === "boolean" ? body.browserScan : undefined;
      // Multi-pages + scan authentifie (offre payante) + integrations d'alerte.
      const maxPages = body.maxPages;
      const authScan = body.auth || null;
      const notify = body.notify || null;   // { slack?, jira? } -> alertes sur regression
      const rec = await store.create(tenant, { target, repoPath, repoUrl, businessParams });
      queue.enqueue({ id: rec.id, tenant, target, repoPath, repoUrl, businessParams, browserScan, maxPages, auth: authScan, notify });
      return send(res, 201, { id: rec.id, status: "queued" });
    }

    if (p === "/api/audits" && req.method === "GET") {
      return send(res, 200, { backend: store.backend, version: "teams-trends-1", browser: process.env.PANOPTIC_BROWSER === "off" ? "off" : "on", role: auth.role, audits: await store.list(tenant) });
    }

    // Tendances par deploiement pour un site: serie de score + regressions vs precedent.
    if (p === "/api/trends" && req.method === "GET") {
      const target = url.searchParams.get("target");
      if (!target) return send(res, 400, { error: "parametre target requis" });
      const history = await store.history(tenant, target, 20);
      const trend = computeTrend(history);
      // Diff des findings entre les 2 derniers audits complets (regressions).
      let diff = null;
      if (trend.latestId && trend.previousId) {
        const [a, b] = await Promise.all([store.get(trend.latestId), store.get(trend.previousId)]);
        diff = diffFindings(b?.findings || [], a?.findings || []);
      }
      return send(res, 200, { target, trend, diff });
    }

    // Equipe: membres + cles d'API. Lecture = tout role; ecriture = owner uniquement.
    if (p === "/api/team" && req.method === "GET") {
      return send(res, 200, { tenant, role: auth.role, members: await store.listMembers(tenant), apiKeys: await store.listApiKeys(tenant) });
    }
    if (p === "/api/team/members" && req.method === "POST") {
      if (!isOwner) return send(res, 403, { error: "reserve au owner" });
      const body = await readBody(req);
      if (!body.email) return send(res, 400, { error: "email requis" });
      return send(res, 201, await store.addMember(tenant, { email: body.email, role: body.role }));
    }
    if (p === "/api/team/keys" && req.method === "POST") {
      if (!isOwner) return send(res, 403, { error: "reserve au owner" });
      const body = await readBody(req);
      return send(res, 201, await store.createApiKey(tenant, { label: body.label, role: body.role }));
    }

    const mAudit = p.match(/^\/api\/audits\/([\w]+)$/);
    if (mAudit && req.method === "GET") {
      const rec = await store.get(mAudit[1]);
      return rec ? send(res, 200, rec) : send(res, 404, { error: "introuvable" });
    }

    // SSE - progression live
    const mEvents = p.match(/^\/api\/audits\/([\w]+)\/events$/);
    if (mEvents) {
      const id = mEvents[1];
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
      res.write(`retry: 3000\n\n`);
      const rec = await store.get(id);
      if (rec && rec.status !== "queued" && rec.status !== "running") {
        res.write(`event: done\ndata: ${JSON.stringify({ score: rec.score, total: (rec.findings || []).length, summary: rec.summary })}\n\n`);
        return res.end();
      }
      const unsub = queue.subscribe(id, (ev) => {
        res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
        if (ev.type === "done" || ev.type === "error") { unsub(); res.end(); }
      });
      const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
      req.on("close", () => { clearInterval(ping); unsub(); });
      return;
    }

    const mReport = p.match(/^\/api\/audits\/([\w]+)\/report$/);
    if (mReport && req.method === "GET") {
      const rec = await store.get(mReport[1]);
      if (!rec) return send(res, 404, { error: "introuvable" });
      return send(res, 200, renderReport(rec), "text/html; charset=utf-8");
    }

    const mFix = p.match(/^\/api\/audits\/([\w]+)\/fixbundle$/);
    if (mFix && req.method === "GET") {
      const rec = await store.get(mFix[1]);
      if (!rec) return send(res, 404, { error: "introuvable" });
      const bundle = buildFixBundle(rec);
      if (url.searchParams.get("format") === "md") return send(res, 200, bundle.body, "text/markdown; charset=utf-8");
      return send(res, 200, { ...bundle, prCommand: buildPrCommand(bundle) });
    }

    // Ouverture de PR (action a effet de bord: opt-in, token cote serveur).
    const mPr = p.match(/^\/api\/audits\/([\w]+)\/pr$/);
    if (mPr && req.method === "POST") {
      const rec = await store.get(mPr[1]);
      if (!rec) return send(res, 404, { error: "introuvable" });
      const { owner, repo, dryRun } = await readBody(req);
      const token = process.env.GITHUB_TOKEN;
      try {
        const r = await openAuditPR({ token, owner, repo, audit: rec, dryRun });
        return send(res, 200, r);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    // --- statique (dashboard) ---
    let file = p === "/" ? "/dashboard/index.html" : p;
    const fp = join(DIR, file);
    if (fp.startsWith(join(DIR, "dashboard")) && existsSync(fp)) {
      return send(res, 200, readFileSync(fp), MIME[extname(fp)] || "text/plain");
    }

    send(res, 404, { error: "route inconnue" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Panoptic server -> http://localhost:${PORT}  (stockage: ${store.backend})`);
});
