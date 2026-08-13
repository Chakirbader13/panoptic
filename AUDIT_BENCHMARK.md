# AUDIT_BENCHMARK — Panoptic

_Auditeur produit indépendant, mandaté par un investisseur. Sévérité assumée. Aucune flatterie._
_Date : 26 juillet 2026. Application auditée : **Panoptic** — https://panopticaudit.com. Backend : https://panoptic-audit.onrender.com._
_Segment inféré (non fourni) : outil d'audit de site web tout-en-un, multi-domaines, code + production. Cible inférée : PME, agences web, CTO/équipes tech qui veulent consolider 5-6 outils d'audit._

---

## VERDICT EN PREMIÈRE LIGNE

**Non, ce n'est pas le meilleur produit mondial de son segment. Aujourd'hui, ce n'est pas encore un produit : c'est un moteur d'audit techniquement sérieux emballé dans un MVP d'une semaine, sans clients, sans moyen de payer, sans compte utilisateur, sans documentation.** Le code est meilleur que la moyenne des MVP ; le *produit commercial* est en dessous de la moyenne du marché. Note globale estimée : **5,1 / 10**. Rang : invendable en l'état (0 client, 0 tunnel de paiement).

---

## 1. AUDIT INTERNE — ce qui existe VRAIMENT

### Faits établis par inspection (pas par le README)

| Fait | Preuve | Lecture |
|---|---|---|
| **Projet d'une semaine, solo** | 1er commit `2026-07-19`, 53 commits, 1 seul contributeur humain (`git shortlog`) | Bus factor = 1. Aucune validation par un tiers technique. |
| **431 tests passent (0 échec)** | 14 fichiers `*.test.mjs` : units 62, logs 39, external 38, citations 35, render 33, scale 32, robots 28, lanes 27, notify 20, trends 19, crawl-auth 13, store-team 11, cro 5, verify-absence 5 | **Vraie force.** Rare pour un MVP. Le moteur est testé. |
| **Aucune CI** | pas de `.github/workflows/` | Les 431 tests ne tournent PAS au déploiement. Ironique pour un outil qui vend « ré-audit à chaque deploy ». |
| **15 agents réellement implémentés** | `engine/agents/*/index.js` = 15, détection réelle (semgrep, axe-core, Lighthouse, OSV, DNS DoH) | Profondeur moteur réelle, pas des coquilles. |
| **Mais 4 agents ne produisent presque rien sans le code** | `code-arch, data, deps, security(complet)` requièrent `scope.repoPath` | Le « scan gratuit 15 experts » est en réalité ~11 agents prod-only. Écart marketing / réalité. |
| **AUCUN paiement possible** | grep `stripe/paddle/checkout` → aucun tunnel branché ; les hits sont des règles SEO/sécu, pas un panier | Les prix (490 €, 190 €/mois) sont affichés mais **on ne peut pas acheter**. Monétisation = 0. |
| **AUCUN compte utilisateur (UI)** | pas de login/signup dans `console/` ni `server/dashboard/` | « Comptes & rôles d'équipe » = en-têtes de clé API seulement, aucune interface. Onboarding humain inexistant. |
| **AUCUNE UI de tendances** | `/api/trends` existe, aucun graphe dans la console | Le chantier « historique et tendance » n'a aucune surface produit visible. API sans écran. |
| **Fichier mort** | `engine/demo-orchestrated.mjs` dit « 14 stubs » — non référencé par le pipeline réel | Dette / confusion. À supprimer. |

### Écarts promesse marketing ↔ implémentation

1. **« 15 experts » / « quinze auditeurs »** : vrai avec un dépôt connecté ; en scan gratuit, 4 agents (deps, code, data, sécurité complète) ne remontent rien. Le chiffre est techniquement défendable mais commercialement trompeur pour l'utilisateur du scan gratuit.
2. **« Correctifs appliqués pour vous, jusqu'à la pull request »** : le code PR existe (`server/github.js`, `netlify/functions/pr.mjs`) mais est **opt-in et en dry-run sans `GITHUB_TOKEN`**. Aucune remédiation réellement livrée à un client à ce jour (0 client). C'est une capacité, pas un service rendu.
3. **« Alertes Slack, tickets Jira »** : moteur réel et testé (`server/notify.js`, 20 tests), mais **gaté 402 et sans config par client persistante** — passé dans la requête d'audit, pas stocké par tenant. Pas activable en self-service.
4. **« SOC 2 »** : désormais honnête (« en cours », disclaimer explicite sur `/securite/`). Bon point : plus de faux badge.
5. **Zéro faux positif** (promesse centrale) : **démentie cette semaine** — l'agent CRO a annoncé « aucun CTA » sur un site à 5 CTA, et la vérification adversariale l'a laissé passer en « confirmé ». Corrigé depuis (dictionnaire + vérif DOM), mais le fait qu'un faux positif de ce niveau ait survécu à la couche « anti-faux-positif » sur le propre site du produit est un signal de fragilité de la promesse n°1.

### Forces réelles (rester juste)
- **Moteur déterministe, sans LLM tiers** (vérifié : aucun appel OpenAI/Anthropic dans `engine/`). Argument de confidentialité authentique et rare.
- **Traçabilité code + production à la ligne** (`orchestrator.js` + recon partagée). Différenciateur réel.
- **Vérification adversariale déterministe** durcie cette semaine (`verify.js` re-dérive depuis le DOM).
- **Isolation multi-tenant RLS** (`server/schema.sql`), clone éphémère lecture seule (`server/clone.js`), garde SSRF + rate-limit (`_guard.mjs`).
- **Scanners réels** : semgrep, axe-core WCAG, Lighthouse CWV (via `browser.js`, activés sur audit payant).

---

## 2. CONCURRENCE (recherche web — données de prix/traction souvent non vérifiables)

> Avertissement de rigueur : hors Lumar et squirrelscan, les prix et tailles précis n'étaient **pas vérifiables** dans les sources trouvées. Marqué « n.v. » quand non sourcé.

| Concurrent | Positionnement | Pricing | Taille/traction | 3 différenciateurs |
|---|---|---|---|---|
| **Lumar** (ex-Deepcrawl) | Plateforme d'optimisation de site tout-en-un (SEO/GEO/perf/a11y), enterprise | Custom ; contrat médian ~**32 000 $/an** (source tierce) | n.v. | Crawl à l'échelle, API GraphQL + CI/CD, monitoring temps réel |
| **Siteimprove** | Accessibilité + qualité + SEO, secteur public/grands comptes | n.v. | Établi, international | A11y/conformité mûre, gouvernance de contenu, reporting |
| **Semrush Site Audit** | SEO technique (dans une suite marketing) | n.v. (suite ~100-500 $/mo notoire) | Coté, très large | Base backlinks/keywords, crawl 1M pages, écosystème |
| **Screaming Frog** | Crawler SEO desktop, agences | ~**199 £/an** | Établi, agences | Configurabilité crawl, extraction custom, prix bas |
| **Snyk** | Sécurité dev (SAST/SCA/IaC) | ~**25 $/dev/mo** | Scale-up sécurité, très établi | Intégration dev profonde, base vulnérabilités, remédiation dépendances |
| **squirrelscan** ⚠️ | **Audit IA multi-domaines (SEO/perf/sécu/a11y/agent-exp), fait pour les agents de code** | Crédits cloud (détail n.v.) | Startup 2024-26, traction n.v. | **267 règles / 21 catégories**, natif Claude Code/Cursor + **MCP** + CI/CD, correctifs délégués à l'agent IA |
| **WordLift / Foresight** | Audit IA de « AI-readiness » (GEO), single-page | Gratuit / freemium | Petit, niche | Score d'agentic readiness, structured data, onboarding instantané |

**Constat capital** : le créneau « audit de site par agents IA, multi-domaines » **n'est plus vide**. **squirrelscan** occupe une position très proche, plus *dev-native* que Panoptic (CLI auto-updater, MCP, natif Cursor/Claude Code, 267 règles). Différence clé en faveur de Panoptic : squirrelscan **ne lit pas le code source** et **délègue les correctifs à un agent IA externe** (pas de moteur de vérification propre, pas de service « fait pour vous »). Différence en faveur de squirrelscan : intégrations développeur et couverture de règles supérieures, et il existe déjà comme outil que des devs adoptent.

---

## 3. GRILLE DE NOTATION (0-10)

Chaque note Panoptic est justifiée par un fichier/écran. Notes concurrents = estimations à partir de sources limitées (voir §« suppositions »).

| Critère (poids) | **Panoptic** | Justification Panoptic (fichier/écran) | Lumar | Siteimprove | Semrush | Snyk | squirrelscan |
|---|---|---|---|---|---|---|---|
| Profondeur fonctionnelle (15) | **7** | 15 agents détection réelle + code+prod (`engine/agents/*`, `scanners/browser.js`) ; manque rendu JS/SPA, CWV terrain (CrUX), scan authentifié profond | 8 | 7 | 6 | 8 | 6 |
| UX / UI (12) | **4** | Site marketing soigné, mais le PRODUIT = console scanner nue (`console/index.html`), 0 dashboard, 0 graphe tendances, 0 compte | 7 | 7 | 8 | 7 | 5 |
| Rapidité (6) | **6** | Audit en secondes/minutes (dogfood) ; cold start Render, scan navigateur lourd | 7 | 7 | 8 | 8 | 6 |
| Fiabilité technique (12) | **6** | 431 tests OK (fort) MAIS 0 CI, faux positif CRO survenu cette semaine, 0 monitoring d'erreurs, 1 semaine d'âge | 8 | 8 | 8 | 9 | 6 |
| Sécurité & conformité données (12) | **6** | RLS/clone éphémère/no-LLM/UE réels (`schema.sql`,`clone.js`,`_guard.mjs`) ; SOC2 non certifié, RLS `tenants` était off, 0 politique formelle | 7 | 8 | 5 | 9 | 5 |
| Intégrations (10) | **4** | PR GitHub (opt-in/token), Slack/Jira (gaté, sans UI de config) ; **pas de CLI, pas de MCP, pas d'action CI native** (`server/notify.js`) | 8 | 7 | 7 | 9 | 8 |
| Onboarding (8) | **3** | Aucun signup, aucun guide ; coller une URL marche, mais brancher repo/clés = manuel non documenté | 6 | 6 | 7 | 7 | 6 |
| Pricing (8) | **5** | Paliers clairs (0/490/190) MAIS **aucun tunnel de paiement** — un prix sans bouton acheter | 4 | 4 | 6 | 6 | 4 |
| Support & documentation (7) | **2** | **Aucune doc, aucun help center, aucune doc API** dans le repo | 7 | 8 | 8 | 8 | 5 |
| Défendabilité / copiable en 3 mois (10) | **6** | Code+prod + vérif déterministe + service « fait pour vous » = dur à copier ; mais squirrelscan prouve que l'IA-audit est copiable, 0 moat de données, 0 user, solo | 7 | 6 | 6 | 8 | 6 |
| **Score pondéré /10** | **5,1** | | **7,0** | **6,8** | **6,4** | **7,8** | **5,7** |

_Calcul Panoptic : (7·15 + 4·12 + 6·6 + 6·12 + 6·12 + 4·10 + 3·8 + 5·8 + 2·7 + 6·10) / 100 = 511/100 = **5,11**._

---

## 4. VERDICT

**Classement estimé sur le segment « audit de site » :** hors catégorie commerciale (0 client, 0 revenu). Sur la **capacité produit** pure : **mid-pack**, derrière Snyk (7,8, mais mono-domaine sécurité), Lumar (7,0) et Siteimprove (6,8) ; à peu près au niveau de squirrelscan (5,7) et devant Screaming Frog sur la breadth. **Écart avec le leader du segment tout-en-un (Lumar/Siteimprove) : ~1,7 à 1,9 point.** Écart avec Snyk (leader profondeur, autre créneau) : 2,7 points.

**Est-ce le meilleur produit mondial du segment ? → NON.**

Cinq lignes de justification : (1) il n'existe pas commercialement — impossible de payer, aucun compte, aucun client ; (2) le seul argument de vente unique (« zéro faux positif ») a été pris en défaut cette semaine sur le propre site du produit ; (3) l'UX produit (console nue, pas de dashboard, pas de tendances visibles) est très en retard sur Lumar/Siteimprove ; (4) zéro documentation, zéro support, zéro onboarding ; (5) un concurrent IA-natif plus dev-natif (squirrelscan, CLI + MCP + 267 règles) occupe déjà le créneau « audit par agents IA ». **Ce qui manque précisément : un tunnel de paiement, un système de compte + dashboard, une UI de tendances, une CI, une doc, un CLI/MCP, et surtout — des utilisateurs.**

Ce qui empêche de le classer plus bas : le moteur est réellement profond et testé (431 tests), la traçabilité code+prod et l'analyse sans-LLM sont de vrais différenciateurs, et la dette est faible pour un projet aussi jeune.

---

## 5. PLAN — 10 actions par impact/effort

| # | Action | Fichiers | Jours | Gain grille |
|---|---|---|---|---|
| 1 | **Brancher un vrai paiement** (Stripe Checkout : scan→490 €, abo 190 €/mo) | `server/server.mjs`, `console/index.html`, nouveau `server/billing.js` | 3-4 | Pricing 5→8, **débloque tout revenu** |
| 2 | **Compte utilisateur + dashboard** (Supabase Auth, remplace la clé API à coller) | `console/`, `server/server.mjs`, `schema.sql` | 5 | Onboarding 3→6, UX 4→6 |
| 3 | **UI de tendances** (graphe score/deploy consommant `/api/trends`) | `console/index.html` | 2 | UX +1, rend le chantier 3 visible |
| 4 | **CI GitHub Actions** (tests au push + action « Panoptic audit » réutilisable) | `.github/workflows/ci.yml`, `action.yml` | 2 | Fiabilité 6→8, Intégrations +1, dogfood crédible |
| 5 | **CLI + serveur MCP** (parité squirrelscan : `npx panoptic scan`, tool MCP) | nouveau `cli/`, `mcp/` | 4 | Intégrations 4→7, défendabilité, neutralise squirrelscan |
| 6 | **Documentation** (setup, connexion repo, API, self-host) | nouveau `docs/` | 3 | Support 2→6 |
| 7 | **Crawl avec rendu JS** (Playwright pour sites SPA, sinon contenu invisible) | `engine/crawl.js` | 3 | Profondeur +1 (beaucoup de sites sont SPA) |
| 8 | **CWV terrain via CrUX API** (données réelles Google, pas labo) | `engine/agents/perf/index.js` | 1 | Profondeur +0,5, crédibilité perf |
| 9 | **Config intégrations par tenant** (Slack/Jira persistant + auto-notify câblé) | `server/schema.sql`, `server/server.mjs` | 2 | Intégrations +1, rend le « continu » réel |
| 10 | **Monitoring d'erreurs + statut** (Sentry + page statut) | `server/server.mjs` | 1 | Fiabilité +0,5 |

Ordre de bataille : **1 → 2 → 3** d'abord (transforme un moteur en produit vendable), puis **4 → 6 → 5** (crédibilité + parité dev), le reste en profondeur.

### 3 chantiers structurels à 6 mois (pour viser la 1re place)
1. **Traction : 20-50 clients pilotes payants.** C'est la seule variable qui compte. Sans users, la note plafonne quel que soit le code. GTM ciblé agences web + éditeurs SaaS.
2. **SOC 2 Type II certifié** (via Vanta/Drata — dossier déjà prêt sur le Bureau). Débloque le mid-market/enterprise où se trouve l'argent (contrats type Lumar 32 k$/an).
3. **Moat de données : réseau de monitoring continu.** Agréger les findings anonymisés en benchmarks sectoriels (« votre e-commerce vs la médiane du secteur ») — un actif que ni Lumar ni squirrelscan n'ont, et qui grandit avec chaque client. C'est la seule défense durable contre la copie de l'IA-audit.

---

## 6. RISQUES (ce qui peut tuer le produit)

1. **Bus factor = 1.** Un seul humain, une semaine de code, aucune revue tierce. Départ/indispo = mort du projet. Risque n°1.
2. **Zéro revenu, zéro chemin de paiement.** Aucun modèle de runway. Un produit qu'on ne peut pas acheter n'a pas de marché, quel que soit le moteur.
3. **Promesse « zéro faux positif » = passif.** Elle est le cœur du pitch et elle a lâché cette semaine. Un faux positif chez un vrai client (ex. « faille critique » erronée) détruit la confiance instantanément. La barre de qualité doit être parfaite, or il n'y a pas de CI pour la garder.
4. **Fenêtre concurrentielle qui se ferme.** squirrelscan (MCP/CLI/267 règles) et l'ajout d'agents IA par les incumbents (Lumar, Semrush) peuvent banaliser l'« audit IA » avant que Panoptic ait des clients.
5. **Dépendances critiques + coût.** Tout repose sur Render (scan navigateur ~1 Go RAM = risque OOM à volume, déjà rencontré), Netlify, Supabase. Le backend Render `/api/audits` accepte une clé API arbitraire (`dogfood-owner` a marché) → **création de tenant non authentifiée = abus/coût potentiel** si exposé.
6. **Responsabilité juridique.** Le produit rend des verdicts « mentions légales obligatoires », « risque d'amende RGPD en euros ». Même étiquetés « estimation », des conseils juridiques/financiers automatisés erronés exposent à une réclamation. Encadrer par des disclaimers explicites dans le rapport, pas seulement une note de bas de page.
7. **Dette de confusion** : fichier `demo-orchestrated.mjs` mort qui contredit le produit (« 14 stubs »), écart « 15 experts » en gratuit. Petites incohérences qui, cumulées, entament la crédibilité d'un produit qui vend la rigueur.

---

## Suivi post-audit (mises à jour vérifiées)

_L'auditeur consigne ce qui a bougé depuis la remise du rapport, avec preuve._

- **Action #4 (CI) — FAITE.** `.github/workflows/ci.yml` : les 431 tests tournent à chaque push, + parse-check des fonctions Netlify. Run GitHub **vert** vérifié (`gh run list` → success). Corrige le reproche « vend l'audit à chaque deploy sans CI ». Effet grille : Fiabilité 6→7.
- **Action #3 (UI de tendances) — FAITE.** Carte « Tendance » dans `server/dashboard/index.html` : sparkline SVG du score par déploiement + verdict + régressions/résolus, alimentée par `/api/trends`. Vérifié live : le dashboard Render sert le composant, et `/api/trends?target=panopticaudit.com` renvoie une vraie série `[84, 82]` (2 régressions / 2 résolus). Le chantier 3 a enfin une surface visible. Effet grille : UX 4→5.
- **Intégrité** : fichier mort `engine/demo-orchestrated.mjs` supprimé.
- **Score global recalculé : ~5,3/10** (Fiabilité +1, UX +1 sur leurs poids). Le verdict de fond (pas vendable : ni paiement, ni compte, ni clients) reste inchangé.

## Ce que j'ai dû supposer faute de preuve

- **Segment, cible et nom** n'étaient pas renseignés dans le mandat (placeholders `[NOM + URL]` laissés vides). Je les ai inférés du repo et du site : Panoptic / panopticaudit.com, audit de site tout-en-un, cible PME/agences/CTO. Si la cible réelle est différente (ex. grands comptes uniquement), les pondérations changent.
- **Notes des concurrents** : estimées à partir de sources publiques limitées ; Perplexity n'a pu vérifier le pricing/traction que pour Lumar (~32 k$/an médian) et l'existence de squirrelscan. Les autres notes (Siteimprove, Semrush, Snyk) reposent sur la connaissance générale du marché, pas sur des sources fraîches vérifiées — à traiter comme des ordres de grandeur, pas des mesures.
- **Traction de Panoptic = 0 client** : supposé (aucune table clients peuplée, aucun paiement possible, projet d'une semaine). Non infirmé par le repo. Si des pilotes existent hors dépôt, le corriger.
- **« Aucun paiement/compte »** : établi par absence de code correspondant. Il est possible qu'un système existe hors de ce repo (peu probable vu l'intégration).
- **Comportement du backend Render en production** (rate-limit réel sur `/api/audits`, monitoring) : partiellement supposé — le code `_guard.mjs` protège la fonction Netlify gratuite ; je n'ai pas pu confirmer une protection équivalente sur l'endpoint Render au-delà du hash de clé.
- **Scores concurrents non pondérés par région** : le mandat mentionne « mondiaux + régionaux » ; je n'ai pas trouvé de concurrent régional spécifique (ex. francophone) vérifiable, donc l'axe régional est absent faute de preuve.
