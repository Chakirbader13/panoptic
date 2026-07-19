# Panoptic

L'audit de site le plus complet du marche: quinze auditeurs specialises sur le code source ET la production reelle, chaque finding verifie, chiffre et priorise dans un seul rapport.

Nom de travail (changeable). Positionnement: battre SEMrush Site Audit, Ahrefs, Screaming Frog, Lighthouse, Snyk et OWASP ZAP reunis, parce qu'aucun ne fait code + prod + business verifie sous un seul toit.

## Structure

```
panoptic-audit/
  index.html          Landing FR (GENEREE, x-default) - ne pas editer a la main
  en/ de/ es/ it/ nl/ Landings traduites (generees)
  netlify.toml        Publish racine + headers de securite
  build.mjs           Generateur statique multilingue: node build.mjs
  src/
    i18n.mjs          Source de verite: donnees agents + traductions 6 langues
  engine/
    agents.js         Registre canonique des 15 agents (le cahier des charges en donnees)
    schema.js         Schema unique de finding + scoring + dedup + score de sante
    orchestrator.js   Pipeline en 5 couches (le coeur defendable)
```

## Multilingue (FR / EN / DE / ES / IT / NL)

`node build.mjs` regenere les 6 pages depuis `src/i18n.mjs`. Chaque page est
pre-rendue (contenu bake dans le HTML, pas injecte en JS) pour le SEO, avec
`<html lang>`, meta/OG/title localises, `canonical`, alternates `hreflang` (+ x-default)
et un selecteur de langue natif sans JS. Racine `/` = FR (x-default), sous-dossiers `/en/` etc.
Pour modifier un texte: editer `src/i18n.mjs` puis relancer le build. Ne jamais editer les HTML generes.
Ajuster `SITE` dans `src/i18n.mjs` au domaine final avant deploiement (hreflang absolus).

## Le moteur, en 5 couches (engine/orchestrator.js)

1. **Reconnaissance et scoping** - un seul crawl produit le perimetre pour tous les agents.
2. **Fan-out** - les agents actifs s'executent en parallele sur code + prod.
3. **Verification adversariale** - chaque finding est challenge avant le rapport.
4. **Dedup + scoring** - fusion inter-domaines, priorisation impact / effort.
5. **Synthese** - score de sante, roadmap chiffree, executive summary.

Les runners d'outils (semgrep, lighthouse, zap, snyk...) sont injectes dans
`createOrchestrator`: l'orchestrateur pilote, il ne connait pas les outils. Le flux
se teste sans infra.

## Les 15 agents (engine/agents.js)

| Famille | Agents |
|---------|--------|
| Technique | Securite, Code/archi, Infra/DevOps, Donnees/BDD, Dependances/supply chain, Performance/CWV |
| Visibilite | SEO technique, GEO (visibilite IA), Analytics, Email/delivrabilite |
| Humain | Accessibilite (WCAG), UX/UI/parcours, Contenu/i18n |
| Risque | Juridique/RGPD, CRO/conversion |

Chaque agent: mission, referentiel, checks, outils, entree code, entree prod, scoring, poids, condition d'activation.

## Le contrat central (engine/schema.js)

Tous les agents produisent le meme format de finding:
`{ agent, family, rule, title, severity, evidence, location, business, fix, effort, check }`

C'est ce format unique qui permet le dedoublonnage et la priorisation inter-domaines.
Sans lui, l'orchestrateur ne pourrait pas fusionner "le meme probleme remonte par
securite ET perf ET SEO".

## Agent securite (agent de reference profond, FONCTIONNEL)

Premier agent reel, sans dependance, qui trouve de vraies failles sur du vrai code et de la vraie prod.

```
engine/agents/security/
  rules.js       11 regles secrets + 15 regles SAST (mapping CWE), facon semgrep/gitleaks-lite
  scan.js        parcours fichiers + application des regles (fichier:ligne) + suppression inline
  prod.js        DAST passif: headers securite, cookies, TLS, fichiers exposes (vrai HTTP)
  verify.js      verification adversariale: placeholders, entropie -> confirmed/plausible/rejected
  index.js       runSecurity({repoPath, url}) -> findings canoniques, dedup, faux positifs retires
  __fixtures__/  cibles de test (secrets/vulns SYNTHETIQUES) pour prouver la detection
```

Lancer:
```
node run-security.mjs ./agents/security/__fixtures__      # SAST + secrets sur la fixture
node run-security.mjs . --url https://example.com          # code + prod (DAST reel)
node demo-orchestrated.mjs                                  # pipeline complet, agent reel branche
```

Prouve: detecte cle Stripe/AWS/GitHub, injection SQL/commande, XSS, deserialisation, TLS off, MD5,
headers manquants; rejette les placeholders en faux positifs; suppression inline `panoptic-ignore`
(comme nosemgrep); le moteur Panoptic passe son propre audit (0 finding hors fixtures).

## Les 15 agents (tous FONCTIONNELS)

Chaque agent a un vrai code de detection, sans dependance, et lit le contexte partage produit par la recon.

```
engine/
  recon.js              Couche 1: UN seul crawl (HTML, headers, cookies, robots, sitemap,
                        llms.txt, detection de stack, signaux repo BDD/email) partage a tous.
  registry.js           id d'agent -> runner. Brancher un agent = une ligne.
  run-audit.mjs         CLI d'audit complet: recon -> 15 agents -> verif -> dedup -> synthese.
  agents/
    shared.js           Fabrique de findings canoniques + helpers HTTP/HTML/DNS/TLS.
    security/           SAST + secrets + DAST (deja livre, le plus profond).
    seo/ geo/ perf/ a11y/ legal/ analytics/ ux/ cro/ content/   (agents prod, lisent scope.home)
    infra/ email/ deps/ code-arch/ data/                        (agents code/DNS/TLS)
```

Ce que font les agents (reel, sans navigateur):
- **seo**: title/meta/h1/canonical/noindex/OG/viewport/JSON-LD/alt/sitemap/hreflang.
- **geo**: llms.txt, blocage des crawlers IA, JSON-LD, structure Q/R, E-E-A-T.
- **perf**: poids HTML, compression, cache, JS/CSS bloquants, images sans dimensions, lazy, TTFB mesure.
- **a11y**: lang, alt, labels, hierarchie de titres, liens vides, zoom, tabindex (mapping WCAG).
- **legal**: cookies avant consentement, traceurs sans CMP, mentions legales / confidentialite (RGPD).
- **analytics**: GA4/GTM/UA, double comptage, Consent Mode v2.
- **ux**: formulaires longs, police minuscule, surcharge de nav, page pauvre, favicon.
- **cro**: presence/clarte du CTA, proposition de valeur, preuve sociale, dispersion des CTA.
- **content**: cles i18n cassees affichees, fraicheur, coherence langue, cles manquantes entre locales.
- **infra**: expiration du certificat TLS (vraie connexion), redirection HTTP->HTTPS, CAA, security.txt, .env versionne.
- **email**: SPF/DKIM/DMARC via DNS reel (anti-usurpation).
- **deps**: vulns connues via l'API OSV en reel, lockfile manquant.
- **code-arch**: fichiers volumineux, TODO/FIXME, traces de debug, absence de tests.
- **data**: SELECT *, N+1, lectures sans limite, migrations manquantes.

Lancer:
```
node run-audit.mjs https://example.com --repo .    # audit complet, 15 agents
```
Prouve (example.com + moteur): 14 agents actifs en parallele, 42 findings dedupliques, sante/roadmap/
risque chiffres, en ~0,6 s. Le moteur (28 fichiers, tous les agents) passe son propre audit securite (0 finding).

## Backend d'audit (option B, FONCTIONNEL)

Serveur, file d'attente, persistance multi-tenant, dashboard temps reel, rapport et bundle de PR.

```
server/
  server.mjs        HTTP: REST + SSE (progression live) + sert le dashboard/rapports.
  queue.js          File d'attente en memoire, concurrence 2, evenements de progression.
  store.js          Persistance: JSON local par defaut, Supabase (PostgREST) si env defini.
  report.js         Rapport HTML autonome, imprimable en PDF (Cmd+P).
  fixbundle.js      Corps de PR (markdown + checklist) a partir des findings; PR en opt-in.
  schema.sql        Schema Supabase multi-tenant + RLS (isolation par tenant).
  dashboard/        Console: lance un audit, voit les 15 agents en direct, filtre les findings.
```

Lancer:
```
node server/server.mjs            # http://localhost:8787 (stockage local, aucune config)
# multi-tenant Supabase: definir SUPABASE_URL + SUPABASE_SERVICE_KEY, appliquer schema.sql
```

API: `POST /api/audits {target, repoPath}` (header `x-api-key` = tenant), SSE `/api/audits/:id/events`
(progression live), `GET /api/audits/:id` (resultat), `/report` (HTML->PDF), `/fixbundle?format=md` (PR).

Verifie de bout en bout: audit lance depuis le dashboard, 14 agents progressent en direct (SSE),
41 findings dedup, score 22/100, rapport PDF et bundle de correctifs generes.

## Deploiement (EN LIGNE)

Tout est deploye sur Netlify: https://panoptic-audit.netlify.app
- Site marketing 6 langues (racine + /en /de /es /it /nl), hreflang, en-tetes de securite.
- Console d'audit: `/console/` (scan boite noire en direct, findings filtrables, rapport PDF, bundle correctifs).
- Fonction serverless: `POST /api/audit {target}` -> audit prod complet synchrone (13 agents), voir `netlify/functions/audit.mjs`.
- Le moteur (`engine/`) est bundle dans la fonction mais NON servi publiquement (structure: site dans `public/`, moteur/fonction hors publish).

Redeployer: rebuild + assembler `public/` + `engine/` + `netlify/functions/` + `netlify.toml (publish=public, functions=netlify/functions)`
dans un dossier propre, puis `bunx @netlify/mcp@latest --site-id <id> --proxy-path <token>` (fix single-slash `/proxy/`) depuis ce dossier.
Site id Netlify: `c1166fe3-1c1a-4538-a4d5-4fcc607306b6`.

Deux modes d'audit:
- **Serverless (deploye)**: boite noire, prod uniquement, synchrone. C'est l'offre "scan gratuit".
- **Serveur Node (`server/`)**: code + prod, progression live SSE, persistance. Pour l'offre "audit complet".
  Deployable sur un hote Node via `Dockerfile` / `render.yaml` / `fly.toml` (configs prets).

## Reste a approfondir

- Crawl multi-pages (aujourd'hui: page d'accueil + robots/sitemap), contraste CSS reel via rendu,
  Lighthouse/axe-core en complement des heuristiques, ouverture automatique de PR (aujourd'hui: bundle + commande opt-in).

## Deploiement

Site statique, aucune etape de build. `netlify deploy` depuis la racine, ou glisser le dossier.
Le site est concu pour scorer parfaitement sur ce qu'il audite lui-meme: system fonts,
zero requete externe, dark mode, accessible, CSP stricte. Argument commercial: il passe son propre audit.
