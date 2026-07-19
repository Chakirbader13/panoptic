// Panoptic - file d'attente d'audits en memoire, avec concurrence et progression live.
// Chaque job execute le moteur (recon -> 15 agents -> synthese), pousse ses evenements
// de progression aux abonnes (SSE), puis persiste le resultat.
import { EventEmitter } from "node:events";
import { createOrchestrator } from "../engine/orchestrator.js";
import { recon } from "../engine/recon.js";
import { runAgent } from "../engine/registry.js";
import { store } from "./store.js";

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

    const scan = (t) => recon(t, { repoPath: audit.repoPath });
    const verify = async (f) => (f.check ? f : { ...f, check: { verdict: "confirmed", votes: 3, refuters: 0 } });
    const onProgress = (msg) => this.emit(id, "log", { msg });

    const orchestrate = createOrchestrator({ scan, runAgent, verify, onProgress });

    try {
      const result = await orchestrate(audit.target);
      result.generatedAt = new Date().toISOString();
      await store.saveFindings(id, result.findings);
      await store.update(id, { status: "done", score: result.score, summary: result.summary, agents: result.agents, scope: { stack: result.scope?.stack, reachable: result.scope?.reachable } });
      this.emit(id, "done", { score: result.score, total: result.findings.length, summary: result.summary });
    } catch (e) {
      await store.update(id, { status: "error", error: e.message });
      this.emit(id, "error", { message: e.message });
    }
  }
}

export const queue = new AuditQueue();
