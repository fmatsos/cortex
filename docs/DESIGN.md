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
| générer `wiki/index.md` à partir des frontmatters, générer `log.md` depuis `log.jsonl` (`brain log add` valide et ajoute une entrée) | répondre aux questions en citant, ranger les réponses |
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
│   ├── log.jsonl     # journal append-only, SOURCE DE VÉRITÉ (une entrée JSON par ligne), écrit par `brain log add`
│   ├── log.md        # GÉNÉRÉ depuis log.jsonl (lisible dans Obsidian, réservé OKF)
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
| `brain index` | 1 | régénère `wiki/index.md` à partir des frontmatters, et `wiki/log.md` à partir de `wiki/log.jsonl` |
| `brain lint [--json]` | 2 | frontmatter (`type`, `description`), liens cassés, orphelins, raw `pending`, `stale_after` dépassé, doublons probables, pages modifiées depuis leur relecture (`generated.at` > `verified.at`) |
| `brain compile [id…\|--pending] [--batch]` | 2 | lance l'agent configuré, **une session par source** : interactif par défaut (la CLI du client, ou `$BRAIN_AGENT`), ou `--batch` (le SDK du client configuré, sinon `$BRAIN_AGENT_BATCH`, par défaut `claude -p`), qui écrit en `draft` sans validation préalable. Refuse une `note` vide. Ne passe en `compiled` que si une page Source cite la source (ligne remplacée, sans ré-sérialiser le YAML). Signale toute modification hors de `wiki/` (via `git status`). Régénère l'index. Lance le ingest, puis passe le statut à `compiled` |
| `brain ask "<q>" [--file]` | 2 | même mécanisme avec le workflow query, **en lecture seule**. `--file` autorise à écrire une synthèse en `draft` |
| `brain config init\|lint\|get\|set\|remove` | 2 | squelette de `config.json` (clés `client`, `model`, `effort` à `null`), contrôle, lecture et écriture validée des propriétés. L'effort est traduit pour chaque client : `effort` (Claude), `modelReasoningEffort` (Codex), variante du modèle (opencode, `modèle#variante` en CLI) |
| `brain log [--limit N] [--json] [--kind k]`, `brain log add <kind> "<texte>" [--source <id>]… [--page <chemin>]…` | — | le journal. `wiki/log.jsonl` est la source de vérité (append-only, une ligne `{"at", "kind": add\|ingest\|query\|lint\|update, "text", "sources"?, "pages"?}`) ; `wiki/log.md` en est généré (même rendu que l'ancien journal, plus une ligne « généré, ne pas éditer »), comme `index.md`. `brain log add` valide le `kind`, les chemins de pages (existants, sous `wiki/`, hors `index.md` et `log.md`) et les ids raw (existants), écrit la ligne d'un seul `append`, puis régénère `log.md` ; `brain add` écrit lui-même l'entrée `add`. `brain log` lit (20 dernières entrées par défaut). Les agents n'écrivent jamais le journal à la main : `brain log add` est autorisé là où `brain index` l'est (garde Claude, règles opencode, `--allowedTools` du moteur par défaut ; Codex écrit sous `wiki/`, donc l'a d'office), et `brain log` en lecture seule (garde Claude, opencode). `brain lint` : erreur sur une ligne invalide, avertissement si `log.md` diffère de sa génération |
| `brain mcp` | 3 | serveur MCP stdio, qui ne modifie jamais `wiki/`. Lecture : `search`, `get` (un `.md` sous `wiki/` ou `raw/`, chemins résolus par `realpath`), `related` (liens sortants et entrants 3, source raw partagée 2, tag partagé 1), `lint`, `log` (entrées structurées des N derniers jours, 1 par défaut, filtre `kind` facultatif). Écriture : `add` seul, dans `raw/` (URL ou `text`, jamais un fichier local du poste, `note` obligatoire, idempotent). Racine par `$BRAIN_ROOT`. |
| `brain inbox [--dry-run]` | 4 | `add` sur tout le contenu de `inbox/`. `urls.txt` : une entrée par ligne, `<url> [note libre…]` (le reste de la ligne est la `note`), lignes vides et `#` ignorées et conservées. Tout autre fichier visible (PDF, `.md`, `.txt`) passe par `add`, avec pour note le contenu de `<nom>.note` s'il existe. **Une entrée réussie (ajoutée ou déjà présente) quitte l'inbox** (ligne retirée, fichier et `.note` supprimés) ; un échec y reste, et le code de sortie est 1. `urls.txt` est réécrit par fichier temporaire puis `rename`, après relecture. `--dry-run` n'écrit rien et ne vide rien. Sans `note`, l'avertissement de `brain add` s'affiche et `compile` refusera la source tant qu'elle manque |
| `brain export [--out <dossier>]` | 6 (fait) | le wiki en site HTML interactif (voir §10 bis) : navigation, recherche instantanée, graphe des liens. Sortie par défaut `.brain/site`, **vidée à chaque export** (refus si c'est la racine, `wiki/`, `raw/`, le dossier du CLI, le HOME ou l'un de leurs parents, ou si le dossier existe, n'est pas vide et ne contient pas de `_app/` : il ne ressemble pas à un export précédent). SvelteKit `adapter-static` + shadcn-svelte, embarqués dans le CLI (`cli/site/`), rien à installer en plus |
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
| `@modelcontextprotocol/server` | `^2.4` | `brain mcp` (`serveStdio`) | SDK officiel v2, qui ne dépend que de `zod` et `core` (la v1 `@modelcontextprotocol/sdk` tirait express, hono, cors, ajv…). Vérifié à l'étape 3 (v2.4.0, Context7) : `McpServer` depuis `@modelcontextprotocol/server`, `serveStdio` depuis le sous-chemin `@modelcontextprotocol/server/stdio` (et non la racine), `registerTool(nom, { description, inputSchema: z.object({…}) }, handler)`. |
| `zod` | `^4` | schémas d'entrée des outils MCP (`import * as z from "zod/v4"`) | Requis par le SDK MCP |

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

Ces SDK ne sont que des surcouches qui pilotent la CLI de l'agent. Ils tirent en dépendances optionnelles un binaire par plateforme : ~630 Mo pour Claude (glibc + musl), ~440 Mo pour Codex. Le CLI les en dispense : il installe avec `bun install --omit optional` et pointe les SDK vers les CLI déjà installées (`pathToClaudeCodeExecutable`, `codexPathOverride`). Bilan : `node_modules` pèse ~97 Mo (~220 Mo depuis l'export HTML) au lieu de ~1,2 Go. En contrepartie, la CLI installée (`claude`, `codex`) doit rester dans une version compatible avec le SDK.

opencode n'a pas de SDK : le seul publié, `@opencode-ai/sdk` 1.19.5, ne parle pas l'API d'opencode v2 (routes `/api/…`, authentification Basic, nouveau format de permissions). `opencode.ts` appelle directement l'API REST d'`opencode serve`. Modèle par défaut : `opencode/big-pickle`.

*À revoir à l'étape 5 (l'export HTML a déjà dû sortir ses liaisons natives d'`optionalDependencies`, voir plus bas) :* `--omit optional` écartera aussi `@huggingface/transformers` et `tesseract.js`. Il faudra alors les passer en dépendances normales chargées à la demande, ou les installer explicitement.

**Points d'attention :**
- `onnxruntime-node` est un addon natif, il n'entre donc pas dans un binaire `bun build --compile`. La transcription n'est disponible que dans un `brain` installé via `bun install`.
- L'OCR local n'est qu'un secours : la vision de l'agent fait mieux (description + texte).
- **Modèle Whisper retenu : `onnx-community/whisper-small` (q8, 241 Mo), avec `language: "french"`.**
  - Test sur 60 s de lecture LibriVox en français : texte complet, ponctuation correcte, quelques noms propres écorchés.
  - Vitesse : 20 s par minute d'audio, soit ~3× le temps réel (un podcast d'1 h ≈ 20 min).
  - `whisper-base` (9 s/min) **saute un passage entier** et déforme beaucoup de mots.
  - `whisper-large-v3-turbo` (1,1 Go, 32 s/min) **perd aussi un passage** et toute la ponctuation en q8 : il ne vaut pas son coût.

**Runtime — export HTML (`brain export`), dépendances normales chargées à la demande (`await import("vite")`) (10)**

Ajoutées à l'étape 6, documentation vérifiée via Context7 et dates de dernière publication relevées sur le registre npm le 2026-11-04. Règle retenue : uniquement des bibliothèques entretenues (version publiée dans les ~3 derniers mois).

| Package | Version | Publiée | Rôle | Pourquoi celui-là |
|---|---|---|---|---|
| `vite` | `8.3.5` (exacte, voir plus bas) | 2026-10-21 | construit le site par son API (`createBuilder().buildApp()`) | requis par SvelteKit 3 |
| `@sveltejs/kit` | `^3.1.1` | 2026-10-29 | routage, prérendu, pages HTML statiques | prérendu natif (voir §10 bis) |
| `@sveltejs/adapter-static` | `^4.0.1` | 2026-10-29 | écrit le site prérendu dans `--out` | adapter officiel du site statique |
| `svelte` | `^5.57.3` | 2026-10-26 | composants (runes) | requis par SvelteKit et shadcn-svelte |
| `tailwindcss` + `@tailwindcss/vite` | `4.3.4` (exactes) | 2026-11-02 | styles | requis par shadcn-svelte |
| `tailwind-variants` + `tailwind-merge` | `^4.0.1` / `^3.7.0` | 2026-10-31 / 2026-09-12 | variantes et fusion des classes des composants shadcn-svelte copiés | `cn` de shadcn-svelte, sans `clsx` (inutile : `twMerge` accepte déjà tableaux et valeurs fausses) |
| `force-graph` | `^1.52.0` | 2026-09-28 | graphe (canvas, d3-force), chargé seulement dans le navigateur | voir §10 bis |
| `fuse.js` | `^7.5.0` | 2026-07-13 | recherche plein texte côté navigateur : floue, classée, avec surlignage ; index précalculé à l'export (`Fuse.createIndex` → JSON, `Fuse.parseIndex` dans le navigateur) | zéro dépendance, ~450 Ko installés, ~25 Ko dans le navigateur. Écartés car figés depuis plus de 3 mois : `minisearch` (2025-09), `@orama/orama` (2025-12), `flexsearch` (2025-09). Écarté : Pagefind (binaire Rust par plateforme en `optionalDependencies`, sans autocomplétion) |

**Liaisons natives de Vite 8 et de Tailwind 4, à épingler (6).** Vite 8 (rolldown), `@tailwindcss/oxide` et `lightningcss` livrent leur binaire en `optionalDependencies` par plateforme, que `bun install --omit optional` écarte : `import("vite")` échoue alors (« Cannot find native binding »). Elles sont donc déclarées en **dépendances normales**, aux versions exactes de leur parent : `@rolldown/binding-*` `1.2.16` (publiée le 2026-10-29), `@tailwindcss/oxide-*` `4.3.4` (2026-11-02), `lightningcss-*` `1.33.0` (2026-07-20 : un peu plus de 3 mois, hors de la règle, mais c'est la dernière version publiée et celle que Tailwind exige), pour `linux-x64-gnu` et `darwin-arm64`. Bun ignore sans erreur celle qui ne correspond pas à la plateforme. **À maintenir en même temps que `vite` et `tailwindcss`** (versions exactes, sans `^`). Autres plateformes (Linux arm64, macOS Intel, musl, Windows) : ajouter la liaison correspondante, sinon `brain export` s'arrête avec un message qui nomme la plateforme.

**Rendu Markdown : aucune dépendance** (`Bun.markdown.html`, GFM intégré à Bun ; `marked` écarté). Les notes de bas de page `[^id]` n'y sont pas gérées : `export.ts` les extrait et les numérote lui-même (une quarantaine de lignes).

**Composants shadcn-svelte** copiés dans `cli/site/` (`button`, `badge`, `input`, `card`), versionnés ; le preset `nova` ajoute `tw-animate-css`, `@fontsource-variable/geist`, `shadcn-svelte/tailwind.css`, `bits-ui` et `@lucide/svelte`, non utilisés ici et donc non installés (animations, police et icônes inutiles ; `tw-animate-css` date de 2025-09).

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
- **Étape 3.** `mcp` (fait).
- **Étape 4.** `inbox` (fait), avec un raccourci mobile « Partager → `inbox/urls.txt` » : l'action « Partager » du téléphone ajoute `<url>` en fin de `inbox/urls.txt`, dans le dossier synchronisé. Le contenu de `inbox/` n'est pas versionné (`.gitignore`) : la synchro se fait hors git, avec Syncthing ou un équivalent, au choix de l'humain ; le CLI ne lit que le dossier. Un `brain inbox` ultérieur ingère puis vide.
- **Étape 5.** Images, puis vidéo et audio.
- **Étape 6 (fait).** `export` : le wiki en site HTML interactif, avec un graphe des liens façon Obsidian (voir §10 bis).
- **Étape 7, seulement si nécessaire.** Embeddings, `reextract`.

## 10 bis. Export HTML

**But :** parcourir le wiki depuis un navigateur, sans Obsidian ni agent.

**`brain export` produit un site HTML dynamique et interactif** : tout tourne dans le navigateur (JavaScript), sans serveur applicatif, donc n'importe quel serveur de fichiers suffit. C'est une étape déterministe, sans LLM, comme `index` et `lint`.
- **Une page HTML par page wiki.** Le Markdown est rendu ; les liens `/wiki/…` deviennent des liens relatifs vers les pages HTML ; les notes de bas de page renvoient aux sources.
- **L'index, les tags et le log** deviennent des pages de navigation, générés depuis les frontmatters, comme `wiki/index.md`.
- **Bouton « Copier le Markdown »** sur chaque page : le source de la page, frontmatter compris. `raw/` n'étant pas publié, chaque chemin `/raw/…` y devient l'URL d'origine de la source, ou disparaît si elle n'en a pas.
- **Chaque page affiche ses métadonnées OKF** : type, statut (`draft`, `stable`, `deprecated`), relue ou non, sources, et ses liens entrants (rétroliens).
- **Une page de graphe interactive**, à la manière de la vue graphe d'Obsidian. Les nœuds sont les pages, colorés par type ; les arêtes, les liens Markdown. On zoome, on déplace, on filtre par type ou tag, on ouvre une page en cliquant son nœud. Les données du graphe sont un JSON produit à l'export.
- **Une recherche plein texte côté navigateur**, sur un index JSON produit à l'export.
- **`raw/` n'est pas publié.** Les sources pointent vers leur URL d'origine. Le site ne contient que le wiki, que l'humain a relu ou peut relire.
- **Le site fonctionne hors ligne.** Tout est empaqueté par Vite, sans CDN, et un service worker met le site entier en cache après la première visite (voir « Hors ligne » plus bas).

**Stack : SvelteKit (`adapter-static`, sur Vite) et shadcn-svelte.**
- **Pourquoi SvelteKit plutôt que React + Vite :** le prérendu est natif. Chaque page devient un fichier HTML à la construction, puis s'hydrate pour la navigation côté client, le graphe et la recherche. React + Vite demanderait un outil de SSG en plus (`vite-react-ssg` ou équivalent). Les bundles Svelte sont aussi plus légers.
- **shadcn-svelte** est le port communautaire de shadcn/ui pour Svelte (Bits UI + Tailwind CSS). Comme shadcn, il copie les composants dans le projet au lieu de les importer d'un package. Installation : `bun x sv create --add tailwindcss`, puis `bun x shadcn-svelte@latest init`. On n'ajoute que les composants utilisés.
- **Vite et SvelteKit sont embarqués dans le CLI**, l'utilisateur n'a rien à installer pour l'export. Vite, SvelteKit, Svelte, Tailwind et `force-graph` sont des dépendances normales de `cli/package.json`, installées par le même `bun install --cwd cli`. Elles ne vont **pas** en `optionalDependencies`, que l'installation recommandée (`--omit optional`) écarterait.
- **L'application vit dans `cli/site/`.** Les composants shadcn-svelte y sont copiés une fois, au développement : l'utilisateur ne lance jamais `shadcn-svelte`.
- **`brain export`** écrit les données (pages rendues, métadonnées OKF, `graph.json`, index de recherche), puis appelle Vite par son API (`createBuilder(…).buildApp()`, sans la commande `vite` ; voir les écarts plus bas) sur `cli/site/`, qui prérend toutes les pages vers `--out`. Le CLI reste le seul à lire le wiki ; le site ne fait qu'afficher ces données.
- **Chargé à la demande** (`await import()`) : `add`, `search`, `compile`… ne chargent jamais Vite et restent aussi rapides.
- **Graphe : `force-graph`** (vasturiano), dans un composant Svelte. Rendu Canvas 2D et physique d3-force : animé dès l'installation (placement des nœuds, glisser, zoom, voisins mis en valeur au survol, particules sur les liens), au plus près de la vue graphe d'Obsidian pour le moins de code. L'interface autour (filtres par type et tag, recherche, aperçu de page) est en shadcn-svelte. *Limite :* ralentit au-delà de quelques milliers de nœuds ; si le wiki y arrive, passer à sigma.js + graphology (WebGL). Écarté : 3d-force-graph (Three.js, plus lourd, moins lisible pour naviguer).
- **Coût :** quelques dizaines de Mo de plus dans `node_modules` (à mesurer à l'étape 6) et quelques secondes de construction par export.

**Réalisé à l'étape 6 : mesures et écarts à la spec.**

- **Mesures (47 pages, 81 arêtes, Linux x64, Bun 1.4.3).** Export complet en **~2,2 s**. Site de 3,2 Mo (le JS du graphe ne se charge que sur `/graph/`). Index de recherche 172 Ko (~62 Ko compressé), recherche en 4 à 15 ms. `node_modules` : **106 Mo → 222 Mo (+116 Mo)**, soit plus que les « quelques dizaines de Mo » prévus : liaisons natives de Vite (`@rolldown`, 21 Mo) et de lightningcss (10 Mo), `force-graph` et ses d3 (6,5 Mo), Svelte et SvelteKit (7,4 Mo). Les autres commandes ne chargent rien de tout cela (`brain search` : 0,13 s).
- **Données.** `brain export` lit `wiki/` (jamais `raw/`, sauf le champ `url` du frontmatter de chaque source citée) et écrit `.brain/site-data/` (`data.json`, `graph.json`, `search-index.json`) ; le site les lit à la construction (`BRAIN_SITE_DATA`), et `graph.json` ainsi que l'index sont republiés comme points d'accès prérendus. Rien n'est écrit dans `cli/site/` hors de `.svelte-kit/` (ignoré). Pour développer le site : `BRAIN_SITE_DATA=<racine>/.brain/site-data bunx --bun vite dev` depuis `cli/site/`.
- **Écart : `createBuilder().buildApp()` au lieu de `build()`.** `build()` ne construit qu'un environnement Vite : SvelteKit 3 orchestre client, serveur, prérendu et adapter dans son hook `buildApp`, que seul `createBuilder` appelle. `build()` se terminait « avec succès » sans rien écrire.
- **Écart : SvelteKit 3 et Vite 8** (versions courantes, plus récentes que celles de la doc consultée en amont). La configuration passe par `sveltekit({…})` dans `cli/site/vite.config.ts` (plus de `svelte.config.js`) ; `$lib` est supprimé, remplacé par `#lib` via le champ `imports` de `cli/site/package.json` (les composants shadcn-svelte copiés ont été adaptés) ; `tsconfig.json` étend `$app/tsconfig`. Le CLI ne vérifie pas les types du site (pas de `svelte-check`, une dépendance de plus) : les erreurs de compilation Svelte et le prérendu (`handleHttpError: "fail"`) font échouer l'export.
- **Recherche : index inversé construit à l'export, Fuse.js pour les seules fautes de frappe.** L'export produit, sur **tout le texte** de chaque page, un index mot replié (sans accents ni casse) → pages. Dans le navigateur, chaque mot saisi se résout en mots de l'index : exact, préfixe (frappe en cours, recherche dichotomique dans la liste triée) ou proche (Fuse sur la liste des mots, jamais sur le contenu). Les mots se combinent en ET, les phrases exactes resserrent d'abord les candidats par l'index puis sont vérifiées sur le texte. Classement : titre 3 > description 1,5 > tags 1 > contenu 0,4, pondéré par la qualité (exact > préfixe > proche). Le coût d'une recherche dépend des mots tapés, pas de la taille du wiki. Mesuré le 2026-11-04 (pire requête) : ~13 ms pour les 47 pages, ~12 ms pour ~940, ~11 ms pour ~2 800 (contre 19, ~290 et ~900 ms quand Fuse parcourait le contenu) ; index de recherche 146 Ko pour le wiki actuel. Moteur dans `cli/site/src/lib/search-engine.ts`, sans dépendance à SvelteKit, testé par `bun test` (y compris un plafond de 200 ms sur ~3 000 pages, ~10 ms en pratique).
- **Une seule barre de recherche, façon palette de commandes** (champ de l'en-tête ; ⌘K / Ctrl+K ou « / » pour y aller ; liste déroulante `combobox` ARIA, ↑ ↓ Entrée Échap) plus une page `/search/?q=…`. Les opérateurs se combinent en ET : `#tag` ou `tag:x`, `type:concept|entity|synthesis|source` (les pluriels et formes françaises passent), `status:draft|stable|deprecated`, `is:fav`, `is:unverified` (jamais relue), `"phrase exacte"`, exclusions `-mot`, `-#tag`, `-type:source`. Les filtres se résolvent sur les métadonnées (nombre de pages affiché pendant la frappe : `#` ou `type:` proposent les valeurs existantes), le texte libre par Fuse. Les filtres actifs s'affichent en puces retirables. Le parseur est une fonction pure (`cli/site/src/lib/query.ts`, testée). Autocomplétion : valeurs de filtres, termes du vocabulaire (préfixe du dernier mot), titres par préfixe. Les titres proposés passent par les mêmes conditions que les résultats (filtres, phrases, exclusions ; sans mot libre, aucun titre). Un filtre répété donne une seule puce. Chaque page proposée porte un court extrait et ses états (favori, brouillon, à relire) ; le titre sélectionné peut tenir sur deux lignes et l'option active est toujours amenée dans la zone visible. Un pied collant « Tous les résultats pour … » donne le total exact ; une liste vide explique pourquoi (« Aucun favori », « Aucun résultat », chargement, échec du chargement de l'index avec « Réessayer ») et propose de réinitialiser. Sur `/search/`, l'URL fait foi (envoi depuis l'en-tête, précédent et suivant) et la liste s'étend par tranches de 50 (« Afficher davantage »).
- **Actions sur le résultat sélectionné** : `Entrée` ouvre, `⌘/Ctrl+Entrée` ouvre dans un nouvel onglet, `Alt+F` met en favori ou retire, `Alt+C` copie le lien (les raccourcis s'affichent sous la ligne sélectionnée). Commandes globales (champ vide, ou texte qui correspond) : aller au graphe, au journal, aux favoris, aux tags, à l'accueil ; changer de thème (système, sombre, clair, mémorisé dans `localStorage`). **Pas d'action « éditer la fiche »** : le site est généré et en lecture seule, donc ni URL d'édition ni lecture du remote `origin`, ni clé `editUrl`. Cela évite `shadcn` `command` et `dialog` (donc `bits-ui`, `tw-animate-css` et les icônes) : les composants copiés se réduisent à `button`, `badge`, `input`, `card`. `cn` de shadcn-svelte est réécrit sans `clsx`, et la police du preset (Geist) est remplacée par la pile système : aucun fichier de police à embarquer.
- **Favoris.** Bouton étoile sur chaque page et dans la palette, section « Favoris » en tête de l'accueil, filtre `is:fav`, anneau doré sur les nœuds du graphe. Stockés dans le `localStorage` du navigateur (lecture et écriture dans un `try/catch`) : **le site étant statique, les favoris sont propres à chaque navigateur** (ni partagés, ni versionnés).
- **Pages longues : sommaire et notes.** Chaque titre reçoit à l'export une ancre lisible et stable (texte du titre sans accents, suffixe `-1`, `-2` en cas de doublon ; le slug de Bun, qui supprime les accents, est remplacé ; un slug qui ressemblerait à un id de l'interface est préfixé `t-`). `PageData.toc` liste les h2/h3. Au-delà de 3 titres, la page affiche un sommaire : dans la colonne latérale (collante) sur grand écran, repliable (`<details>`) au-dessus du texte sur mobile ; la section courante (dernier titre passé sous l'en-tête) est signalée par `aria-current="location"`. Le retour `↩` d'une note de bas de page mène à l'appel réellement suivi (mémorisé au clic, par page et par note), sinon au premier ; une note citée plusieurs fois a en plus un retour par occurrence (↩ a b c, `Note.refs`). Corps limité à 72 caractères par ligne ; tableaux et blocs de code défilent horizontalement.
- **Navigation et thème.** L'en-tête porte « Favoris » (la recherche `is:fav`) et un sélecteur Système / Clair / Sombre (`theme.set`, même mémorisation `localStorage` et même attribut `data-theme` que la commande de la palette). La rubrique active reçoit `aria-current="page"` (lu depuis `page.route.id`, valable au prérendu). L'accueil propose des raccourcis (ancres) vers les sections par type ; `/tags/` a un champ de filtre (insensible à la casse et aux accents).
- **Zones tactiles.** Sur `@media (pointer: coarse)`, la classe `.touch-target` (boutons, tags, raccourcis) étend la zone cliquable à ~44 px par un pseudo-élément transparent ; l'aspect compact de la souris est inchangé. Les champs et le sélecteur de thème passent à 44 px de haut.
- **Journal.** Le journal est `wiki/log.jsonl` ; `renderLog` (`cli/src/export.ts`) en tire des entrées structurées (`at`, `kind`, texte rendu en HTML en ligne, pages citées, sources) dans `data.json`, la recherche ne l'indexe pas. La page `/log/` (`cli/site/src/routes/log/`) est une frise par jour (le plus récent en haut) : chaque entrée porte un badge coloré par `kind` (variables `--kind-*`, clair et sombre), l'heure si elle est connue, le texte, puis les liens vers les pages wiki citées et vers les sources. `raw/` n'étant pas publié, une source renvoie à la page Source du wiki qui la cite, sinon son id reste en texte ; un id cité dans le texte devient lui aussi ce lien. Filtres par `kind` en puces avec compteurs (`aria-pressed`, annonce du total), sans JavaScript tout est affiché. Entrées migrées de l'ancien `log.md` : date sans heure.
- **Reproductible.** Même wiki, même site, octet pour octet (testé en exportant deux fois) : la version SvelteKit est l'empreinte des données (`BRAIN_SITE_VERSION`), `.svelte-kit/` est vidé avant chaque construction, et le HTML prérendu n'a aucun identifiant aléatoire.
- **Écart : liaisons natives en dépendances normales** (voir §9), pour que `--omit optional` n'empêche pas Vite de démarrer.
- **Hors ligne.** `cli/site/src/service-worker.ts` (service worker natif de SvelteKit 3, aucune dépendance ; `$service-worker` n'existe plus, on lit `$app/manifest` et `$app/env`) précache à l'installation tout le site prérendu : pages, `__data.json`, `graph.json`, `search-index.json` et les ressources `_app/` (233 fichiers pour le wiki actuel). Le cache s'appelle `brain-<version>` et la version est l'empreinte des données (`BRAIN_SITE_VERSION`), pas l'horloge : le service worker reste reproductible octet pour octet. Les anciens caches sont supprimés à l'activation, et `clients.claim()` fait profiter la page qui l'installe sans rechargement. Stratégie : cache d'abord pour les fichiers immuables (`_app/immutable/`, nommés par empreinte), réseau d'abord pour tout le reste (les mises à jour se voient en ligne), cache en secours (`ignoreSearch` : `/search/?q=…` retombe sur `/search/`). Les chemins du manifeste sont résolus contre la portée du service worker, donc le site marche sous un sous-chemin. L'indicateur (`offline-status.svelte`, `aria-live="polite"`, en bas à gauche) affiche « Disponible hors ligne » 6 s, une fois par version du site, quand le service worker est actif (donc son cache complet), et « Hors ligne » tant que le navigateur l'est. *Mesuré (47 pages) :* 3,0 Mo en cache (0,85 Mo compressé sur le réseau), dont 1,9 Mo pour `wiki/` (HTML et `__data.json`, environ 40 Ko par page). Testé dans Chrome : serveur arrêté après l'installation, accueil, page jamais visitée, graphe et recherche fonctionnent, à la racine comme sous `/brain/sous/`. *Limites :* (1) `file://` n'est pas visé : un service worker exige http(s) ou localhost. (2) Le cache grossit avec le wiki (~40 Ko par page : environ 40 Mo pour 1 000 pages, 120 Mo pour 3 000) ; les navigateurs plafonnent le stockage par origine (souvent plusieurs centaines de Mo) et peuvent vider un cache trop plein. Au-delà, parade : ne précacher que l'essentiel (`_app/`, accueil, `graph.json`, `search-index.json`) et laisser les pages en cache à la volée, ou retirer les `__data.json` du précache (les pages se rechargent alors en HTML complet). (3) Une mise à jour du site s'installe en arrière-plan et ne prend le relais qu'une fois les onglets fermés.
- **Liens et pages.** `wiki/concepts/x.md` devient `wiki/concepts/x/index.html` (`trailingSlash: "always"`, `paths.relative: true`) : le site marche derrière tout serveur de fichiers, sous-chemin compris (exploration HTTP sur deux préfixes : 124 URLs, 635 ancres, 0 lien mort). Les liens du corps sont réécrits en relatifs ; un lien vers une page qui n'existe pas encore (permis par BRAIN.md) devient un `<span class="lien-manquant">`, jamais un 404 ; un lien vers `raw/` n'est pas publié. Les arêtes du graphe sont dédoublonnées par paire de pages.
- **Graphe.** Nœuds colorés par type avec légende (les pastilles filtrent aussi), filtres par type et par tag, glisser, zoom, gravité vers le centre, survol ou sélection qui estompe le reste, particules sur les liens mis en valeur. Ajouts de la revue UI/UX :
  - **Repères dès l'ouverture.** Les libellés sont dessinés après tous les nœuds, par ordre de degré décroissant, sans jamais se chevaucher (grille spatiale, `placeLabels` dans `cli/site/src/lib/graph-labels.ts`, testé). Le nombre de libellés suit la surface visible et croît avec le zoom (surface ÷ 14 000 px², × zoom, plafond 150) : sur un écran de 390 px, une douzaine au cadrage initial ; en zoomant, davantage. Rayon des nœuds borné à l'écran (2,5 à 14 px quel que soit le zoom ; le degré reste lisible au dézoom), épaisseur des liens à peu près constante. Cadrage initial à marge adaptée à la largeur (7 %, entre 20 et 70 px). Le nœud survolé ou sélectionné affiche son titre complet (les autres : 28 caractères) ; en survol ou sélection, seul le voisinage est étiqueté.
  - **Sélection.** Un clic ou un toucher sélectionne la page : voisinage mis en valeur (anneau + liens + particules), panneau (type, titre, description, pages liées cliquables, « Ouvrir la page »), posé en bas sur écran étroit (le nœud qu'il recouvrirait est remonté) et à droite sur grand écran. Double-clic (400 ms) ouvre la page ; clic dans le vide ou `Échap` désélectionne ; le survol d'un autre nœud prend le pas tant que le pointeur y reste. La zone de toucher d'un nœud est élargie (+12 px, +6 px à la souris). `graph.json` porte désormais la `description` de chaque page.
  - **Commandes.** Pause / Reprendre (fige la simulation et les particules ; les nœuds restent déplaçables), zoom + / − (×1,5, bornes 0,05 à 12), Recentrer. Un cadrage tardif de fin de simulation ne reprend plus la main dès que l'utilisateur a touché le graphe.
  - **Sobriété et mouvement réduit.** Le canvas ne se redessine plus au repos (`autoPauseRedraw` : simulation arrêtée, aucune particule) ; mesuré : 0,1 ms par image au repos contre ~10 ms pour une image redessinée avec 2 000 nœuds. `prefers-reduced-motion` : ni particules, ni cadrage ou zoom animés, simulation calculée d'un coup (300 pas) puis figée, bouton Pause masqué.
  - **Équivalent clavier.** La liste des pages (rendue seulement quand on l'ouvre) donne pour chaque page ses pages liées, en liens.
  - **Échelle (graphe synthétique de 2 000 nœuds et ~3 000 arêtes, Chrome, Linux).** Ouverture : un blocage d'environ 1 s du fil principal (chargement du code et 80 pas de simulation d'amorçage), puis fluide ; image à ~10 ms au pire (nœuds, liens et libellés), libellés sans chevauchement (choix des libellés < 20 ms, testé), au repos plus aucun redessin. Limites : avec `prefers-reduced-motion`, les 300 pas d'amorçage bloquent ~3 s à cette taille ; à 2 000 nœuds le cadrage initial est un nuage dense où seuls ~40 libellés (les plus liés) apparaissent, la lisibilité vient du zoom et de la sélection ; au-delà de quelques milliers, passer à sigma.js (WebGL, voir plus haut). Non vérifié : le tactile réel, `prefers-reduced-motion` dans un navigateur, un lecteur d'écran.

**Hors périmètre : le déploiement.** Où et comment servir le site (par exemple sur un homelab) relève de l'usage, pas du CLI. L'export est reproductible (même commit, même site), ce qui suffit à l'automatiser ailleurs.

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
