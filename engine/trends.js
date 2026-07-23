// Panoptic - tendances historiques + detection de regression entre deux audits.
// Fonctions PURES (aucun I/O): alimentent le dashboard "evolution par deploiement"
// et le declencheur d'alertes (Slack/Jira) quand un deploiement degrade le site.
import { dedupeKey, SEVERITY } from "./schema.js";

const rank = (s) => SEVERITY[s]?.rank ?? 0;

// serie chronologique a partir d'un historique d'audits (recent -> ancien attendu).
// Chaque item: { created_at, score|summary.weightedScore, summary.bySeverity, summary.byDomain }.
export function computeTrend(history) {
  const items = [...(history || [])]
    .filter((a) => a && (a.summary || a.score != null))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)); // ancien -> recent
  const series = items.map((a) => ({
    at: a.created_at,
    id: a.id,
    score: a.summary?.weightedScore ?? a.score ?? null,
    bySeverity: a.summary?.bySeverity || {},
  }));
  const latest = items[items.length - 1] || null;
  const previous = items[items.length - 2] || null;
  const sc = (a) => a?.summary?.weightedScore ?? a?.score ?? null;
  const scoreDelta = latest && previous && sc(latest) != null && sc(previous) != null ? sc(latest) - sc(previous) : null;

  // Deltas par domaine (byDomain: [{id,label,score}]).
  const domainDeltas = [];
  if (latest?.summary?.byDomain && previous?.summary?.byDomain) {
    const prevMap = new Map(previous.summary.byDomain.map((d) => [d.id, d]));
    for (const d of latest.summary.byDomain) {
      const p = prevMap.get(d.id);
      if (p && d.score != null && p.score != null && d.score !== p.score) {
        domainDeltas.push({ id: d.id, label: d.label, from: p.score, to: d.score, delta: d.score - p.score });
      }
    }
    domainDeltas.sort((a, b) => a.delta - b.delta); // regressions (delta<0) en tete
  }

  const verdict = scoreDelta == null ? "baseline"
    : scoreDelta < -3 ? "regression"
    : scoreDelta > 3 ? "amelioration"
    : "stable";

  return { count: items.length, series, scoreDelta, domainDeltas, verdict, latestId: latest?.id || null, previousId: previous?.id || null };
}

// Compare les findings de deux audits (par cle de dedup): apparus / resolus / persistants.
// Les "regressions" = findings apparus de severite >= medium (ce qui merite une alerte).
export function diffFindings(previousFindings, currentFindings) {
  const key = (f) => dedupeKey(f);
  const prev = new Map((previousFindings || []).map((f) => [key(f), f]));
  const curr = new Map((currentFindings || []).map((f) => [key(f), f]));

  const added = [], resolved = [], persisting = [];
  for (const [k, f] of curr) (prev.has(k) ? persisting : added).push(f);
  for (const [k, f] of prev) if (!curr.has(k)) resolved.push(f);

  const bySev = (arr) => [...arr].sort((a, b) => rank(b.severity) - rank(a.severity));
  const regressions = bySev(added.filter((f) => rank(f.severity) >= rank("medium")));
  const fixed = bySev(resolved.filter((f) => rank(f.severity) >= rank("medium")));

  return {
    added: bySev(added), resolved: bySev(resolved), persisting,
    regressions, fixed,
    counts: { added: added.length, resolved: resolved.length, persisting: persisting.length, regressions: regressions.length },
  };
}
