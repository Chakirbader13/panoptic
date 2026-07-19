// Panoptic - couche de persistance, multi-tenant.
// Par defaut: stockage local JSON (aucune config). Si SUPABASE_URL + SUPABASE_SERVICE_KEY
// sont definis, bascule sur Supabase via PostgREST (sans dependance, fetch seul).
// Interface identique dans les deux cas.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".data");
const AUD = join(DIR, "audits");
const SUPA = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? { url: process.env.SUPABASE_URL.replace(/\/$/, ""), key: process.env.SUPABASE_SERVICE_KEY }
  : null;

// --- id deterministe court (pas de Date.now cote engine, mais ici on stampe) ------
export function newId() {
  const t = Date.now().toString(36);
  let r = "";
  for (let i = 0; i < 6; i++) r += "0123456789abcdefghijklmnopqrstuvwxyz"[(Math.random() * 36) | 0];
  return `aud_${t}${r}`;
}

// Resout un tenant a partir d'une cle d'API (multi-tenant). Cle inconnue -> tenant "public".
export function tenantFromKey(key) {
  if (!key) return "public";
  // hash court stable
  let h = 5381;
  for (const c of key) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return "t_" + h.toString(36);
}

// ---------------- backend Supabase (PostgREST) ----------------
async function supa(path, opts = {}) {
  const res = await fetch(`${SUPA.url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA.key, authorization: `Bearer ${SUPA.key}`,
      "content-type": "application/json", prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---------------- backend local ----------------
function ensure() { for (const d of [DIR, AUD]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function fpath(id) { return join(AUD, `${id}.json`); }

export const store = {
  async create(tenant, { target, repoPath, repoUrl, businessParams }) {
    const rec = { id: newId(), tenant, target, repoPath: repoPath || null, repoUrl: repoUrl || null, businessParams: businessParams || null, status: "queued", score: null, summary: null, findings: [], created_at: new Date().toISOString(), progress: [] };
    if (SUPA) { await supa("audits", { method: "POST", body: JSON.stringify({ id: rec.id, tenant: rec.tenant, target, status: "queued", created_at: rec.created_at }) }); }
    else { ensure(); writeFileSync(fpath(rec.id), JSON.stringify(rec, null, 2)); }
    return rec;
  },

  async get(id) {
    if (SUPA) {
      const rows = await supa(`audits?id=eq.${id}&select=*`);
      if (!rows?.length) return null;
      const rec = rows[0];
      rec.findings = await supa(`findings?audit_id=eq.${id}&select=*&order=priority.desc`);
      return rec;
    }
    if (!existsSync(fpath(id))) return null;
    return JSON.parse(readFileSync(fpath(id), "utf8"));
  },

  async update(id, patch) {
    if (SUPA) { await supa(`audits?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }); return; }
    const rec = await this.get(id);
    if (!rec) return;
    Object.assign(rec, patch);
    writeFileSync(fpath(id), JSON.stringify(rec, null, 2));
  },

  async saveFindings(id, findings) {
    if (SUPA) {
      if (findings.length) await supa("findings", { method: "POST", body: JSON.stringify(findings.map((f) => ({ audit_id: id, agent: f.agent, family: f.family, rule: f.rule, title: f.title, severity: f.severity, priority: f.priority ?? 0, location: f.location, business: f.business, fix: f.fix, effort: f.effort, evidence: f.evidence, check: f.check }))) });
      return;
    }
    const rec = await this.get(id);
    rec.findings = findings;
    writeFileSync(fpath(id), JSON.stringify(rec, null, 2));
  },

  async list(tenant, limit = 30) {
    if (SUPA) return supa(`audits?tenant=eq.${tenant}&select=id,target,status,score,created_at&order=created_at.desc&limit=${limit}`);
    ensure();
    const rows = readdirSync(AUD).filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(AUD, f), "utf8")); } catch { return null; } })
      .filter((r) => r && r.tenant === tenant)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit)
      .map((r) => ({ id: r.id, target: r.target, status: r.status, score: r.score, created_at: r.created_at, findings: (r.findings || []).length }));
    return rows;
  },

  backend: SUPA ? "supabase" : "local",
};
