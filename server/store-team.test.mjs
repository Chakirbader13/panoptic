// Test chantier 3: store local (historique + equipe). Sans Supabase (backend local JSON).
import { store, tenantFromKey } from "./store.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error("FAIL:", m)); };

const tenant = "t_test_" + Math.random().toString(36).slice(2, 8);
const target = "https://demo-" + Math.random().toString(36).slice(2, 6) + ".fr/";

// 2 audits du meme site, scores differents.
const a1 = await store.create(tenant, { target });
await store.saveFindings(a1.id, [{ agent: "seo", rule: "r1", severity: "high", title: "x" }]);
await store.update(a1.id, { status: "done", score: 70, summary: { weightedScore: 70, byDomain: [] } });

const a2 = await store.create(tenant, { target });
await store.saveFindings(a2.id, []);
await store.update(a2.id, { status: "done", score: 88, summary: { weightedScore: 88, byDomain: [] } });

// historique
const hist = await store.history(tenant, target, 10);
ok(hist.length === 2, "history renvoie 2 audits du site: " + hist.length);
ok(hist.every((h) => h.summary), "history porte le summary");
ok(hist[0].created_at >= hist[1].created_at, "history recent->ancien");

// isolation: un autre site n'apparait pas
const other = await store.create(tenant, { target: "https://autre.fr/" });
await store.update(other.id, { status: "done", score: 50, summary: { weightedScore: 50 } });
ok((await store.history(tenant, target, 10)).length === 2, "history filtre par target");

// resolveKey: retro-compat une cle seule = owner
const r = await store.resolveKey("some-legacy-key");
ok(r.role === "owner", "cle seule = owner (retro-compat)");
ok(r.tenant === tenantFromKey("some-legacy-key"), "tenant derive du hash");
ok((await store.resolveKey(null)).role === "viewer", "pas de cle = viewer public");

// membres/cles en local: no-op gracieux (Supabase requis pour la persistance reelle)
ok(Array.isArray(await store.listMembers(tenant)), "listMembers renvoie un tableau");
ok(Array.isArray(await store.listApiKeys(tenant)), "listApiKeys renvoie un tableau");
const key = await store.createApiKey(tenant, { label: "CI", role: "member" });
ok(key.key.startsWith("pk_") && key.role === "member", "createApiKey renvoie une cle en clair + role");
ok(tenantFromKey(key.key).length > 2, "la cle generee est hashable");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
