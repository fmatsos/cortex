---
type: Schema
title: "CORTEX.md — schéma de Cortex, le second cerveau"
description: "Schéma de Cortex : conventions et workflows ingest/query/lint suivis par l'agent."
---
# CORTEX.md — schéma de Cortex, le second cerveau

Tu es le mainteneur de ce wiki personnel. L'humain (`human:franck`) choisit les sources, pose les questions et oriente. Toi, tu fais la comptabilité : résumer, relier, mettre à jour, signaler les contradictions. Ce fichier fait foi. Propose de le modifier quand une convention ne tient plus.

## Règles absolues

1. **`raw/` est immuable.** Tu le lis, tu ne le modifies jamais. Seule exception : passer le champ `status` d'une source de `pending` à `compiled`.
2. **Tu écris uniquement dans `wiki/`.** Une nouvelle source entre dans `raw/` par `cortex add`, jamais à la main.
3. **Toute affirmation factuelle est sourcée** par une note de bas de page `[^id]`, où `id` correspond à une entrée de `sources[]`. Si tu n'as pas de source, écris-le explicitement (« à vérifier »).
4. **Tu ne rédiges jamais `wiki/index.md` ni `wiki/log.md` à la main** : `cortex index` régénère le premier depuis les frontmatters, et `cortex log add` ajoute au journal (`wiki/log.jsonl`), dont `log.md` est généré.
5. **Tu mets à jour avant de créer.** Cherche d'abord une page existante (index, puis recherche). Un doublon vaut moins qu'une page enrichie.
6. **Tu restes dans la boucle avec l'humain.** À chaque ingest, présente ce que tu retiens et les pages que tu comptes toucher, puis écris.
7. Langue du wiki : **français**. Les citations et les titres de sources restent dans leur langue d'origine.

## Arborescence

```
raw/YYYY/MM/<uuid>/source.md # sources extraites (+ assets/)
wiki/index.md                # catalogue (réservé OKF, sans frontmatter)
wiki/log.jsonl               # journal append-only, source de vérité (une entrée JSON par ligne)
wiki/log.md                  # généré depuis log.jsonl (réservé OKF)
wiki/sources/<uuid>.md       # type: Source — une par source raw
wiki/concepts/<uuid>.md      # type: Concept — une idée
wiki/entities/<uuid>.md      # type: Entity — personne, outil, projet, organisation
wiki/syntheses/<uuid>.md     # type: Synthesis — réponse rangée, comparaison, thèse
```

- **Identifiants : des UUID v7**, pour les sources raw comme pour les pages wiki (horodatés puis aléatoires : uniques, sans collision de noms, triés dans l'ordre de création). Tu n'en inventes jamais : `cortex add` nomme une source, `cortex new` crée une page. Le nom d'un fichier ne dit rien de son contenu : une page se trouve par son **titre** (index, `cortex search`), et un lien se repère par son texte.
- **Un identifiant est définitif.** On ne renomme pas une page : on change son titre, son UUID reste.

## Format d'une source raw (`raw/.../source.md`)

```yaml
---
type: RawSource
title: "Titre d'origine"
url: https://…                # ou absent pour une note perso
kind: article                 # article | pdf | video | audio | image | note | repo | thread
sha256: …                     # rempli par le CLI
blob: .cortex/blobs/…          # original binaire éventuel, hors git
fetched_at: 2026-11-04T09:12:00+01:00
extractor: manual             # ou cortex-cli/0.1+readability, yt-dlp+whisper…
note: "Pourquoi je garde ça"  # OBLIGATOIRE : l'intention de l'humain
status: pending               # pending | compiled | skipped
---
<contenu extrait en Markdown>
```

Si le champ `note` manque, demande-le à l'humain avant de compiler.

## Format d'une page wiki (sous-ensemble OKF v0.2)

```yaml
---
type: Concept                       # Source | Concept | Entity | Synthesis (seul champ obligatoire)
title: Context rot
description: Une phrase, utilisée telle quelle dans l'index.
tags: [llm, context-engineering]    # 1 à 4, minuscules, à réutiliser plutôt qu'à inventer
status: draft                       # draft | stable | deprecated
generated: { by: claude-code/opus-5.5, at: 2026-11-04T10:00:00+01:00 }
sources:
  - id: chroma-context-rot
    resource: /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md
    title: "Context Rot (Chroma Research)"
# verified: { by: "human:franck", at: … }   ← ajouté seulement quand l'humain a relu
# stale_after: 2027-06-01T00:00:00+00:00    ← pour les sujets périssables (versions, prix)
---
Corps en prose. Une affirmation.[^chroma-context-rot] Voir [Context engineering](/wiki/concepts/01a1a5d1-2b40-7d10-8a77-c03f19e2b5a4.md).

[^chroma-context-rot]: Précision éventuelle (section, page, timestamp).
```

- **`generated.at`** : mets-le à jour à chaque modification significative. **`generated.by`** désigne toujours l'acteur réel.
- **Liens :** des liens Markdown relatifs à la racine (`/wiki/<type>/<uuid>.md`), avec le titre de la page cible comme texte. Un lien pointe toujours vers une page existante. Pour un concept à écrire, crée-le avec `cortex new` (une ébauche en `status: draft` suffit), puis lie-le.
- **Page relue puis modifiée :** garde l'entrée `verified` (c'est un événement passé), mais repasse en `status: draft`. Un `generated.at` postérieur à `verified.at` signifie qu'il faut relire la page.
- **Dépréciation :** une page contredite par une source plus récente n'est pas supprimée. Elle passe en `status: deprecated`, avec en tête un lien vers ce qui la remplace.
- **Page `Source` :** elle contient un résumé, 3 à 7 points clés, la `note` de l'humain, et des liens vers les concepts et entités touchés.
- **La `note` se recopie dans un encart**, en tête du corps, avec la syntaxe de callout d'Obsidian, sans autre mention :
  ```markdown
  > [!note] Note personnelle
  > <la note, telle quelle>
  ```
- **Une limite de la source (extraction partielle, paywall) va dans un encart Avertissement**, séparé de la note :
  ```markdown
  > [!warning]
  > Article partiel à cause du paywall : environ 30 % est extrait.
  ```

## `wiki/index.md`

Ce fichier n'a pas de frontmatter. Il contient une section par type, et une puce par page :

```markdown
# Index

## Concepts
- [Context rot](/wiki/concepts/01a1a5d1-2b40-7c3e-9f21-5d8e0a4b7c12.md) — <description>

## Entités
## Synthèses
## Sources
```

## `wiki/log.jsonl` et `wiki/log.md`

`wiki/log.jsonl` est le journal : une entrée JSON par ligne, ordre chronologique, append-only. `wiki/log.md` en est **généré** (lisible dans Obsidian, réservé OKF) : les entrées les plus récentes y viennent en premier, regroupées par date. **Tu n'écris jamais le journal à la main** : `cortex log add`.

```json
{"at": "2026-11-04T10:00:00+01:00", "kind": "ingest", "text": "créé Context rot, mis à jour Chroma.", "sources": ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], "pages": ["wiki/concepts/01a1a5d1-2b40-7c3e-9f21-5d8e0a4b7c12.md"]}
```

- `kind` : `add` | `ingest` | `query` | `lint` | `update`. `text` : une ligne de Markdown en ligne. `sources` (ids raw) et `pages` (chemins `wiki/….md`) sont facultatifs et validés : donne-les plutôt que de les recopier dans le texte.
- `cortex log add <kind> "<texte>" [--source <id>]… [--page <chemin>]…` écrit l'entrée avec l'heure courante et régénère `log.md`. Mets le texte entre guillemets doubles, sans `$` ni accent grave (guillemets simples si le texte en contient).
- `log.md` rend chaque entrée en puce `- **Kind** texte`, suivie des sources et pages (par leur titre) que le texte ne nomme pas déjà :

```markdown
## 2026-11-04
- **Ingest** créé Context rot, mis à jour Chroma. (sources : `01a1a5c9-5e80-7075-ae13-aab03b0a8697`)
- **Lint** 3 orphelins, 1 contradiction (Context rot vs Context engineering).
```

## Workflow INGEST

1. Lis la source raw en entier, y compris le champ `note`. Pour une image, décris-la grâce à ta vision. Pour un transcript, ignore le bruit oral.
2. Lis `wiki/index.md`, puis cherche les pages liées : `cortex search "<termes>"`.
3. **Présente à l'humain**, en 5 à 10 lignes, ce que la source apporte, ce qui contredit l'existant, et la liste des pages à créer ou modifier. Attends sa validation ou ses corrections.
4. Écris :
   - la page Source, créée par `cortex new Source "<titre>"` (le CLI affiche son chemin, puis tu remplis le fichier) ;
   - les mises à jour des concepts et entités existants, ou leur création par `cortex new Concept|Entity "<titre>"` si rien ne s'en approche ;
   - les liens dans les deux sens.
5. Passe la source raw en `status: compiled`, sauf si tu es lancé par `cortex compile`, qui s'en charge après avoir vérifié qu'une page Source la cite.
6. Lance `cortex index`. Ajoute l'entrée **Ingest** au journal : `cortex log add ingest "…" --source <id> --page wiki/…md` pour chaque page touchée (l'entrée **Add** y est déjà, écrite par `cortex add`).

Dans ta réponse, ne recopie pas les pages : résume en une ligne par fichier touché.

## Workflow QUERY

1. Lis `wiki/index.md`, choisis les pages pertinentes et lis-les **en entier**. Ne raisonne pas sur des extraits.
2. Si le wiki ne suffit pas, cherche dans `raw/` (`cortex search "<termes>" --in raw`). Une réponse trouvée seulement dans `raw/` signale un **trou** : propose de compiler la source concernée.
3. Réponds en citant les pages du wiki, avec leurs liens. Distingue ce que dit le wiki de ce que tu en déduis.
4. Si la réponse a de la valeur durable (comparaison, synthèse, décision), propose de la ranger dans `wiki/syntheses/` (`cortex new Synthesis "<titre>"`), puis journal (`cortex log add query "…" --page wiki/syntheses/….md`) et index.

## Workflow LINT

Lance `cortex lint --json`. Il remonte :
- **des erreurs** (code de sortie 1) : YAML invalide, `type` ou `description` manquant, lien cassé, note de bas de page sans entrée `sources[]`, ressource introuvable ;
- **des avertissements** : page orpheline, page modifiée depuis sa relecture, `stale_after` dépassé, source `pending` depuis plus de 7 jours ou sans `note`, source compilée qu'aucune page Source ne cite, doublons probables (même titre, même source raw), tags quasi synonymes ;
- **des infos** : pages jamais relues.

Ce que le CLI ne voit pas reste à ta charge : **les contradictions entre pages**.

Corrige ce qui est mécanique. **Propose** à l'humain ce qui demande du jugement (fusionner, déprécier, trancher une contradiction). Termine par une entrée **Lint** au journal (`cortex log add lint "…"`).

## CLI `cortex`

```
cortex add <url|fichier|-> --note "pourquoi je garde ça" [--dry-run]   # → raw/, status: pending, entrée Add au journal
cortex inbox [--dry-run]                                              # add sur inbox/ (urls.txt, fichiers), puis la vide
cortex search "<termes>" [--in wiki|raw] [--json]                     # BM25, wiki d'abord
cortex index                                                          # régénère wiki/index.md et wiki/log.md
cortex new <Source|Concept|Entity|Synthesis> "<titre>"               # crée wiki/<type>/<uuid>.md (draft) et affiche son chemin
cortex log [--limit N] [--json] [--kind k]                            # lit le journal, le plus récent d'abord
cortex log add <kind> "<texte>" [--source <id>]… [--page <chemin>]…   # ajoute une entrée à wiki/log.jsonl
cortex lint [--json]                                                  # contrôles mécaniques
cortex compile <id…> | --pending [--batch]                            # lance un agent sur INGEST
cortex ask "<question>" [--file] [--interactive]                      # lance un agent sur QUERY
cortex config init | lint | get [clé] | set <clé> <valeur> | remove <clé>   # config.json
cortex mcp                                                            # serveur MCP stdio (agents externes)
cortex export [--out <dossier>]                                       # le wiki en site HTML interactif (défaut : .cortex/site)
```

- `cortex add` est idempotent : une URL ou un contenu déjà présent renvoie l'id existant.
- `cortex inbox` ingère `inbox/` : `urls.txt` (une ligne `<url> [note…]`, `#` et lignes vides ignorées) et les autres fichiers (note facultative dans `<nom>.note`). Une entrée réussie (ajoutée ou déjà présente) en sort, un échec y reste (code de sortie 1). Sans note, la source attend sa `note` comme après `cortex add`.
- `partial:` signale une extraction incomplète (paywall). Dis-le dans la page Source.
- `cortex add` refuse un statut HTTP d'erreur ou un corps quasi vide. Ne contourne pas un paywall : demande le texte à l'humain, puis `cortex add -` en le passant sur l'entrée standard.
- **`cortex compile`** lance une session d'agent **par source**, l'une après l'autre (une session par tâche, contre le context rot).
  - **Par défaut, la session est interactive** : tu présentes ton plan à l'humain avant d'écrire (règle 6).
  - **Avec `--batch`, personne ne valide** : tu écris directement, et toutes les pages touchées passent en `status: draft` pour être relues ensuite.
  - Le CLI refuse une source dont la `note` est vide. Il passe le statut à `compiled` seulement si une page `wiki/sources/` cite la source, puis régénère l'index. Il signale tout fichier modifié hors de `wiki/`.
- **`cortex mcp` expose le wiki à un agent externe** : `search`, `get`, `related`, `lint`, `log` (entrées JSON des derniers jours, filtre `kind`) en lecture seule, et `add` (URL ou texte, dans `raw/` uniquement, `note` obligatoire). Il ne modifie jamais `wiki/` : l'ingest reste le travail de `cortex compile`.
- **`cortex export` publie le wiki en site statique** (navigation, recherche instantanée, graphe des liens) sans LLM ni serveur. Il ne lit que `wiki/` : `raw/` n'est jamais publié, les sources pointent vers leur URL d'origine. Le dossier de sortie est vidé à chaque export.
- **`cortex ask` est en lecture seule.** `--file` autorise à ranger la réponse dans `wiki/syntheses/` (en `draft`), avec l'entrée de journal, puis l'index et `log.md` sont régénérés.
- **L'agent est choisi par `config.json`** à la racine (`{ "client": "claude" | "codex" | "opencode", "model": "…", "effort": "…" }`), géré par `cortex config`, qui valide chaque écriture. `effort` prend le vocabulaire du client : `low`…`max` pour Claude, `minimal`…`xhigh` pour Codex, le nom d'une variante du modèle pour opencode. Modèle et effort valent pour le batch comme pour l'interactif.
  - **Sans `client`, le CLI reste agnostique** : `$CORTEX_AGENT` pour le mode interactif (défaut `claude`), `$CORTEX_AGENT_BATCH` pour `--batch` et `ask` (défaut `claude -p`, qui reçoit le prompt sur son entrée standard). L'agent tourne dans un bac à sable (bubblewrap sous Linux, `sandbox-exec` sous macOS) où tout le dépôt est en lecture seule, sauf `wiki/`.
  - **Avec un `client`**, `--batch` et `ask` passent par son SDK ou son API, et tes écritures sont bloquées hors de `wiki/` **avant** d'avoir lieu. Claude : un contrôle de chaque appel d'outil (Bash limité à `cortex search|index|lint`). Codex : un bac à sable OS lancé depuis `wiki/`. opencode : des règles de permission (`edit` limité à `wiki/*`, shell limité à `cortex`).
  - Le mode interactif lance la CLI du client (`claude`, `codex`, `opencode --prompt`), sauf si `$CORTEX_AGENT` est défini. Il est confiné de la même façon.
