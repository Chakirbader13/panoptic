# Panoptic — kit de lancement Product Hunt

Tout est prêt à copier-coller. Le copy PH est en **anglais** (audience mondiale de PH),
les consignes en français. Rien n'est inventé : chaque claim correspond au produit réel
(moteur déterministe, 15 agents, code + prod, chiffrage €, scan gratuit, correctifs
verrouillés, intégrations, CLI/MCP, 6 langues, pages comparatives).

> ⚠️ Ce que je NE peux pas faire pour toi : créer le post, publier, solliciter des votes.
> Ce sont des actions sortantes depuis ton compte. Le kit rend le jour J copier-coller.
> Règle PH à respecter absolument : **ne jamais demander un upvote** ("upvote me" =
> pénalité / shadow-ban). On demande "check it out", "feedback", "questions". Voir §7.

---

## 1. Fiche produit (les champs du formulaire PH)

| Champ | Valeur |
|---|---|
| **Name** | Panoptic |
| **Tagline** (≤ 60 car.) | option A ci-dessous |
| **Website** | https://panopticaudit.com |
| **Topics** (3–4) | Developer Tools, SEO, Web App, No-Code (ou Marketing) |
| **Pricing** | Freemium (scan gratuit, offre payante pour multi-pages + correctifs) |
| **Launch tags** | #seo #security #accessibility #devtools #website-audit |

### Taglines (≤ 60 caractères, choisis-en une)

- **A.** `One audit for SEO, security, speed, a11y and GDPR` (49) ← recommandée, claire
- **B.** `Full-site audit: code + production, 15 experts in one` (53)
- **C.** `Replace 6 site-audit tools with one honest engine` (49)
- **D.** `Audit your whole website in 2 minutes, no false alarms` (54)

Compte les caractères avant de coller (PH tronque à 60).

---

## 2. Description (le "description" du post, ~260 car. max recommandé)

> Panoptic audits your **entire website in one pass** — SEO, AI visibility (GEO),
> performance, security, accessibility (WCAG/EAA), GDPR, conversion — across both your
> **code and your live production**. A deterministic engine (no LLM guessing on your
> code) runs 15 specialized agents, then an adversarial pass kills false positives.
> Every finding is costed in €, with a fix — down to the pull request. Free scan to start.

Version courte (si PH limite plus) :

> One website audit for SEO, security, speed, accessibility and GDPR — code + production,
> 15 experts, every issue costed in € with a fix. Free scan.

---

## 3. Le premier commentaire du maker (LE plus important)

C'est ce que les gens lisent en premier. À poster toi-même, en tant que maker, dès la
mise en ligne. Personnel, honnête, il raconte le "pourquoi".

```
Hi Product Hunt 👋 — I'm Chakir, maker of Panoptic.

I got tired of running six tools to know if a website was actually healthy: one for SEO,
one for security headers, one for accessibility, one for Core Web Vitals, one for GDPR,
one for conversion — each with its own dashboard, its own false positives, none of them
looking at the code AND the live site together.

Panoptic is the tool I wanted: paste a URL, get one audit across 15 domains, code +
production. Two things I care about most:

1. It's deterministic. No LLM guessing on your code — the same site always gives the same
   result. Then an adversarial verification pass removes false positives, because one wrong
   "critical" destroys trust (I killed a nasty one this week: it was flagging the standard
   www↔apex canonical as a cross-domain leak — it isn't).

2. Every finding is translated into money (risk/gain in €) and comes with a fix — for paid
   scans, all the way to a pull request. Re-audits run on each deploy.

The free scan is a real single-page audit (fixes are gated). Multi-page, authenticated
scans, the repo-aware agents and the auto-fixes are the paid tier.

I'd genuinely love your feedback — especially: what would make you trust an automated
audit enough to act on it? Happy to answer anything about how the engine works.
```

---

## 4. Galerie — shot list (les visuels du post)

PH montre 1 thumbnail + jusqu'à ~8 images/GIF. Ordre qui convertit :

1. **Hero / GIF (2–6 s)** — coller une URL → le scan qui tourne → le score X/100 qui
   s'affiche + les cartes de constats. C'est la démo produit, elle doit être la 1re.
2. **Le rapport chiffré** — une carte de constat réelle : sévérité, impact en €, correctif.
   (Montre le chiffrage €, c'est le différenciateur que personne d'autre n'a.)
3. **Vue "code + production"** — un constat tracé à la ligne de code À CÔTÉ d'un constat prod.
4. **Les 15 agents** — la grille des domaines couverts (SEO, GEO, sécu, a11y, RGPD, CRO…).
5. **La matrice comparative** — "remplacez 6 outils" (reprendre /comparatif/).
6. **La vérification anti-faux-positif** — schéma : constat → N sceptiques → rejeté/confirmé.
7. **Intégrations** — Slack / Jira / GitHub PR + CLI/MCP (pour l'audience Developer Tools).
8. **Multilingue / re-audit continu par deploy** (optionnel).

Format : 1270×760 px (ratio PH), fond obsidienne du site, zéro texte illisible en vignette.
> Dis-moi si tu veux que je génère ces visuels (le hero GIF + les slides) — c'est le
> prolongement naturel de ce kit.

---

## 5. Planning du jour J (Product Hunt tourne en **PST / heure Californie**)

Le "jour PH" commence à **00:01 PST**. Poster tôt = journée complète pour accumuler.

| Heure PST | Heure Paris | Action |
|---|---|---|
| **00:01** | 09:01 | Le post passe en live (programmé la veille, voir §8). |
| 00:05 | 09:05 | Toi (maker) postes le **premier commentaire** (§3). |
| 00:15 | 09:15 | 1re vague : préviens ton réseau proche (§6) — "on est live", PAS "upvote". |
| Matin | Matinée | Réponds à CHAQUE commentaire sous 15 min. L'engagement pèse plus que les votes. |
| 12:00 | 21:00 | 2e vague réseau + post LinkedIn/X (§6). |
| Journée | — | Pose le badge "Live on PH" sur panopticaudit.com (§9). |
| 23:59 | 08:59 (J+1) | Dernier push. Remercie tout le monde en commentaire. |

Choisis un **mardi, mercredi ou jeudi** (trafic PH max, moins de méga-lancements que le lundi).

---

## 6. Messages de réseau (sollicitation — SANS demander de vote)

### DM / WhatsApp (court)

```
Salut [Prénom] — on est live sur Product Hunt aujourd'hui avec Panoptic (audit de site
tout-en-un). Si tu as 30 s, un regard et un retour honnête me seraient super utiles :
[URL du post PH]. Pas besoin de compte pour lire. Merci 🙏
```

### Email (liste / contacts)

```
Objet : Panoptic est live sur Product Hunt

Bonjour,

Petit jour important : Panoptic — l'audit de site tout-en-un (SEO, sécurité, perf,
accessibilité, RGPD, conversion, code + production) — est en lancement sur Product Hunt
aujourd'hui.

Si le sujet vous parle, jetez-y un œil et dites-moi ce que vous en pensez, surtout les
critiques : [URL du post PH].

Merci pour le coup de pouce,
Chakir — panopticaudit.com
```

### LinkedIn / X (post public)

```
We just launched Panoptic on Product Hunt 🚀

One audit for your whole website — SEO, security, speed, accessibility, GDPR — across code
AND production. Deterministic engine, 15 experts, every issue costed in € with a fix.

Would love your feedback (link in comments 👇). What makes you trust an automated audit?
```

> Le lien PH en **commentaire** du post LinkedIn/X (l'algo pénalise les liens sortants
> dans le corps). Jamais "upvotez" — "feedback", "check it out".

---

## 7. Règles Product Hunt à ne PAS enfreindre

- ❌ **Ne demande jamais un upvote** (DM, email, post, commentaire). PH détecte et pénalise.
  ✅ Demande : "check it out", "your feedback", "questions welcome".
- ❌ Pas de votes achetés / faux comptes / VPN farm → shadow-ban immédiat.
- ❌ Pas de lien PH direct qui dit "vote here". ✅ Lien vers le post, l'action reste libre.
- ✅ Réponds à tous les commentaires : c'est le signal n°1 pour le ranking PH.
- ✅ Un **hunter** n'est plus nécessaire (tu peux te "self-hunt"). Si tu en veux un connu,
  contacte-le ≥ 1 semaine avant — mais self-hunt est parfaitement OK aujourd'hui.
- ✅ Tu peux offrir une **promo PH** (ex. code sur l'offre payante) — annonce-la dans le
  premier commentaire. Bon pour la conversion, autorisé.

---

## 8. Checklist de préparation (à faire AVANT le jour J)

- [ ] Compte Product Hunt créé + profil maker complet (photo, bio, X/LinkedIn liés). *(toi)*
- [ ] Tagline choisie (§1) et comptée < 60 car.
- [ ] Description collée (§2).
- [ ] Premier commentaire prêt dans un bloc-notes (§3).
- [ ] Galerie : thumbnail + 5–8 visuels exportés (§4).
- [ ] Post **programmé** la veille pour 00:01 PST (PH permet le scheduling).
- [ ] Liste réseau prête (DM/email/LinkedIn) — §6, PAS d'envoi avant le live.
- [ ] Badge "Live on PH" prêt à déployer sur le site (§9).
- [ ] Jour choisi = mardi/mercredi/jeudi.
- [ ] (Option) promo PH décidée + code créé côté paiement.

---

## 9. Badge "Live on Product Hunt" sur le site (le jour J)

Product Hunt fournit un badge officiel `<a><img>` avec ton **post id**. Il n'existe qu'une
fois le post en ligne — donc à poser le jour J, pas avant (sinon vignette vide).

Snippet à insérer (remplace `POST_ID` et le slug par les vrais, donnés par PH) :

```html
<a href="https://www.producthunt.com/posts/panoptic?utm_source=badge-featured&utm_medium=badge"
   target="_blank" rel="noopener">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=POST_ID&theme=dark"
       alt="Panoptic - Product Hunt" width="250" height="54" style="width:250px;height:54px" />
</a>
```

Emplacement conseillé : le hero de la home, sous le CTA, le temps du lancement (retirer
après). Dis-moi le jour J : je pose le snippet et je déploie en 2 min.

---

## 10. Playbook de réponses aux commentaires (anticipe les questions)

- **"How is this different from Semrush/Ahrefs?"** → "They're deep on SEO/backlinks; Panoptic
  is cross-domain (SEO + security + a11y + GDPR + conversion) and looks at your code, not
  just the live URL. Side-by-side here: panopticaudit.com/comparatif/"
- **"Does it use AI on my code?"** → "No — the engine is deterministic, same input = same
  output. AI never sees or guesses on your code. That's a deliberate trust choice."
- **"False positives?"** → "Every finding goes through an adversarial verification pass that
  tries to refute it. I fixed a real one this week (www↔apex canonical)."
- **"Free vs paid?"** → "Free = a real single-page audit (fixes gated). Paid = multi-page,
  authenticated scans, repo-aware agents, auto-fixes to PR, continuous re-audit on deploy."
- **"Self-hosted / privacy?"** → "Ephemeral read-only clone, EU data (eu-west-3), hashed keys,
  no third-party LLM on your code. Details: panopticaudit.com/securite/"
- **"CLI / CI?"** → "Yes — `panoptic scan <url>`, a GitHub Action, and an MCP server."

---

## En résumé

Ce kit est le lancement clé en main. Il te reste 3 choses que je ne peux pas faire à ta
place : **créer le compte/post PH**, **publier**, **solliciter ton réseau**. Tout le reste
(copy, plan, réponses, badge) est prêt. Demande-moi les **visuels de galerie** quand tu
veux — c'est la suite logique.
