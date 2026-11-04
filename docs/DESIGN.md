---
type: Design Doc
title: "DESIGN — Second cerveau v2"
description: "Conception de la v2 : architecture, CLI brain (Bun), dépendances, feuille de route."
---
# DESIGN — Second cerveau v2

> Statut : proposition (2026-11-04). Issu du croisement de deux analyses indépendantes (Opus et Fable).
> Remplace l'approche v1 (pipeline multi-agents + GitHub Actions) de ce dépôt.

## 1. Pourquoi une v2

La v1 a produit plus de machinerie que de connaissance :

| Machinerie | Contenu produit |
|---|---|
| 100 commits en 14 jours, puis 14 mois de silence | 7 notes (~12 Ko), 6 sur 7 sur les LLM |
| 5 agents, 4 schémas JSON de handoff, 6 GitHub Actions, `rules.yaml` | `zettels/`, `summaries/`, `archive/` vides |
| 4 changements de stack en 10 jours (Bash → Go → Cobra → Bun → opencode) | 3 notes « context rot » redondantes, jamais dédupliquées |
| Index rédigé par un LLM | `index.md` pointe vers des fichiers qui n'existent pas |
| CI de validation des handoffs | `writer_to_organizer.schema.json` est du JSON invalide (ligne 90) |

**Causes :**
1. Une architecture d'entreprise pour un usage solo.
2. Un LLM mis à la mauvaise place : on lui a confié la plomberie, sans humain pour le jugement.
3. Un traitement asynchrone par cron, sans feedback immédiat.
4. Une dépendance à GitHub (secrets qui expirent, CI qui fait tourner un LLM).
5. Aucune opération de consultation.

**À garder :** Markdown + frontmatter, la séparation entre capture brute et connaissance durable, l'opération « URL → résumé sourcé ».

## 2. Fondations

### LLM Wiki (Karpathy)

Le LLM **compile** les sources une fois pour toutes dans un wiki interlié, puis le maintient. Ce n'est pas du RAG : on ne re-cherche pas dans le brut à chaque question.

Trois couches :
- **raw** : les sources, immuables ;
- **wiki** : les pages écrites par le LLM ;
- **schéma** : `BRAIN.md`, qui fixe les conventions et les workflows.

Trois opérations :
- **ingest** : une source peut toucher 5 à 15 pages ;
- **query** : une bonne réponse est rangée dans le wiki ;
- **lint** : contradictions, orphelins, trous, affirmations périmées.

`index.md` sert de catalogue et `log.md` de journal.

### OKF v0.2 (sous-ensemble retenu)

Il faut suivre la **SPEC v0.2**. Le billet de blog Google décrit la v0.1, où `timestamp` est devenu `generated.at` et `# Citations` est devenu `sources`.

**Ce qu'on retient :**
- `type` est le seul champ obligatoire. Les champs recommandés sont `title`, `description` et `tags`.
- `sources[]` (`id`, `resource`, `title`), avec des notes de bas de page `[^id]` qui attribuent chaque affirmation à sa source.
- `generated: {by, at}`, avec la convention d'acteurs `human:franck`, `claude-code/opus-5.5` et `brain-cli/0.1`.
- `verified` quand une page a été relue (avec `human:franck`).
- `status` (`draft`, `stable` ou `deprecated`) et, en option, `stale_after`.
- Des liens Markdown relatifs à la racine (`/wiki/concepts/x.md`). Un lien cassé est toléré : il signale une connaissance pas encore écrite.
- `index.md` et `log.md` sont des noms réservés.

**Ce qu'on ignore :** les Attested Computations (§10), `usage_count` et `usage_window`, et la couche BigQuery/Knowledge Catalog.

Le bénéfice : le wiki reste lisible par Obsidian, par le visualiseur OKF et par n'importe quel agent, sans SDK.

## 3. Principe directeur

**Le CLI fait le déterministe, le LLM fait le jugement. Le CLI n'écrit jamais une page du wiki.**

| CLI `brain` | Agent (Claude Code / opencode / codex) |
|---|---|
| fetch, extraction en Markdown, hash et dédup, écriture dans `raw/` | décider ce qu'une source apporte |
| index de recherche (SQLite FTS5), `search` | créer et mettre à jour les pages, relier, signaler les contradictions |
| générer `wiki/index.md` à partir des frontmatters, ajouter au `log.md` | répondre aux questions en citant, ranger les réponses |
| `lint` structurel | résoudre ce que le lint remonte (fusionner, déprécier, créer) |
| serveur MCP | décrire les images, résumer les transcripts |

**Par défaut, le CLI n'embarque aucun SDK LLM.** L'agent est une session de ton harness existant, avec `BRAIN.md` comme instructions et `brain` comme outil.

**Le CLI ne fournit pas les agents.** `claude`, `codex` ou `opencode` doivent déjà être installés et authentifiés sur le poste. `brain` les pilote, sans jamais les embarquer ni les installer.

**Les SDK sont optionnels, chargés à la demande** quand `config.json` nomme un client. Ils servent seulement à mieux tirer parti de l'agent, en premier lieu pour bloquer les écritures hors de `wiki/` avant qu'elles aient lieu. Dans le code, c'est un pattern Bridge :
- **l'abstraction**, ce sont les commandes `compile` et `ask` (`agent.ts`), qui ne connaissent que l'interface `Backend` (`interactive`, `run`) ;
- **les implémentations** sont dans `cli/src/backends/` : `default.ts` (agnostique, sous-processus), `claude.ts`, `codex.ts` et `opencode.ts`.

Garde-fous vérifiés le 2026-11-04 par des essais où l'agent tentait d'écrire dans `raw/` :

| Client | Mécanisme | Résultat |
|---|---|---|
| Défaut (agnostique, n'importe quelle CLI) | dépôt en lecture seule sauf `wiki/` : bubblewrap sous Linux, `sandbox-exec` sous macOS | `raw/` en « EROFS: read-only file system », `wiki/` inscriptible |
| Claude (Agent SDK) | `canUseTool` sur chaque appel d'outil, `settingSources: ["project"]`, rien d'approuvé d'office | écriture et shell hors de `wiki/` refusés |
| Codex (SDK) | bac à sable `workspace-write` lancé depuis `wiki/` | `raw/` et `BRAIN.md` en « Read-only file system » (`/tmp` reste toujours inscriptible) |
| opencode v2 (API REST de `opencode serve`) | règles de permission, la dernière qui correspond l'emporte | `edit` refusé hors de `wiki/*`, shell refusé hors de `brain` |

Les sessions interactives, quel que soit le client, passent aussi par ce confinement : une validation humaine trop rapide ne peut pas écrire hors de `wiki/`. Dans tous les cas, `git status` avant et après l'agent reste le filet de sécurité commun.

*Prérequis :* `bwrap` sous Linux (`apt install bubblewrap`). Sous macOS, `sandbox-exec` est intégré au système. La variante macOS n'est pas encore testée sur une vraie machine.

## 4. Arborescence

```
brain/
├── BRAIN.md          # schéma : conventions + workflows (CLAUDE.md, AGENTS.md → symlinks)
├── DESIGN.md
├── raw/              # immuable, écrit par le CLI (ou à la main à l'étape 0)
│   └── 2026/11/20261104-a7k3-context-rot/
│       ├── source.md # extraction + frontmatter
│       └── assets/   # images ≤ ~500 Ko
├── wiki/             # écrit par l'agent
│   ├── index.md      # GÉNÉRÉ (jamais rédigé par l'agent une fois le CLI disponible)
│   ├── log.md        # append-only
│   ├── sources/      # type: Source — une page résumé par source raw
│   ├── concepts/     # type: Concept
│   ├── entities/     # type: Entity (personnes, outils, projets, organisations)
│   └── syntheses/    # type: Synthesis — réponses rangées, comparaisons
├── inbox/            # zone de dépôt synchronisée (mobile), vidée par `brain inbox`
└── .brain/           # gitignored : index.sqlite, blobs/<sha256>, cache
```

**Binaires :** les PDF, vidéos, audios et DOCX vont dans `.brain/blobs/` (content-addressed, **hors git**) et sont référencés par `blob:`. Pour une vidéo, on ne garde jamais le fichier, seulement le transcript et une vignette. La connaissance est dans le Markdown, l'original n'est qu'un confort.

## 5. Formats

Le format de `raw/.../source.md` et celui des pages du wiki sont définis dans [BRAIN.md](BRAIN.md), qui fait foi.

**Identifiants :**
- raw : `YYYYMMDD-<4 caractères aléatoires>-<slug>` ;
- wiki : un slug stable, sans UUID.

## 6. CLI `brain`

**Les commandes du MVP passent en premier.** Les autres arrivent quand le besoin est ressenti.

| Commande | Étape | Rôle |
|---|---|---|
| `brain add <url\|fichier\|-> --note "…"` | 1 | extrait, déduplique (hash du contenu normalisé + URL canonique), écrit dans `raw/`, indexe, ajoute au log. Idempotent. |
| `brain search "<q>" [--in wiki\|raw] [--json]` | 1 | BM25 FTS5, sur le wiki d'abord |
| `brain index` | 1 | régénère `wiki/index.md` à partir des frontmatters |
| `brain lint [--json]` | 2 | frontmatter (`type`, `description`), liens cassés, orphelins, raw `pending`, `stale_after` dépassé, doublons probables, pages modifiées depuis leur relecture (`generated.at` > `verified.at`) |
| `brain compile [id…\|--pending] [--batch]` | 2 | lance l'agent configuré, **une session par source** : interactif par défaut (la CLI du client, ou `$BRAIN_AGENT`), ou `--batch` (le SDK du client configuré, sinon `$BRAIN_AGENT_BATCH`, par défaut `claude -p`), qui écrit en `draft` sans validation préalable. Refuse une `note` vide. Ne passe en `compiled` que si une page Source cite la source (ligne remplacée, sans ré-sérialiser le YAML). Signale toute modification hors de `wiki/` (via `git status`). Régénère l'index. Lance le ingest, puis passe le statut à `compiled` |
| `brain ask "<q>" [--file]` | 2 | même mécanisme avec le workflow query, **en lecture seule**. `--file` autorise à écrire une synthèse en `draft` |
| `brain config init\|lint\|get\|set\|remove` | 2 | squelette de `config.json` (clés `client`, `model`, `effort` à `null`), contrôle, lecture et écriture validée des propriétés. L'effort est traduit pour chaque client : `effort` (Claude), `modelReasoningEffort` (Codex), variante du modèle (opencode, `modèle#variante` en CLI) |
| `brain mcp` | 3 | serveur MCP stdio : `search`, `get`, `related`, `lint`, `add`, `log` |
| `brain inbox` | 4 | `add` sur tout le contenu de `inbox/` (fichiers et `urls.txt`) |
| `brain export [--out <dossier>]` | 6 | site HTML statique du wiki (voir §10 bis), avec une page de graphe interactive |
| `brain related`, `ls`, `show`, `doctor`, `reextract` | à la demande | — |

**Détection des extractions tronquées dans `brain add`.** Leçon de l'étape 0 : defuddle a coupé l'article OKF de Google au milieu (841 mots au lieu de 1 577), sans erreur ni avertissement. `brain add` doit comparer le nombre de mots extraits à celui du texte visible de la page. Sous un seuil (à calibrer, par exemple 70 %), il relance avec Readability + Turndown, garde le résultat le plus long, et marque `partial: true` si les deux extractions restent courtes. Paywall et blocage Cloudflare (corps vide) produisent un refus explicite.

**Heuristique retenue à l'étape 1** (calibrée sur les 21 sources de l'étape 0). La comparaison au texte visible de la page a été abandonnée : la navigation et les blocs « articles liés » de Next la faussent. `brain add` lance **defuddle et Readability + Turndown à chaque fois** et garde Readability si son texte est **plus de 1,3 fois plus long**. Seul OKF bascule, et aucune autre source ne perd de contenu. `partial:` est posé sur des **marqueurs de paywall vérifiés** dans le HTML : « Il reste N % de l'article » pour Next, « This post is for paid subscribers » pour Substack. Ils retrouvent exactement les 3 sources partielles. Un statut HTTP d'erreur ou un corps de moins de 50 mots est refusé. *Limite connue :* une coquille de page servie avec un statut 200 (en-tête Medium sans article, par exemple) passe ce seuil. La relecture au compile la rattrape.

L'index SQLite est un **cache reconstructible**, jamais une source de vérité.

## 7. Extraction

On compose des outils existants, sans chercher un extracteur universel natif. Chaque extracteur produit un `source.md` normalisé et note son nom dans `extractor:`, pour pouvoir ré-extraire plus tard.

| Source | Méthode |
|---|---|
| Texte, Markdown, note | lecture directe |
| Page web | fetch + Readability + HTML→Markdown, URL canonique, métadonnées OpenGraph, images téléchargées localement |
| PDF texte | `pdftotext` (poppler) |
| DOCX, PPTX, ODT | `pandoc` |
| Image | stockée telle quelle ; **l'agent la décrit** au compile, grâce à sa vision. OCR local `tesseract.js` en option. |
| Vidéo, podcast | `yt-dlp` (sous-titres en priorité), sinon audio → `ffmpeg` → Whisper via `@huggingface/transformers` |
| PDF scanné | vision de l'agent |

Si un outil externe manque, le CLI affiche un message clair.

## 8. Recherche (sans RAG)

1. **Divulgation progressive** : l'agent lit `wiki/index.md`, choisit les pages et les lit en entier. L'unité de retrieval est **la page compilée**, jamais un chunk.
2. **FTS5 BM25** pour les termes précis, sur `wiki/` puis `raw/`. Un résultat qui ne se trouve que dans `raw/` signale un trou à compiler.
3. **Graphe** : liens, tags et sources partagées.
4. **Embeddings** (`sqlite-vec` + modèle multilingue, fusion RRF) seulement si le rappel se dégrade de façon mesurable. Retour d'expérience : grep + lecture restent fiables sous 50 à 100K tokens de wiki.

## 9. Langage du CLI : Bun

> **Décision (2026-11-04) : Bun (TypeScript).** Elle ne sera pas rouverte. Le contrat, c'est le format des fichiers.

Le CLI fait surtout de la **colle** : fetch HTTP, extraction HTML, SQLite, YAML, appels à des outils externes, MCP. La performance ne compte pas à l'échelle de quelques milliers de fichiers.

| Critère | Bun (TypeScript) | Rust |
|---|---|---|
| Extraction web | `@mozilla/readability`, l'implémentation de référence, + `turndown` | des ports de Readability, moins éprouvés |
| SQLite FTS5 | `bun:sqlite` intégré | `rusqlite` (bundled), solide |
| MCP | SDK officiel TypeScript | `rmcp`, plus jeune |
| Binaire unique | `bun build --compile` (~50-90 Mo) | natif, petit |
| Robustesse, typage | correcte | excellente |
| Vitesse pour atteindre le MVP | élevée | plus lente |

**Choix retenu : Bun**, pour la vitesse d'arrivée au MVP et l'écosystème (Readability, SDK MCP officiel, `bun:sqlite`).

Le risque n'est pas le langage, c'est de **changer de langage** (cf. v1). On choisit une fois et on n'y revient pas. Le contrat, c'est le format des fichiers, pas le code : le CLI reste réécrivable sans toucher au wiki.

### Dépendances

Exploration du 2026-11-04 sous Bun 1.4.3. La documentation a été vérifiée via Context7, et chaque brique a été exécutée sur des cas réels.

**Runtime — cœur (6)**

| Package | Version | Rôle | Pourquoi celui-là |
|---|---|---|---|
| `defuddle` | `0.19.6` (épinglée exacte, car 0.x) | page web → Markdown, plus les métadonnées (titre, auteur, date de publication, image, schema.org) | Moteur d'Obsidian Web Clipper (kepano), ~9,9k ★, releases toutes les semaines. Extracteur principal. |
| `linkedom` | `^0.18` | DOM côté serveur pour defuddle | Léger, très actif. `jsdom` reste compatible en secours. |
| `@mozilla/readability` + `turndown` | `^0.6` / `^7` | repli quand defuddle tronque | Implémentation de référence de Firefox. Passés du plan B au cœur dès l'étape 0 : defuddle a tronqué l'article OKF sans prévenir (voir §6). |
| `@modelcontextprotocol/server` | `^2.4` | `brain mcp` (`serveStdio`) | SDK officiel v2, qui ne dépend que de `zod` et `core` (la v1 `@modelcontextprotocol/sdk` tirait express, hono, cors, ajv…) |
| `zod` | `^4` | schémas d'entrée des outils MCP | Requis par le SDK MCP |

**Runtime — optionnel, chargé à la demande (`await import()`) (2)**

| Package | Version | Rôle | Coût |
|---|---|---|---|
| `@huggingface/transformers` | `^4.3` | transcription Whisper (ONNX), **remplace `whisper.cpp`** | ~580 Mo dans `node_modules` (`onnxruntime-node`/`web`) + modèle téléchargé au premier usage (whisper-small q8 = 241 Mo, voir plus bas). |
| `tesseract.js` | `^7` | OCR local en WASM, **remplace `tesseract`** | ~44 Mo + modèle de langue (`fra`). Test : 0,4 s, texte français exact. |

Ces deux packages sont rangés en `optionalDependencies` et chargés uniquement par les extracteurs audio et image. Le cœur reste léger.

**Runtime — SDK d'agents, chargés seulement si `config.json` nomme le client (2)**

| Package | Version | Rôle | Coût |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `^0.3.318` | `"client": "claude"` | 5 Mo, plus ses pairs `@anthropic-ai/sdk` (25 Mo) et `@modelcontextprotocol/sdk` (6 Mo). Fonctionne avec l'abonnement Claude. |
| `@openai/codex-sdk` | `^0.166.0` | `"client": "codex"` | 100 Ko. Réutilise la connexion `codex login`. |

Ces SDK ne sont que des surcouches qui pilotent la CLI de l'agent. Ils tirent en dépendances optionnelles un binaire par plateforme : ~630 Mo pour Claude (glibc + musl), ~440 Mo pour Codex. Le CLI les en dispense : il installe avec `bun install --omit optional` et pointe les SDK vers les CLI déjà installées (`pathToClaudeCodeExecutable`, `codexPathOverride`). Bilan : `node_modules` pèse ~97 Mo au lieu de ~1,2 Go. En contrepartie, la CLI installée (`claude`, `codex`) doit rester dans une version compatible avec le SDK.

opencode n'a pas de SDK : le seul publié, `@opencode-ai/sdk` 1.19.5, ne parle pas l'API d'opencode v2 (routes `/api/…`, authentification Basic, nouveau format de permissions). `opencode.ts` appelle directement l'API REST d'`opencode serve`. Modèle par défaut : `opencode/big-pickle`.

*À revoir à l'étape 5 :* `--omit optional` écartera aussi `@huggingface/transformers` et `tesseract.js`. Il faudra alors les passer en dépendances normales chargées à la demande, ou les installer explicitement.

**Points d'attention :**
- `onnxruntime-node` est un addon natif, il n'entre donc pas dans un binaire `bun build --compile`. La transcription n'est disponible que dans un `brain` installé via `bun install`.
- L'OCR local n'est qu'un secours : la vision de l'agent fait mieux (description + texte).
- **Modèle Whisper retenu : `onnx-community/whisper-small` (q8, 241 Mo), avec `language: "french"`.**
  - Test sur 60 s de lecture LibriVox en français : texte complet, ponctuation correcte, quelques noms propres écorchés.
  - Vitesse : 20 s par minute d'audio, soit ~3× le temps réel (un podcast d'1 h ≈ 20 min).
  - `whisper-base` (9 s/min) **saute un passage entier** et déforme beaucoup de mots.
  - `whisper-large-v3-turbo` (1,1 Go, 32 s/min) **perd aussi un passage** et toute la ponctuation en q8 : il ne vaut pas son coût.

**Dev (2) :** `@types/bun`, `@types/turndown`.

**Intégré à Bun, donc aucune dépendance :**

| Besoin | Brique Bun |
|---|---|
| index BM25 | `bun:sqlite` (FTS5 + `bm25()`) |
| frontmatter YAML | `Bun.YAML.parse` / `stringify` |
| parsing des arguments CLI | `node:util` `parseArgs` |
| sha256 | `Bun.CryptoHasher` |
| parcours de fichiers | `Bun.Glob` |
| HTTP | `fetch` |
| outils externes | `Bun.spawn` |
| tests | `bun test` |
| binaire | `bun build --compile` |

Écartés : `commander`/`citty`, `yaml`/`gray-matter`, `better-sqlite3`, `vitest`, `nodejs-whisper`/`smart-whisper` (ils compilent whisper.cpp), et le SDK MCP v1.

**Outils système, appelés via `Bun.spawn` :** `ffmpeg` (décodage audio, également requis par yt-dlp), `yt-dlp`, `pdftotext` (poppler) et `pandoc`. Tous sont disponibles dans les gestionnaires de paquets standard. `brain doctor` signale ceux qui manquent.

## 10. Feuille de route

- **Étape 0 — zéro code (1 semaine).** Mettre en place l'arborescence et `BRAIN.md`, migrer les 7 notes v1 comme premières sources, ingérer 5 sources réelles **sur des sujets variés** et poser 5 questions. *Critère de passage :* tu reviens consulter le wiki de toi-même.
- **Étape 1.** `add` (URL, texte, Markdown, PDF texte), `search`, `index`. *Critère :* 20 sources ingérées et `search` réellement utilisé.
- **Étape 2.** `lint`, `compile`, `ask`.
- **Étape 3.** `mcp`.
- **Étape 4.** `inbox`, avec un raccourci mobile « Partager → `inbox/urls.txt` ».
- **Étape 5.** Images, puis vidéo et audio.
- **Étape 6.** `export` : le wiki en site HTML statique, avec un graphe interactif, déployé automatiquement sur le homelab pour le parcourir depuis un navigateur.
- **Étape 7, seulement si nécessaire.** Embeddings, `reextract`.

## 10 bis. Export HTML et déploiement

**But :** parcourir le wiki depuis un navigateur, sur le homelab, sans Obsidian ni agent.

**`brain export` produit un site statique**, sans serveur applicatif. C'est une étape déterministe, sans LLM, comme `index` et `lint`.
- **Une page HTML par page wiki.** Le Markdown est rendu ; les liens `/wiki/…` deviennent des liens relatifs vers les pages HTML ; les notes de bas de page renvoient aux sources.
- **L'index, les tags et le log** deviennent des pages de navigation, générés depuis les frontmatters, comme `wiki/index.md`.
- **Chaque page affiche ses métadonnées OKF** : type, statut (`draft`, `stable`, `deprecated`), relue ou non, sources, et ses liens entrants (rétroliens).
- **Une page de graphe interactive**, à la manière de la vue graphe d'Obsidian. Les nœuds sont les pages, colorés par type ; les arêtes, les liens Markdown. On zoome, on déplace, on filtre par type ou tag, on ouvre une page en cliquant son nœud. Les données du graphe sont un JSON produit à l'export.
- **Une recherche plein texte côté navigateur**, sur un index JSON produit à l'export.
- **`raw/` n'est pas publié.** Les sources pointent vers leur URL d'origine. Le site ne contient que le wiki, que l'humain a relu ou peut relire.
- **Le site fonctionne hors ligne.** La bibliothèque de graphe (une seule, choisie à l'étape 6) est copiée dans le site plutôt que chargée depuis un CDN.

**Déploiement automatisé sur le homelab.** Le mécanisme exact se décide à l'étape 6, selon ce que le homelab expose. Les principes :
- l'export est reproductible : le même commit donne le même site, donc on peut le reconstruire n'importe où ;
- le déclencheur est un push sur `main` ; pas de LLM dans la chaîne (voir §11) ;
- le homelab sert des fichiers statiques derrière son reverse proxy, qui gère l'accès. Le wiki est personnel : il n'est pas exposé publiquement.

## 11. Non-goals

- pas de GitHub Actions ni de CI qui fait tourner un LLM ;
- pas de handoffs JSON ni de pipeline multi-agents ;
- pas de cron ni de synthèses périodiques automatiques : les synthèses naissent de questions ;
- pas d'ingestion sans lecture : le champ `note:` est obligatoire et l'humain reste dans la boucle ;
- pas de taxonomie de tags a priori : les tags émergent et le lint propose des fusions ;
- pas de SDK LLM obligatoire : le CLI reste agnostique par défaut, les SDK sont optionnels ;
- pas de RAG par chunks.

## Sources

- Karpathy, [LLM Wiki](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/ac46de1ad27f92b28ac95459c782c07f6b8c964a/llm-wiki.md)
- OKF : [README](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/README.md), [SPEC v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md), [billet Google Cloud (v0.1)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing?hl=en)
- Recherche locale : [qmd](https://github.com/tobi/qmd), [rqmd](https://docs.rs/crate/rqmd/0.1.1), [qrst](https://github.com/l1x/qrst)
- Implémentations du pattern : [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki), [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), [topic llm-wiki](https://github.com/topics/llm-wiki)
