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

Le CLI n'embarque **aucun SDK LLM**. L'agent est une session de ton harness existant, avec `BRAIN.md` comme instructions et `brain` comme outil.

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
| `brain compile [id…\|--pending]` | 2 | lance l'agent configuré (`claude -p`, `opencode run`…) avec le workflow ingest, puis passe le statut à `compiled` |
| `brain ask "<q>" [--file]` | 2 | même mécanisme avec le workflow query |
| `brain mcp` | 3 | serveur MCP stdio : `search`, `get`, `related`, `lint`, `add`, `log` |
| `brain inbox` | 4 | `add` sur tout le contenu de `inbox/` (fichiers et `urls.txt`) |
| `brain related`, `ls`, `show`, `doctor`, `reextract` | à la demande | — |

**Détection des extractions tronquées dans `brain add`.** Leçon de l'étape 0 : defuddle a coupé l'article OKF de Google au milieu (841 mots au lieu de 1 577), sans erreur ni avertissement. `brain add` doit comparer le nombre de mots extraits à celui du texte visible de la page. Sous un seuil (à calibrer, par exemple 70 %), il relance avec Readability + Turndown, garde le résultat le plus long, et marque `partial: true` si les deux extractions restent courtes. Paywall et blocage Cloudflare (corps vide) produisent un refus explicite.

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

**Runtime — cœur (4)**

| Package | Version | Rôle | Pourquoi celui-là |
|---|---|---|---|
| `defuddle` | `0.19.6` (épinglée exacte, car 0.x) | page web → Markdown, plus les métadonnées (titre, auteur, date de publication, image, schema.org) | Moteur d'Obsidian Web Clipper (kepano), ~9,9k ★, releases toutes les semaines. Il remplace à lui seul Readability + Turndown. |
| `linkedom` | `^0.18` | DOM côté serveur pour defuddle | Léger, très actif. `jsdom` reste compatible en secours. |
| `@modelcontextprotocol/server` | `^2.4` | `brain mcp` (`serveStdio`) | SDK officiel v2, qui ne dépend que de `zod` et `core` (la v1 `@modelcontextprotocol/sdk` tirait express, hono, cors, ajv…) |
| `zod` | `^4` | schémas d'entrée des outils MCP | Requis par le SDK MCP |

**Runtime — optionnel, chargé à la demande (`await import()`) (2)**

| Package | Version | Rôle | Coût |
|---|---|---|---|
| `@huggingface/transformers` | `^4.3` | transcription Whisper (ONNX), **remplace `whisper.cpp`** | ~580 Mo dans `node_modules` (`onnxruntime-node`/`web`) + modèle téléchargé au premier usage (whisper-small q8 = 241 Mo, voir plus bas). |
| `tesseract.js` | `^7` | OCR local en WASM, **remplace `tesseract`** | ~44 Mo + modèle de langue (`fra`). Test : 0,4 s, texte français exact. |

Ces deux packages sont rangés en `optionalDependencies` et chargés uniquement par les extracteurs audio et image. Le cœur reste léger.

**Points d'attention :**
- `onnxruntime-node` est un addon natif, il n'entre donc pas dans un binaire `bun build --compile`. La transcription n'est disponible que dans un `brain` installé via `bun install`.
- L'OCR local n'est qu'un secours : la vision de l'agent fait mieux (description + texte).
- **Modèle Whisper retenu : `onnx-community/whisper-small` (q8, 241 Mo), avec `language: "french"`.**
  - Test sur 60 s de lecture LibriVox en français : texte complet, ponctuation correcte, quelques noms propres écorchés.
  - Vitesse : 20 s par minute d'audio, soit ~3× le temps réel (un podcast d'1 h ≈ 20 min).
  - `whisper-base` (9 s/min) **saute un passage entier** et déforme beaucoup de mots.
  - `whisper-large-v3-turbo` (1,1 Go, 32 s/min) **perd aussi un passage** et toute la ponctuation en q8 : il ne vaut pas son coût.

**Dev (1) :** `@types/bun`.

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

Écartés : `commander`/`citty`, `yaml`/`gray-matter`, `better-sqlite3`, `vitest`, `@mozilla/readability` + `turndown` (plan B si defuddle déçoit), `nodejs-whisper`/`smart-whisper` (ils compilent whisper.cpp), et le SDK MCP v1.

**Outils système, appelés via `Bun.spawn` :** `ffmpeg` (décodage audio, également requis par yt-dlp), `yt-dlp`, `pdftotext` (poppler) et `pandoc`. Tous sont disponibles dans les gestionnaires de paquets standard. `brain doctor` signale ceux qui manquent.

## 10. Feuille de route

- **Étape 0 — zéro code (1 semaine).** Mettre en place l'arborescence et `BRAIN.md`, migrer les 7 notes v1 comme premières sources, ingérer 5 sources réelles **sur des sujets variés** et poser 5 questions. *Critère de passage :* tu reviens consulter le wiki de toi-même.
- **Étape 1.** `add` (URL, texte, Markdown, PDF texte), `search`, `index`. *Critère :* 20 sources ingérées et `search` réellement utilisé.
- **Étape 2.** `lint`, `compile`, `ask`.
- **Étape 3.** `mcp`.
- **Étape 4.** `inbox`, avec un raccourci mobile « Partager → `inbox/urls.txt` ».
- **Étape 5.** Images, puis vidéo et audio.
- **Étape 6, seulement si nécessaire.** Embeddings, `reextract`, export HTML (visualiseur OKF).

## 11. Non-goals

- pas de GitHub Actions ni de CI qui fait tourner un LLM ;
- pas de handoffs JSON ni de pipeline multi-agents ;
- pas de cron ni de synthèses périodiques automatiques : les synthèses naissent de questions ;
- pas d'ingestion sans lecture : le champ `note:` est obligatoire et l'humain reste dans la boucle ;
- pas de taxonomie de tags a priori : les tags émergent et le lint propose des fusions ;
- pas de SDK LLM dans le CLI ;
- pas de RAG par chunks.

## Sources

- Karpathy, [LLM Wiki](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/ac46de1ad27f92b28ac95459c782c07f6b8c964a/llm-wiki.md)
- OKF : [README](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/README.md), [SPEC v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md), [billet Google Cloud (v0.1)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing?hl=en)
- Recherche locale : [qmd](https://github.com/tobi/qmd), [rqmd](https://docs.rs/crate/rqmd/0.1.1), [qrst](https://github.com/l1x/qrst)
- Implémentations du pattern : [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki), [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), [topic llm-wiki](https://github.com/topics/llm-wiki)
