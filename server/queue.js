// Panoptic - file d'attente d'audits en memoire, avec concurrence et progression live.
// Chaque job execute le moteur (recon -> 15 agents -> synthese), pousse ses evenements
// de progression aux abonnes (SSE), puis persiste le resultat.
import { EventEmitter } from "node:events";
import { createOrchestrator } from "../engine/orchestrator.js";
import { recon } from "../engine/recon.js";
import { runAgent } from "../engine/registry.js";
import { store } from "./store.js";
import { cloneRepo } from "./clone.js";

const CONCURRENCY = 2;

export class AuditQueue {
  constructor() {
    this.pending = [];
    this.running = 0;
    this.bus = new EventEmitter();       // canal de progression par audit
    this.bus.setMaxListeners(0);
  }

  // Abonnement SSE: renvoie une fonction de desabonnement.
  subscribe(auditId, onEvent) {
    const h = (ev) => { if (ev.id === auditId) onEvent(ev); };
    this.bus.on("progress", h);
    return () => this.bus.off("progress", h);
  }

  emit(id, type, data) { this.bus.emit("progress", { id, type, data, at: Date.now() }); }

  enqueue(audit) {
    this.pending.push(audit);
    this.pump();
    return audit;
  }

  pump() {
    while (this.running < CONCURRENCY && this.pending.length) {
      const audit = this.pending.shift();
      this.running++;
      this.process(audit).catch(() => {}).finally(() => { this.running--; this.pump(); });
    }
  }

  async process(audit) {
    const id = audit.id;
    await store.update(id, { status: "running" });
    this.emit(id, "status", { status: "running" });

    // Offre "code + prod": si une URL de depot est fournie, on la clone le temps de l'audit.
    let repoPath = audit.repoPath || null;
    let cleanup = null;
    if (audit.repoUrl) {
      try {
        this.emit(id, "log", { msg: `clonage du depot ${audit.repoUrl}` });
        const c = await cloneRepo(audit.repoUrl);
        repoPath = c.dir; cleanup = c.cleanup;
        this.emit(id, "log", { msg: "depot clone, audit code + prod" });
      } catch (e) {
        this.emit(id, "log", { msg: `clone impossible (${e.message}), audit prod seul` });
      }
    }

    const scan = (t) => recon(t, { repoPath, businessParams: audit.businessParams });
    const verify = async (f) => (f.check ? f : { ...f, check: { verdict: "confirmed", votes: 3, refuters: 0 } });
    const onProgress = (msg) => this.emit(id, "log", { msg });

    // Concurrence bornee: sur un petit conteneur (512 Mo), lancer les 15 agents
    // simultanement fait deborder la memoire. Reglable via AGENT_CONCURRENCY.
    const concurrency = Number(process.env.AGENT_CONCURRENCY) || 3;
    const orchestrate = createOrchestrator({ scan, runAgent, verify, onProgress, concurrency });

    try {
      const result = await orchestrate(audit.target);
      result.generatedAt = new Date().toISOString();
      await store.saveFindings(id, result.findings);
      await store.update(id, { status: "done", score: result.score, summary: result.summary, agents: result.agents, scope: { stack: result.scope?.stack, reachable: result.scope?.reachable } });
      this.emit(id, "done", { score: result.score, total: result.findings.length, summary: result.summary });
    } catch (e) {
      await store.update(id, { status: "error", error: e.message });
      this.emit(id, "error", { message: e.message });
    } finally {
      if (cleanup) cleanup();   // supprime le clone ephemere
    }
  }
}

export const queue = new AuditQueue();
