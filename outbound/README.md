# Outbound agences — moteur d'audit personnalisé

L'angle que personne d'autre ne peut jouer : Panoptic audite **le site de l'agence
elle-même** (ou d'un de ses clients), et le mail froid **ouvre sur 3 vrais constats**
trouvés en 2 minutes, avec un lien vers le rapport public partageable. De la preuve, pas
de la promesse. Une agence audite beaucoup de sites : c'est l'ICP idéal (usage répété,
revente en marque blanche).

## Ce que fait le script

`agences.mjs` prend une liste de domaines, lance le **vrai moteur Panoptic** (déterministe,
free-tier mono-page, respectueux) sur chacun, sélectionne les 3 constats les plus vendeurs
(sévérité × confiance / effort, bonus si chiffré en euros ou visible en prod), et génère un
**brouillon de mail froid personnalisé** par agence.

Il **ne fait que générer des brouillons sur disque**. Il n'envoie AUCUN mail — l'envoi
reste 100 % manuel (tu relis, tu envoies depuis ta boîte).

## Usage

```bash
# quelques domaines directement
node outbound/agences.mjs agence-a.fr studio-b.com --from "Chakir <chakir@panopticaudit.com>"

# depuis une liste
node outbound/agences.mjs --file outbound/agences.txt --from "Chakir <chakir@panopticaudit.com>"

# en anglais + lien rapport public /r/:id joint a chaque mail
node outbound/agences.mjs --file outbound/agences.txt --lang en --share
```

### Options

| Option | Effet |
|---|---|
| `--file <path>` | liste de domaines (un par ligne, `#` = commentaire) |
| `--lang fr\|en` | langue du mail (défaut `fr`) |
| `--from "<sig>"` | bloc signature (défaut : placeholder `[Votre nom]` à remplir) |
| `--share` | publie un rapport public `/r/:id` via l'API live et l'insère dans le mail |
| `--out <dir>` | dossier de sortie (défaut `outbound/out`) |
| `--concurrency N` | audits simultanés (défaut 3 — on reste poli avec les sites tiers) |

## Sortie

- `outbound/out/<domaine>.txt` — le mail prêt à relire puis envoyer.
- `outbound/out/_index.csv` — récap : domaine, score, nb constats, top constat, lien rapport, fichier mail.

`outbound/out/` est git-ignoré (brouillons par-run, non versionnés).

## Garde-fous

- **Zéro chiffre inventé** : tout vient de l'audit réel. Si un site est propre, le mail le dit honnêtement.
- **Anti-doublon** : l'impact business n'est pas répété quand il duplique le titre du constat.
- **Respect des sites tiers** : mono-page, concurrence basse, échec d'un site n'arrête pas le lot.
- **Aucun envoi automatique** : le script produit des brouillons ; toi seul envoies.
