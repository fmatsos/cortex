---
type: Design Doc
title: "PIPELINE — compile déterministe pour petits modèles"
description: "Mode `cortex compile --pipeline` : cortex orchestre un workflow fixe, le modèle ne fait que l'inférence, en appels courts à sortie JSON contrainte."
---
# PIPELINE — compile déterministe pour petits modèles

> Statut : proposition (2026-11-06). Complète `DESIGN.md` §3 (client `openai`) et le workflow INGEST de `src/schema.md`.

## 1. Vue d'ensemble

### 1.1 Problème

Avec un modèle local de 4B (qwen3.5-4b, llama.cpp, 64k de contexte, ~33 tok/s en génération, 250–1 200 tok/s en prefill), la boucle agentique de `backends/openai.ts` ne tient pas : 10 à 20 tours par source, un contexte qui dépasse 50k (les pages écrites par le modèle restent dans l'historique, `elide` n'intervient qu'à 80 %), ~48 s par tour, et le modèle erre (commandes shell refusées, pages réécrites plusieurs fois, doublons). Sur le labo : 12 sources en 56–410 s chacune, une source longue en plus de 35 min.

### 1.2 Principe

**Cortex conduit, le modèle infère.** Le mode pipeline remplace la conversation à outils par une suite d'étapes fixes. Chaque appel au modèle est **indépendant** (pas d'historique), **court** (2k à 8k tokens d'entrée), **contraint** (sortie JSON validée par grammaire côté serveur, puis par zod côté cortex) et **vérifié** (un fait sans citation retrouvable dans la source est rejeté). Le modèle ne connaît ni les chemins, ni le frontmatter, ni la CLI : il reçoit du texte et des listes numérotées, il rend du texte et des indices. Tout ce qui est mécanique (squelette des pages, citations, tags, liens, index, journal, lint) reste à cortex, en réutilisant ce que `agent.ts` fait déjà en batch (`prepareSource`, `stamp`, `weave`, `markCompiled`, `suggestLinks` ciblé, journal).

**Hypothèse de conception : la pile locale suffit.** Tout est conçu pour qwen3.5-4b (rédaction), d3-mini (jugement), qwen3-embed (proximité) et cortex (tout le reste). Le mode agentique (`claude`, `codex`, `opencode`, boucle `openai`) reste dans le code pour qui veut s'en servir, mais aucun point de ce design n'en dépend : ce que le pipeline ne fait pas pendant l'ingestion, `cortex maintain` (§8) le fait plus tard avec la même pile, et ce que le juge ne tranche pas va dans une file visible pour l'humain (§4.8). Le pipeline vise le client `openai` : opt-in d'abord (`cortex compile --pipeline`, batch implicite), par défaut pour `openai` une fois validé (§6.3).

### 1.3 Étapes

| # | Étape | Qui | Entrées | Sorties | Contexte |
|---|---|---|---|---|---|
| 0 | Préparation | cortex | source brute, wiki | page Source squelette (`prepareSource`), tags en usage (50 max), découpage en chunks (§3) | — |
| 1 | Extraction (par chunk) | 4B | consignes + chunk + liste des tags + candidats (`routeCandidates`) | résumé, points clés, description, tags, sujets (Concept/Entity) avec faits et citations | 3k–8k |
| 2 | Réduction | cortex, puis 4B si > 1 chunk | extractions des chunks | une extraction fusionnée (sujets fusionnés par cortex ; résumé/points clés global par le 4B) | 2k–3k |
| 3 | Vérification des citations | cortex | faits, texte de la source | faits retenus (citation retrouvée) ou rejetés | — |
| 4 | Routage et dédoublonnage | embeddings + d3-mini | chaque sujet (titre + description) ; candidats élargis (§4.7) | « mise à jour de la page X » ou « nouvelle page » | 4k (d3-mini) |
| 4bis | Connexions | 4B | résumé + points clés + faits numérotés + 20–30 pages proches (une ligne chacune) | pages que la source touche, relation, faits concernés (§2.9) | 3k–4k |
| 5 | Rédaction d'une nouvelle page | 4B (parallèle) | consignes + sujet + faits + placeholders de liens | corps Markdown avec `[^id]` et `[[p:N]]` | 1.5k–3k |
| 6 | Ajout à une page existante | 4B (parallèle) | consignes + corps de la page + faits (du sujet, ou de la connexion) | section cible + ajout + contradiction éventuelle | 2k–5k |
| 7 | Application | cortex | résultats 1–6 | pages écrites : Source (rendu depuis 2), nouvelles (`newPageCtx`), fusions (§4.4), `stamp`, `weave`, liens | — |
| 7bis | Synthèses à écrire | cortex | graphe de liens avant / après | entrée dans la file `wiki/queue.jsonl` quand la source relie deux groupes jusque-là sans lien (§4.8) | — |
| 8 | Lint et réparation | cortex, puis 4B par page fautive | erreurs lint de la page | corrections mécaniques ; sinon un corps corrigé | 2k–4k |
| 9 | Clôture | cortex | — | `markCompiled`, `cortex links` ciblé, index, journal, état supprimé | — |

Les étapes 4 (candidats élargis), 4bis et 7bis compensent, pendant l'ingestion, une partie de ce que l'agent faisait en lisant le wiki (§6.2). La maintenance différée (fusion, contradictions) est une commande séparée, `cortex maintain` (§8, v2).

### 1.4 Comparaison avec la boucle agentique

Source courte : ~1 500 mots (~2,5k tokens). Source longue : ~12 000 mots (~18k tokens). Estimations pipeline au débit mesuré (prefill ~600 tok/s, génération 33 tok/s). Le WP0 confirme le prefill (~580 tok/s) mais n'a mesuré que ~22 tok/s en génération, avec un run du labo actif en parallèle : voir « Résultats du WP0 ».

| | Agent (mesuré) | Pipeline (estimé) |
|---|---|---|
| Tours / appels par source | 10–20 tours | courte : 5–9 appels ; longue : 11–17 (dont 1 pour les connexions) |
| Contexte par appel | 20k → 50k+ | 2k–8k |
| Tokens lus (prefill cumulé) | 300k–1M | courte ~12k ; longue ~50k |
| Tokens générés | 10–30k (pages réécrites) | courte ~3k ; longue ~8k |
| Latence source courte | 56–410 s | ~2 min en séquentiel, ~1 min avec 4 slots |
| Latence source longue | > 35 min | ~3–5 min |
| Variance | forte (dépend des errances) | faible (nombre d'appels connu d'avance) |
| Modes d'échec | shell refusé, réécritures, doublons, contexte plein, sortie coupée | JSON invalide (retry), fait sans citation (rejeté), sujet sans fait (ignoré), page vide (réparation) |
| Reprise après crash | aucune (tout est rejoué) | par étape (fichier d'état, §4.6) |

Ce qui est perdu : le modèle ne lit plus le wiki à sa guise (il voit les candidats que cortex lui donne), ne décide plus de la structure globale, ne déprécie pas une page. Voir §6.2.

## 2. Les appels au modèle

### 2.1 Mécanique commune (`src/llm.ts`)

Un seul helper, `structured(cfg, { name, system, user, schema, zod, maxTokens })`, utilisé par toutes les étapes :

- `POST <base_url>/chat/completions`, mêmes règles que `openai.ts` : `endpoint()` de `config.ts` pour l'URL et la clé (jamais envoyée à une URL que seul `cortex.json` nomme), `thinking()` et `cache()` réexportés.
- `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. **Vérifié dans les sources de llama.cpp** (`tools/server`) : pour `type: "json_schema"`, le serveur lit `response_format.json_schema.schema`, le convertit en grammaire GBNF (`json_schema_to_grammar`) et contraint la génération ; `name` et `strict` sont ignorés par llama.cpp, exigés par OpenAI. Le README montre aussi `{type:"json_schema", schema:{…}}`, mais le parseur lit la forme imbriquée ; on envoie la forme OpenAI, qui marche sur les deux. Le champ bas niveau `json_schema` (alias `grammar`) du `/completion` natif n'est pas utilisé.
- `temperature: 0`, `seed: 7`, `max_tokens` par étape, `cache_prompt: true`. Pensée coupée **toujours, explicitement** (`effort none` en pipeline) : sur ce serveur la pensée est active par défaut (réponse vide et `finish_reason: length` si on n'envoie rien), et elle part parfois en boucle. Vérifié au WP0 : la grammaire ne s'applique qu'après le bloc de raisonnement, mais ce bloc coûte des centaines de tokens, voire ne se termine pas ; ne jamais l'activer avec une grammaire. `seed` ne garantit pas une sortie identique d'un appel à l'autre : le déterminisme se joue côté cortex (tests au faux serveur), pas côté modèle.
- Messages : `system` (consignes de l'étape, **constant**, en anglais) puis `user` (matière, **variable**). Jamais de `schema.md` dans le prompt.
- Consigne commune à tous les schémas : *never use the double-quote character inside a string value (use « » or backticks)*. Sans elle, la grammaire laisse le modèle fermer la chaîne sur un `"` qu'il voulait écrire dans le texte, et le tableau se referme prématurément (WP0 : 3 `key_points` sur 7). Les `maxLength` coupent net, même au milieu d'un mot : les garder larges et les traiter comme des garde-fous, pas comme des longueurs visées.
- Validation : `JSON.parse`, puis zod (même forme que le JSON Schema, plus les règles que la grammaire ne porte pas : tags dans la liste ou nouveaux, indices dans les bornes, citations non vides). Un échec renvoie la liste des erreurs comme message `user` supplémentaire et redemande, `LIMITS.pipelineRetries` fois (2). `finish_reason: "length"` compte comme un échec, la relance demande une sortie plus courte.
- Mesure : `$CORTEX_METRICS=<fichier.jsonl>` fait écrire une ligne par appel `{at, source, step, model, prompt_tokens, completion_tokens, ms, retries, ok}` depuis `usage` de la réponse (aucune instrumentation n'existe aujourd'hui ; `openai.ts` l'adopte au même moment pour permettre l'A/B).

Les consignes de chaque étape vivent dans `src/pipeline.md` (sections `## nom`, mêmes placeholders que `prompts.md`), les schémas dans `src/pipeline.ts`. Le contenu produit est dans la langue du wiki (`{{language}}`).

### 2.2 Extraction (`extract`)

Entrée (`user`) : la source (un chunk ou l'entier), les `tags` en usage, les `candidates` numérotés (`routeCandidates`, 10 max : titre et description). Max entrée 8k tokens, `max_tokens` 1 500.

```json
{ "type": "object", "additionalProperties": false,
  "required": ["summary", "key_points", "description", "tags", "subjects"],
  "properties": {
    "summary":     { "type": "string", "minLength": 200, "maxLength": 1200 },
    "key_points":  { "type": "array", "minItems": 3, "maxItems": 7, "items": { "type": "string", "maxLength": 300 } },
    "description": { "type": "string", "maxLength": 160 },
    "tags":        { "type": "array", "minItems": 1, "maxItems": 4, "items": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,30}$" } },
    "subjects":    { "type": "array", "maxItems": 8, "items": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "title", "candidate", "description", "facts"],
      "properties": {
        "kind":        { "enum": ["Concept", "Entity"] },
        "title":       { "type": "string", "maxLength": 80 },
        "candidate":   { "type": "integer", "minimum": -1 },
        "description": { "type": "string", "maxLength": 160 },
        "facts":       { "type": "array", "minItems": 1, "maxItems": 6, "items": {
          "type": "object", "additionalProperties": false, "required": ["claim", "quote"],
          "properties": { "claim": { "type": "string", "maxLength": 300 }, "quote": { "type": "string", "maxLength": 200 } } } } } } } } }
```

Consignes (`system`, résumé) : *You read one source for a personal wiki. Write in {{language}}. `summary`: one paragraph. `key_points`: 3 to 7 facts. `description`: one sentence for an index. `tags`: pick from the list given; add a new one only if none fits. `subjects`: the concepts and entities this source teaches something about (not every term mentioned); `candidate` is the number of the matching page in the list, or -1 for a new one; each `fact` is a claim this source supports, with `quote` copied verbatim (max 200 characters) from the source. Never invent a quote.*

Validation : tag hors liste autorisé mais normalisé (`tagKey`) ; `candidate` dans `[-1, n-1]` ; `quote` vérifiée à l'étape 3. `max_tags` de `cortex.json` est appliqué par `stamp`, pas par le modèle.

### 2.3 Réduction (`reduce`, sources longues seulement)

Entrée : les `summary` et `key_points` de chaque chunk, dans l'ordre. Sortie : même schéma restreint à `summary`, `key_points`, `description`, `tags`. Max entrée 3k, `max_tokens` 800. Les `subjects` ne passent pas par le modèle : cortex les fusionne (§3).

### 2.4 Routage et dédoublonnage (étape 4, sans le 4B)

Les candidats offerts à l'extraction viennent de la sélection élargie de §4.7 (10 max dans le prompt). Pour chaque sujet, dans l'ordre du collator sur le titre :
1. `candidate ≥ 0` → mise à jour de cette page (après vérification qu'elle est bien du type `kind` ; sinon traité comme -1).
2. `candidate = -1` → `nearDuplicate` de `naming.ts` (exporté) : `nearest(titre + description)`, 5 pages du même type, `judge` choice `p1…p5 | none` ; probabilité ≥ `dupJudge` (0,7) → mise à jour de la page choisie ; sans juge, cosinus ≥ `dupCosine`. Puis `nearTitle` sur les titres existants et sur les sujets déjà retenus dans ce compile (deux sujets au même slug fusionnent leurs faits).
3. Sujet sans fait vérifié → ignoré, signalé dans le rapport.

Aucun appel au 4B : ce sont les mêmes briques que `cortex new`, exécutées avant toute écriture, donc aucune page n'est créée pour être refusée.

### 2.5 Nouvelle page (`write`)

Entrée : `kind`, `title`, `description`, les faits (`claim` + `quote`), l'identifiant de note `[^{{id}}]` à utiliser, et la liste numérotée `pages` des pages liables (les autres sujets de ce compile, les candidats, la page Source) avec leur titre. Max entrée 3k, `max_tokens` 1 200.

```json
{ "type": "object", "additionalProperties": false, "required": ["body"],
  "properties": { "body": { "type": "string", "minLength": 300, "maxLength": 6000 } } }
```

Consignes : *Write the body of a wiki page of type {{kind}} titled « {{title}} », in {{language}}, Markdown, no title heading, no frontmatter, no bullet list of links. Use only the facts given; end each factual sentence with `[^{{id}}]`. Mention a page of the list as `[[p:N]]` (cortex turns it into a link). Structure: an opening paragraph, then 1 to 3 `##` sections.*

Validation : au moins une occurrence de `[^{{id}}]` ; tout `[^x]` avec un autre `x` est remplacé par `{{id}}` ; tout `[[p:N]]` hors bornes est retiré ; un lien Markdown écrit par le modèle vers `/wiki/…` est retiré (il ne connaît pas les chemins). Un corps sans note après retry → page créée quand même en `draft`, l'erreur de lint le signalera (§4.5).

### 2.6 Ajout à une page existante (`update`)

Entrée : le corps de la page (frontmatter retiré ; au-delà de 3k tokens : la liste des `##` et les 3k premiers tokens, avec la mention qu'elle est coupée), les faits, `[^{{id}}]`. Max entrée 5k, `max_tokens` 800.

```json
{ "type": "object", "additionalProperties": false, "required": ["section", "addition", "contradiction"],
  "properties": {
    "section":       { "type": "string", "maxLength": 80 },
    "addition":      { "type": "string", "minLength": 100, "maxLength": 2500 },
    "contradiction": { "type": ["string", "null"], "maxLength": 400 } } }
```

Consignes : *The page below exists. Write only what this source adds to it: `section` is the heading of the existing `##` section it belongs to, or a new short heading; `addition` is one to three paragraphs, Markdown, each factual sentence ending with `[^{{id}}]`, repeating nothing the page already says. `contradiction`: one sentence if the source contradicts the page, else null. Never rewrite the page.*

Validation : comme `write` ; une `addition` dont toutes les phrases sont déjà dans la page (§4.4) est un succès vide : rien n'est écrit, pas même l'entrée `sources[]` (une page ne cite pas une source dont elle ne tient rien).

### 2.7 Page Source

Aucun appel dédié : le corps est rendu par cortex depuis la réduction (§4.1). Le 4B a déjà produit le résumé et les points clés à l'extraction ; les faire réécrire coûterait un appel sans gain.

### 2.8 Réparation (`repair`)

Entrée : le corps d'une page, la liste des erreurs lint restant après les corrections mécaniques (§4.5). Sortie : `{ "body": string }`. Un seul essai, puis la page reste en `draft` avec l'erreur signalée. Attendu rare : presque tout ce que `lint.ts` vérifie se corrige sans modèle.

### 2.9 Connexions (`connect`, étape 4bis)

Ce que l'agent trouvait en lisant les pages voisines, et que l'extraction par sujets ne voit pas : une source qui précise, illustre ou contredit une page sans que cette page soit un de ses « sujets ». Un seul appel par source, après la réduction.

Entrée : `summary` et `key_points` (étape 2, ~400 tokens, jamais la source entière), les faits vérifiés de tous les sujets, numérotés (30 max), et la liste numérotée `pages` des 20–30 pages proches de §4.7 (titre, type, description en une ligne), moins celles déjà ciblées par un sujet. Max entrée 4k, `max_tokens` 600.

```json
{ "type": "object", "additionalProperties": false, "required": ["connections"],
  "properties": { "connections": { "type": "array", "maxItems": 10, "items": {
    "type": "object", "additionalProperties": false, "required": ["page", "relation", "facts", "why"],
    "properties": {
      "page":     { "type": "integer", "minimum": 0 },
      "relation": { "enum": ["extends", "contradicts", "example", "related"] },
      "facts":    { "type": "array", "maxItems": 6, "items": { "type": "integer", "minimum": 0 } },
      "why":      { "type": "string", "maxLength": 200 } } } } } }
```

Consignes : *Here is what a new source says, and a list of existing wiki pages. Which pages does this source touch? For each: `extends` (it adds a fact, figure or nuance: list the fact numbers), `contradicts` (list the facts), `example` (it is a worked case of the page), `related` (worth a link, nothing to add). Leave out pages it merely mentions. `why` in {{language}}, one sentence.*

Usage par cortex : `extends` et `contradicts` avec au moins un fait → une étape 6 (`update`) pour cette page, avec ces faits (une relation `contradicts` pousse la consigne à remplir `contradiction`) ; `example` et `related` → un lien seulement : ligne `- [Titre](/wiki/…md) — <why>` dans « Pages liées » de la page Source, et la page entre dans la liste `[[p:N]]` des étapes 5. Validation : `page` et `facts` dans les bornes, une page citée deux fois ne garde que la première relation, au plus `pipelineMaxConnections` (10). Pas de pages proches (petit wiki) → étape sautée.

## 3. Sources longues : chunks et map-reduce

- Seuil : une source de plus de `pipelineChunkTokens` (6 000 tokens, ~24 000 caractères, estimation à 4 caractères/token) est découpée. En dessous, une seule extraction. 6k et non 50k : le prefill d'un chunk de 6k coûte 5 à 25 s, la qualité d'extraction d'un 4B baisse avec la longueur, et quatre chunks de 7k tiennent ensemble dans le KV unifié de 64k (§5).
- Découpage (`src/chunk.ts`) : aux frontières de titres Markdown puis de paragraphes, jamais au milieu d'une phrase ; cible 6k, maximum 7k ; chevauchement de ~300 tokens (le dernier paragraphe du chunk précédent, marqué « (context) ») pour ne pas couper un raisonnement. Déterministe : même source, mêmes chunks.
- Map : une extraction par chunk, en parallèle (§5). Les candidats sont les mêmes pour tous (calculés sur les 1 500 premiers caractères, comme aujourd'hui `routeChars`).
- Reduce déterministe des sujets : clé = `candidate` si ≥ 0, sinon slug du titre ; faits concaténés, dédoublonnés sur le `claim` normalisé (minuscules, sans accents ni ponctuation) ; `description` du premier chunk ; `kind` majoritaire. Tags : union, puis les plus fréquents en premier. Au-delà de 8 sujets, on garde ceux qui ont le plus de faits vérifiés.
- Reduce par le modèle : résumé et points clés globaux (§2.3), à partir des résumés de chunk (n × ~250 tokens).
- Ordre d'écriture : sujets triés par le collator, pour que deux exécutions donnent le même diff.

## 4. Ce que cortex fait sans modèle

### 4.1 Page Source

`prepareSource` reste tel quel (type, titre, `status: draft`, `sources: [{id, resource, title}]` avec `id` = id brut, `generated`, callouts note et extraction partielle). Le pipeline complète : `description` et `tags` dans le frontmatter (`setFmLine`), puis le corps :

```markdown
> [!note] Note personnelle          ← déjà là
> …

## Résumé
<summary>[^<id>]

## Points clés
- <point 1>[^<id>]
- …

## Pages liées
- [Titre](/wiki/concepts/….md)      ← écrit par `weave` à partir des pages qui citent la source

[^<id>]: <titre de la source>, <url ou chemin raw>
```

### 4.2 Citations et vérification des faits (étape 3)

Chaque `quote` est cherchée dans le texte de la source, les deux normalisés (minuscules, accents retirés, espaces repliés, ponctuation ignorée). Pas trouvée telle quelle → recherche de sa plus longue sous-chaîne de 12 mots ; pas trouvée → le fait est **rejeté** et compté dans le rapport (`N faits sans citation rejetés`). C'est la garde contre l'invention, là où l'agent n'en a aucune. La `quote` n'est pas copiée dans la page (elle sert de preuve) ; la définition de note `[^id]` porte le titre et l'URL de la source, comme le permet `schema.md`.

Sur une page mise à jour, l'entrée `sources[]` ajoutée a pour `id` le slug du titre de la source (unique dans la page, suffixe `-2` sinon), et c'est cet `id` que l'étape `update` reçoit comme `{{id}}`.

### 4.3 Frontmatter, tags, liens

- Nouvelle page : `newPageCtx(w, kind, title, at, { fm: { description, tags, sources: [...] }, body })`, qui nomme le fichier et refuse un titre pris (déjà exclu par l'étape 4 ; une refus résiduel est signalé, la page passe en mise à jour de la page nommée dans l'erreur).
- `stamp` sur toutes les pages touchées (acteur `openai/<model>:pipeline`, synonymes de tags ramenés au tag en usage, `max_tags`).
- Placeholders `[[p:N]]` → `[Titre](/wiki/…md)` une fois tous les chemins connus (après création). Puis `weave` (Source ↔ pages citant la source) et `suggestLinks` avec `scope` sur les pages touchées, comme aujourd'hui.

### 4.4 Fusion dans une page existante (`src/merge.ts`)

1. Corps découpé en sections par `##` (le préambule compte comme section 0) ; les définitions `[^x]:` en fin de page sont mises de côté.
2. `section` normalisée (fold) comparée aux titres existants : égale ou `nearTitle` → cible ; sinon nouvelle section `## <section>` ajoutée avant les définitions de notes.
3. `addition` découpée en phrases ; une phrase dont la forme normalisée existe déjà dans la page, ou dont le Jaccard sur trigrammes de mots avec une phrase existante dépasse 0,8, est retirée. Un paragraphe vidé disparaît. Rien ne reste → aucune écriture, aucune entrée `sources[]`.
4. Le reste est ajouté en fin de section cible, séparé par une ligne vide. `contradiction` non nulle → callout `> [!warning] Contradiction` avec la phrase et `[^id]`, en tête de la section ; la page reste `draft` et le journal le dit.
5. `sources[]` reçoit l'entrée de la source ; la définition `[^id]:` est ajoutée aux autres. Les notes existantes restent valides (on n'enlève rien). Frontmatter touché par `setFmLine` ligne par ligne (`sources` ré-sérialisé en bloc, seule exception : lint vérifie la validité YAML avant écriture, comme `stamp`).

Jamais de réécriture : un modèle de 4B qui réécrit une page de 2 000 mots en perd la moitié ; ici il ne peut qu'ajouter.

### 4.5 Lint et réparation ciblée

Après l'application, `lint` sur les pages touchées (même filtre que `runChecked`). Corrections mécaniques d'abord : note orpheline `[^x]` → remplacée par l'unique `id` de la page ou retirée ; lien cassé → texte conservé, lien retiré ; lien relatif → racine ; `description` manquante → celle de l'extraction. Ce qui reste (corps vide, YAML cassé par un caractère) va à `repair` (§2.8), une page à la fois, un essai. Jamais de nouvelle passe « agent » sur tout le wiki.

### 4.6 État, reprise, idempotence, git

- Fichier d'état `.cortex/pipeline/<id brut>.json` : `{ version, model, source_sha256, steps: { extract: [...], reduce, route, write: {...}, update: {...} }, applied: { paths: [...] } }`. Chaque résultat validé est écrit aussitôt (`tmp` + `rename`).
- Reprise : au redémarrage, une étape dont le résultat est présent, pour le même `source_sha256` et le même modèle, est sautée ; `--fresh` ignore l'état. Aucune page n'est écrite avant l'étape 7 : un crash pendant les appels laisse le wiki intact. L'étape 7 est elle-même rejouable : une page déjà créée est reconnue par son titre (`applied.paths`), une fusion rejouée ne réinsère rien (§4.4, point 3).
- Fin de compile réussie : état supprimé (`--keep-state` le garde, pour le labo).
- Git : seules les pages touchées sont écrites, frontmatter modifié ligne à ligne, ordre d'écriture fixé par le collator, `temperature 0` et `seed` fixe : deux compiles de la même source sur le même wiki donnent le même diff, aux non-déterminismes du serveur près (batching, slots). `changed`/`outOfScope` restent la garde de périmètre.

### 4.7 Candidats élargis

`routeCandidates` ne voit aujourd'hui que les 10 pages les plus proches par embeddings. L'agent, lui, suivait les liens des pages qu'il lisait. Le pipeline élargit de façon déterministe, puis laisse d3-mini trier :

1. **Noyau** : `nearest(titre + 1 500 premiers caractères)`, 10 pages Concept/Entity, par score décroissant.
2. **Voisins à un lien** : pages liées depuis ou vers une page du noyau (graphe de `context.ts`), classées par nombre de pages du noyau dont elles sont voisines, puis par score d'embedding si elles en ont un.
3. **Pages partageant un tag** avec au moins deux pages du noyau (un tag partagé avec une seule page est trop lâche), classées par nombre de tags partagés.
4. Bornes : `pipelineCandidatesPool` (30) au total, dans cet ordre de priorité (noyau complet, puis voisins, puis tags jusqu'à remplir) ; pages Source et Synthesis exclues (la Source est 1:1 avec sa source brute ; une synthèse se relit, elle ne s'enrichit pas au fil des sources) ; pages `deprecated` exclues.
5. **Tri par d3-mini** : une question noul par page, « does the source bring information that belongs on this page? », toutes dans un appel (état : titre + 1 500 caractères de la source ; 30 questions × ~400 tokens lus ≈ 12k tokens à ~1 200 tok/s ≈ 10 s, timeout `JUDGE.longTimeoutMs`). Tri par probabilité décroissante.
6. Sorties : les 10 premières à ≥ `routeYes` (0,5) deviennent les `candidates` de l'extraction ; les 20–30 du pool, triées, deviennent les `pages` de l'étape 4bis. Sans juge : ordre du point 4 ; sans embeddings : voisins et tags des pages trouvées par BM25 sur le titre (`search`), même bornes.

Coût : un appel embeddings, un appel juge, aucun appel au 4B. Petit wiki (moins de 10 pages candidates) : pas de tri, tout passe.

### 4.8 File `wiki/queue.jsonl` et synthèses à écrire

Ce que ni le pipeline ni la maintenance ne tranchent seuls doit rester visible pour l'humain, dans le wiki, versionné et synchronisé : une **file**, sur le modèle du journal.

- `wiki/queue.jsonl` : append-only, une entrée JSON par ligne : `{ "at", "kind": "synthesis" | "merge" | "contradiction" | "split" | "review", "title", "reason", "pages": [...], "sources": [...], "proposal"?: "...", "status": "open" | "done" | "dismissed", "ref"?: "<at de l'entrée close>" }`. Fermer une entrée = en ajouter une `done`/`dismissed` qui la référence (`cortex queue done <n>`, `cortex queue dismiss <n>`) ; la dernière ligne pour une `ref` gagne.
- `wiki/queue.md` : généré par `cortex index` (nom réservé, comme `log.md` : `isReservedPage`, lint vérifie qu'il correspond à sa génération), entrées ouvertes d'abord, par `kind`, avec les pages par titre et la proposition repliée. Le site l'affiche sur `/queue/` (même modèle que `/log/`), le MCP l'expose en lecture (`queue`), `cortex queue [--kind k] [--json]` la lit, `cortex lint` compte les entrées ouvertes de plus de 30 jours (info).
- **Synthèses à écrire (étape 7bis)** : détection déterministe sur le graphe de liens des pages Concept/Entity/Synthesis (arêtes non orientées, pages Source exclues). Avant l'étape 7, cortex calcule les composantes connexes ; après, les pages que la page Source relie (sujets créés ou mis à jour, connexions `extends`/`example`/`related`). Si ces pages appartenaient à au moins deux composantes distinctes de taille ≥ `pipelineBridgeMinSize` (3) chacune, la source **fait pont** : entrée `synthesis` avec `title` « Synthèse : <titre composante A> / <titre composante B> » (titre = page de plus fort degré de chaque composante), `pages` = les deux pages de plus fort degré et celles touchées, `sources` = la source. Une entrée ouverte pour la même paire de composantes n'est pas dupliquée. Aucun appel au modèle : écrire la synthèse est une tâche de `cortex maintain synthesize` (§8.4) ou de `cortex ask --file`.

## 5. Parallélisme et cache

- Serveur de référence : `llama-server` en mode routeur, `qwen3.5-4b` lancé avec `--ctx-size 65536 --cache-ram 1024 --cache-reuse 256 --cache-type-k/v q8_0 --flash-attn on`, sans `-np` ni `-kvu` explicites : le serveur ouvre 4 slots à KV unifié par défaut (`/slots` : 4 slots de `n_ctx` 65536, partagés). Les 64k sont donc partagés entre les 4 slots, chaque requête doit tenir dans ce qui reste ; `/props?model=qwen3.5-4b` donne `total_slots`. Le pipeline borne ses appels à 8k d'entrée + 1,5k de sortie : quatre en vol tiennent (< 40k).
- Dans une source : chunks d'extraction en parallèle, puis pages `write` et `update` en parallèle, par un pool de `pipeline.parallel` (défaut `LIMITS.pipelineParallel` = 4, à aligner sur `n_slots`). Étapes 2–4 et 7–9 séquentielles (elles sont rapides ou doivent voir les pages déjà créées).
- Entre sources : séquentiel (`--pending`), comme aujourd'hui : le dédoublonnage d'une source doit voir les pages créées par la précédente. Un `--jobs` entre sources viendrait plus tard, avec un verrou sur l'étape 7.
- Cache de préfixe : `cache_prompt: true` ; le `system` de chaque étape est constant et vient en premier, la matière variable ensuite. llama.cpp route une requête vers le slot au préfixe le plus proche (`--slot-prompt-similarity`), donc les quatre chunks d'une source partagent leur préfixe de consignes. Gain modeste (quelques centaines de tokens par appel) : l'essentiel vient de la petitesse des prompts, pas du cache.
- Embeddings et juge : appels séquentiels courts, un par sujet (le juge lit l'état une fois par question, ~1 200 tok/s) ; mêmes timeouts et repli que `naming.ts`.

## 6. Risques, pertes, évaluation

### 6.1 Risques de qualité et parades

| Risque | Parade |
|---|---|
| Faits inventés | citation verbatim obligatoire, vérifiée dans la source (§4.2) ; fait rejeté sinon |
| Sujets trop nombreux ou trop fins (« chaque mot un concept ») | 8 sujets max, 1 fait minimum, consigne « what the source teaches about », juge sur les doublons |
| Mauvais candidat choisi (fait rattaché à la mauvaise page) | le `kind` du candidat est vérifié ; ajout en section nommée, relisible dans le diff ; `status: draft` |
| Ajout redondant avec la page | dédoublonnage de phrases (§4.4) |
| Grammaire qui dégrade la prose (JSON contraint, échappements) | `maxLength` larges, validation post-parse, consigne sur le Markdown ; mesurer au WP0 la qualité avec et sans grammaire |
| Chunk qui coupe une idée | chevauchement, réduction globale par le modèle |
| Schéma JSON non supporté par le convertisseur GBNF (`pattern`, `minLength`) | zod revalide tout ; en cas d'erreur serveur sur un mot-clé, le schéma est resoumis sans lui (`llm.ts` retire `pattern`, `minLength`, `minimum`) |
| Serveur sans `json_schema` (Ollama ancien) | `llm.ts` bascule sur `response_format: {type: "json_object"}` + validation zod + retries, et le signale |

### 6.2 Ce qui est perdu par rapport à l'agent, et sa compensation

| Perdu | Compensé par | Quand |
|---|---|---|
| Lecture libre du wiki, découverte de pages voisines | candidats élargis (§4.7) et étape connexions (§2.9) | ingestion (v1) |
| Jugement global « cette source relie des choses » | détection déterministe des ponts, file `synthesis` (§4.8) | ingestion (v1) |
| Fusion de deux pages qui disent la même chose | `cortex maintain merge` (§8.1) | maintenance (v2) |
| Résolution d'une contradiction | encadrés accumulés à l'ingestion, `cortex maintain contradictions` (§8.2) | maintenance (v2) |
| Restructuration, découpage d'une page devenue fourre-tout | `cortex maintain split` (§8.3), file `review` quand le juge hésite | maintenance (v2) |
| Rédaction d'une synthèse transversale | `cortex maintain synthesize` depuis la file (§8.4) | maintenance (v2) |
| Présentation au humain avant d'écrire | tout en `draft`, rapport de compile, diff git, file `wiki/queue.md` et `/queue/` sur le site | v1 |
| Description d'une image par la vision | localement : llama.cpp multimodal et `image_url`. **Piste 1, à vérifier d'abord** : qwen3.5-4b, déjà chargé, est peut-être nativement multimodal ; il suffirait alors d'ajouter son `mmproj` (~0,4-0,7 Go) à son preset, ce qui tient dans les ~2 Go de VRAM libres (10 Go, 8,2 utilisés). **Piste 2, seulement si la 1 échoue** : un Qwen-VL 4B séparé (~2,5 Go + `mmproj` + cache ≈ 3,5 Go) ; il ne tient pas tel quel : repasser qwen3.5-4b à 32k ne libère qu'~0,5 Go (mesuré : 7,1 → 7,6 Go de 32k à 64k), il faudrait aussi le passer à 16k (les appels du pipeline font ≤ 8k, mais 4 slots parallèles en demandent ~32k) et réduire `ub` de d3-mini, sinon le charger à la demande (le routeur décharge un autre modèle). Puis `image_url` dans `chat/completions`, étape `describe` → `{ description, text }` JSON, injectée comme texte de source avant l'extraction ; OCR `tesseract.js` déjà prévu pour le texte seul | hors périmètre de la v1 : une source `kind: image` passe en `skipped` avec une entrée `review` ; étape `describe` en v1.1 une fois le serveur vision validé au labo |

Le mode agentique n'est pas une solution de repli de ce design : il reste disponible, mais rien ici ne suppose qu'un client fort existe.

### 6.3 Évaluation sur `fmatsos/cortex-lab`

- Fixtures : les 12 sources du labo (plus 3 longues), compilées depuis un clone propre du wiki de référence, même `cortex.json`, même serveur.
- Métriques par source, lues dans `$CORTEX_METRICS` et dans le wiki résultant : durée murale, appels, tokens lus et générés, retries, erreurs lint après compile, pages créées, **pages modifiées par source** (l'agent en touchait 1 à 3 ; le pipeline avec connexions devrait en toucher 3 à 8 sans redondance), **liens créés** (dans les pages touchées, hors « Pages liées » de la Source), faits rejetés, **doublons** (titre proche ou juge ≥ 0,7 entre deux pages du résultat), **orphelines** après compile (`lint` warning `orphan`), **synthèses détectées** (entrées `synthesis` ouvertes, et combien un relecteur juge pertinentes), notes `[^id]` dont la source cite bien le fait (échantillon de 5 par source, à la main), note de qualité 1–5 de la page Source et d'une page Concept (grille : fidélité, complétude, lisibilité).
- A/B : `compile --batch` (boucle agentique du client `openai`, même modèle) contre `compile --pipeline`, mêmes fixtures ; puis le pipeline seul sur un 8B pour mesurer ce que la taille du modèle change. Script `lab/ab.sh` qui enchaîne clone, compile, `lint --json`, `queue --json`, extraction des métriques en CSV ; rapport par source et par modèle. Pour `cortex maintain` (v2) : un wiki de labo avec doublons, contradictions et pages longues plantés exprès, précision et rappel de chaque sous-commande mesurés contre cette vérité terrain.
- Critères pour faire du pipeline le défaut du client `openai` : sur deux campagnes, (1) durée médiane ≤ 1/3 de l'agent et aucune source > 10 min ; (2) 0 erreur lint résiduelle ; (3) doublons ≤ agent et orphelines ≤ agent ; (4) qualité moyenne ≥ agent − 0,3 et fidélité ≥ agent ; (5) pages modifiées par source ≥ agent, avec ≤ 10 % d'ajouts jugés hors sujet par le relecteur ; (6) échecs (source non compilée) < 5 %.

## 7. Plan d'implémentation

### 7.1 Fichiers

| Fichier | Rôle |
|---|---|
| `src/llm.ts` (nouveau) | `structured()` : appel JSON contraint, validation zod, retries, repli `json_object`, métriques `$CORTEX_METRICS`. Réutilise `endpoint`, `thinking`, `cache`, `baseUrl` de `backends/openai.ts` |
| `src/pipeline.ts` (nouveau) | orchestrateur `compilePipeline(w, raw, opts, report)` : étapes, DAG, pool, état, application |
| `src/pipeline.md` (nouveau) | consignes des étapes (`## extract`, `## reduce`, `## write`, `## update`, `## repair`), chargées comme `prompts.md` |
| `src/chunk.ts` (nouveau) | découpage déterministe, estimation de tokens |
| `src/merge.ts` (nouveau) | fusion dans une page existante, dédoublonnage de phrases, `sources[]` et notes |
| `src/cite.ts` (nouveau) | normalisation, vérification des citations, définitions de notes |
| `src/route.ts` (nouveau) | candidats élargis (§4.7) : noyau, voisins, tags, tri par le juge ; remplace `routeCandidates` d'`agent.ts` |
| `src/queue.ts` (nouveau) | `wiki/queue.jsonl` : lecture, ajout, clôture, rendu de `wiki/queue.md` ; détection des ponts (§4.8) ; `cortex queue` |
| `src/maintain.ts` (nouveau, v2) | `cortex maintain merge|contradictions|split|synthesize [--apply] [--dry-run]` (§8) |
| `src/naming.ts` | exporter `nearDuplicate` (et son type) |
| `src/catalog.ts`, `src/lib.ts`, `src/lint.ts`, `src/mcp.ts`, `site/` | `queue.md` réservé et régénéré, lint de la file, outil MCP `queue`, page `/queue/` ; frontmatter `superseded_by` (lint : une page `deprecated` doit l'avoir ; export : bandeau « remplacée par ») |
| `src/agent.ts` | `compileCtx` : si `opts.pipeline`, appelle `compilePipeline` à la place de `runChecked` ; `prepareSource`, `stamp`, `weave`, liens, journal, `markCompiled` partagés (exportés) |
| `src/backends/openai.ts` | métriques `$CORTEX_METRICS` sur la boucle agentique (pour l'A/B) |
| `src/cortex.ts`, `src/help.ts` | drapeaux `--pipeline`, `--fresh`, `--keep-state` ; `--pipeline` implique `--batch` et exige `client: openai` |
| `src/config.ts` | plus tard : `pipeline: { enabled, parallel, chunk_tokens }` (WP7) |
| `src/limits.ts` | `pipelineChunkTokens` 6000, `pipelineChunkOverlap` 300, `pipelineParallel` 4, `pipelineRetries` 2, `pipelineMaxSubjects` 8, `pipelineQuoteChars` 200, `pipelineMaxInputTokens` 8000, `pipelineCandidatesPool` 30, `pipelineMaxConnections` 10, `pipelineBridgeMinSize` 3, `queueStaleDays` 30 ; v2 : `mergeCosine` 0,8, `splitWords` 2500, `splitSectionCosine` 0,45, `maintainJudge` 0,8 |
| `src/schema.md`, `docs/DESIGN.md`, `README.md` | une ligne : « Started by `cortex compile --pipeline` : the model never reads this file » ; §3 et §6 de DESIGN |

### 7.2 Tests

- `llm.test.ts` : faux serveur `Bun.serve` (même patron que `openai-backend.test.ts`) qui vérifie `response_format.json_schema.schema`, `temperature`, l'absence de clé vers une URL de `cortex.json` ; rejoue JSON invalide → retry avec les erreurs ; `finish_reason: length` ; 400 sur `pattern` → resoumission sans ; serveur sans `json_schema` → repli ; lignes de métriques.
- `chunk.test.ts` : seuils, coupures aux titres, chevauchement, déterminisme, source sans titre.
- `cite.test.ts` : citation exacte, accents et ponctuation, sous-chaîne de 12 mots, rejet.
- `merge.test.ts` : section existante / nouvelle, dédoublonnage de phrases, contradiction, `sources[]` et notes, rejeu idempotent, page sans `##`.
- `pipeline.test.ts` : faux serveur scripté par `json_schema.name` (extract → write/update) avec faux `/embeddings` et `/systemone` ; source courte (4 appels), longue (chunks, reduce) ; sujet rattaché à un candidat, sujet dédoublonné par le juge, fait rejeté ; crash simulé après `extract` → reprise sans rappeler `extract` ; `--fresh` ; wiki intact avant l'étape 7 ; même diff sur deux exécutions ; `outOfScope` vide ; journal et index régénérés ; `compiled` posé.
- `route.test.ts` : noyau, voisins à un lien, tags partagés par ≥ 2 pages du noyau, bornes et ordre de priorité, exclusions (Source, Synthesis, deprecated), tri par faux `/systemone`, replis sans juge et sans embeddings.
- `connect` dans `pipeline.test.ts` : relation `extends` → étape `update` avec les bons faits ; `related` → lien seul ; page citée deux fois ; indices hors bornes ; étape sautée sans pages proches.
- `queue.test.ts` : ajout, clôture par référence, rendu `queue.md` déterministe, lint de la file ; détection des ponts sur un graphe à deux composantes (pont, pas de pont, composante trop petite, entrée déjà ouverte).
- `maintain.test.ts` (v2) : paires proches → juge → faux 4B → page fusionnée, `deprecated` + `superseded_by`, liens entrants réécrits, `--dry-run` sans écriture ; encadré contradiction → proposition en file ou appliquée avec `--apply` ; page longue multi-sujets → plan de découpage → pages créées, renvoi, liens ; juge incertain → entrée `review`, rien d'écrit.
- `determinism.test.ts` : étendu à deux compiles pipeline (octets identiques).

### 7.3 Lots de travail (chacun confiable à un agent séparé)

| Lot | Contenu | Dépend de |
|---|---|---|
| WP0 — spike (½ j) | sur le serveur réel : `json_schema` avec `enable_thinking: false` ; la grammaire avec pensée active ; `seed` ; 4 appels en vol avec `-kvu` ; qualité d'une extraction avec et sans grammaire ; mesurer prefill/génération. Résultat : `docs/PIPELINE.md` §2.1 et §5 confirmés ou amendés | — |
| WP1 — `llm.ts` | helper, retries, repli, métriques ; métriques aussi dans `openai.ts` ; tests | WP0 |
| WP2 — `chunk.ts`, `cite.ts` | découpage, vérification des citations, définitions de notes ; tests | — |
| WP3 — extraction et réduction | schémas et consignes `extract`/`reduce`, fusion déterministe des sujets ; test avec faux serveur | WP1, WP2 |
| WP4 — routage | `nearDuplicate` exporté, décision par sujet, fusion des sujets proches ; `route.ts` : candidats élargis (§4.7) et tri par le juge ; tests avec faux `/embeddings` et `/systemone` | — |
| WP5 — `merge.ts` et étapes `write`/`update` | schémas, consignes, placeholders `[[p:N]]`, fusion ; tests | WP1 |
| WP5b — connexions | schéma et consignes `connect` (§2.9), conversion en étapes `update` et en liens ; test | WP1, WP3, WP4 |
| WP6 — `pipeline.ts` | orchestrateur, état et reprise, application, lint et `repair`, branchement dans `agent.ts`, drapeaux CLI, aide ; test bout en bout | WP3, WP4, WP5, WP5b |
| WP6b — file et ponts | `queue.ts`, `queue.md` réservé, `cortex queue`, lint, MCP, page `/queue/` du site ; détection des ponts branchée en 7bis | WP6 (le module file est indépendant et peut commencer avant) |
| WP7 — labo et défaut | `lab/ab.sh` et agrégation CSV dans `cortex-lab`, deux campagnes, rapport ; puis clé `pipeline` de `cortex.json`, défaut pour `openai`, docs | WP6, WP6b |
| WP8 — `maintain merge` (v2) | paires proches, juge, appel `merge`, dépréciation avec `superseded_by`, réécriture des liens entrants, `--dry-run`, lint et export de `superseded_by` ; wiki de labo planté | WP1, WP4, WP6b |
| WP9 — `maintain contradictions` (v2) | collecte des encadrés, appel `resolve`, file ou `--apply` | WP8 (ossature de `maintain.ts`) |
| WP10 — `maintain split` et `synthesize` (v2) | détection des pages longues ou multi-sujets, appel `split`, création et renvoi ; `synthesize` depuis la file | WP8, WP6b |
| WP11 — maintenance planifiée (v2) | `cortex maintain` hebdomadaire sur la machine qui héberge llama.cpp (cron ou systemd timer sur le LXC, pas GitHub Actions : la non-exigence « pas de CI qui lance un LLM » de DESIGN §11 vise l'hébergeur de code, à amender ainsi), rapport dans le journal, `git commit` sur une branche `maintain/<date>` à relire | WP8–WP10 |

WP2, WP4 et (après WP1) WP5 sont indépendants et parallélisables ; le module file de WP6b aussi. Chaque lot livre ses tests ; aucun lot ne touche au mode agentique hors des métriques du WP1.

## Résultats du WP0

Mesures sur `http://192.168.1.96:8080/v1`, `qwen3.5-4b` (llama.cpp b1188, mode routeur), du 2026-11-06. **Biais : un run du labo (`cortex-lab` run 50) occupait en continu le slot 3 pendant toute la session** (`/slots` : `is_processing` constant), donc les débits de génération sont probablement pénalisés. Peu de requêtes, toutes courtes ; les scripts sont restés hors du dépôt. Source de test : les 1 500 premiers mots (~4,3k tokens avec les consignes, 12,6k caractères) d'une spécification technique française (`djlib`), avec le schéma d'extraction de §2.2 et trois candidats factices.

| Question | Résultat |
|---|---|
| `json_schema` imbriqué (`response_format.json_schema.schema`) | Accepté, grammaire appliquée (enum, `pattern`, `minItems`/`maxItems`, `maxLength` respectés). `name` et `strict` ignorés. |
| Pensée par défaut | **Active** : sans paramètre, `content` vide, `reasoning_content` plein, `finish_reason: length`. |
| Couper la pensée | `chat_template_kwargs: {enable_thinking: false}` et `reasoning_effort: "none"` marchent, séparément. La sortie de `thinking("none")` de `openai.ts` (les deux champs plus `think: false`) est acceptée sans erreur. Plus de `reasoning_content` dans la réponse. |
| Grammaire avec pensée active | Elle ne s'applique **qu'après** le bloc de raisonnement (schéma forçant `title: "ZETA"` alors que la pensée prévoyait un autre titre : la sortie finale est `ZETA`). Mais la pensée consomme 500 à 700 tokens pour un prompt trivial, et sur deux essais plus ouverts elle n'a pas fini en 2 500 tokens (`content` vide). Conclusion : pensée coupée, toujours. |
| `seed` à `temperature: 0` | **Non déterministe** : deux requêtes identiques, avec `cache_prompt` coupé ou non, divergent au bout de 150 à 300 caractères (aussi à `temperature: 0.7` avec le même `seed`). Cause probable : numérique des lots GPU avec un autre slot actif ; non isolé. Le test d'octets identiques de §7.2 reste valable car il s'exécute contre un faux serveur. `seed: 7` reste utile (reproductibilité approximative), à ne pas promettre. |
| Quatre appels en vol | Quatre requêtes de 1,6k tokens d'entrée et 200 de sortie, simultanées : aucune erreur, 27,8 s au total. Débit de génération ~11,4 tok/s par requête, soit ~45 tok/s cumulés contre ~22 tok/s seul : le parallélisme à 4 double environ le débit. |
| Débits | Prefill à froid ~580 tok/s (4,3k tokens en 7,5 s) ; ~490 tok/s sur 900 tokens. Génération ~22 tok/s seul (spec : 33, non reproduit, cf. biais). Une extraction complète (4,3k en entrée, 1,1 à 1,4k en sortie) : 59 à 70 s, dont 50 à 60 s de génération. |
| Cache de prompt | `cache_prompt: true` : 902 tokens sur 906 relus du cache à la requête suivante ; `timings.cache_n` et `usage.prompt_tokens_details.cached_tokens` l'indiquent. `usage.prompt_tokens` compte les tokens du cache : pour le prefill réel, lire `timings.prompt_n`. |

**Qualité de l'extraction, avec et sans grammaire** (pensée coupée, même prompt, `max_tokens` 1 500) :

| | Avec grammaire | Sans (JSON demandé dans la consigne) |
|---|---|---|
| JSON valide au premier essai | oui | oui |
| `key_points` | 3 (voir ci-dessous) | 7 |
| Sujets / faits | 3 / 11 | 3 / 6 |
| Citations retrouvées dans la source (normalisées) | 8 sur 11 | 4 sur 6 |
| Résumé | 860 caractères | 949 caractères |

- La prose n'est pas dégradée par la grammaire, mais la grammaire a une panne caractéristique : le modèle voulait écrire un `"` dans un `key_point`, le `"` a fermé la chaîne (« …une structure `{ »), puis le tableau s'est refermé à 3 éléments. Avec la consigne ajoutée à §2.1 (pas de guillemet droit dans les valeurs) : 7 `key_points`, 12 faits, plus de coupure. Le sans-grammaire n'a pas eu ce défaut mais n'offre aucune garantie de forme (il faut alors réparer) ; l'avantage de la grammaire est la forme, à protéger par cette consigne.
- **Citations** : sans normalisation, 4 citations sur 11 seulement étaient trouvées, car la source utilise l'apostrophe typographique `’` et le modèle écrit `'`. Après normalisation (`’` → `'`, retrait des marques Markdown `` ` `` et `*`, espaces repliés, minuscules), 8 sur 11. `cite.ts` (WP2) doit normaliser ainsi des deux côtés. Les 3 restantes visent des listes, tableaux ou schémas de la source dont le modèle a recollé les lignes : elles sont rejetées à juste titre, le fait est ignoré sans perte grave (d'autres faits du même sujet restent).
- Les sujets sont corrects et le routage vers les candidats aussi (`Format JSON` → 0, `djlib` → 1, `Dry-run` → 2) ; le modèle n'a pas inventé de sujet hors des trois candidats. Un seul article, un seul essai par mode : indicatif, pas statistique.

**Spec amendée** : §1.4 (débit de génération), §2.1 (pensée toujours coupée explicitement, `seed` non déterministe, consigne sur les guillemets, `maxLength` qui coupent net), §5 (arguments réels du serveur, 4 slots à KV unifié par défaut). Conséquences pour les lots : WP1 envoie toujours `thinking("none")` et ne compte pas sur `seed` ; WP2 normalise les citations comme ci-dessus ; WP7 compare les temps avec un GPU libre.

## 8. Maintenance différée : `cortex maintain` (v2)

Ce que l'ingestion ne doit pas faire (elle voit une source à la fois) et que l'agent faisait au fil de l'eau, en lisant le wiki. Une commande séparée, même pile locale, mêmes briques (`structured`, `nearDuplicate`, `similar`, `merge.ts`, file). Règle commune : **d3-mini confirme avant tout appel au 4B, cortex écrit, et ce qui n'atteint pas `maintainJudge` (0,8) va dans la file `review` au lieu d'être appliqué.** Par défaut `--dry-run` liste ; `--apply` écrit ; chaque sous-commande écrit une entrée `update` du journal et laisse les pages touchées en `draft`. Le labo mesure précision et rappel de chaque détection (§6.3).

### 8.1 Fusion (`maintain merge`)

1. Candidats : paires de pages du même type (Concept, Entity) de cosinus ≥ `mergeCosine` (0,8) sur les vecteurs stockés (`similar`, aucun appel serveur), plus les paires `nearTitle` et les `probable duplicate` de lint. Pages `deprecated` exclues.
2. Juge : choice « same subject / overlapping / different » sur titres et descriptions (comme `nearDuplicate`). `same` ≥ 0,8 → fusion ; `overlapping` → entrée `review` ; `different` → rien, la paire est notée dans l'état pour ne pas être reposée (`.cortex/maintain.json`, par hash des deux pages).
3. Cible = la page la plus ancienne (UUID v7 : la première créée) ; l'autre est absorbée.
4. Appel `merge` : entrée = les deux corps (frontmatter retiré, 8k tokens max ensemble, sinon entrée `review`), les `id` de notes valides des deux pages, `max_tokens` 2 000. Schéma `{ "title": string, "description": string, "body": string }`. Consignes : *Merge the two pages into one, in {{language}}: keep every fact of both, each with its footnote id as given, drop repetitions, keep the structure of the first page where possible, never invent.* Validation : chaque `[^id]` du corps appartient à l'union des `sources[]` ; au moins 80 % des notes des deux pages sont encore présentes (sinon retry avec la liste des notes manquantes, puis `review`).
5. Écriture : corps et `description` sur la cible, `sources[]` = union, `tags` = union puis `stamp` (`max_tags` non appliqué : la page n'est pas « créée »), `aliases` = anciens titres (déjà lus par `suggestLinks`) ; page absorbée → `status: deprecated`, `superseded_by: /wiki/…md`, corps remplacé par une ligne « Remplacée par [Titre](/wiki/…md). » au-dessus de l'ancien corps conservé ; liens entrants `(/wiki/absorbée.md)` réécrits vers la cible dans tout le wiki (`stampLinked`), sauf dans la page absorbée elle-même ; entrée `merge` fermée dans la file si elle existait.

### 8.2 Contradictions (`maintain contradictions`)

1. Collecte : encadrés `> [!warning] Contradiction` écrits à l'ingestion (§4.4), avec leur note `[^id]` et la section qui les porte ; entrées `contradiction` ouvertes de la file.
2. Appel `resolve` : entrée = la section concernée (pas toute la page), l'encadré, le résumé de la page Source citée par l'encadré et celui des Sources citées par la section (depuis leurs pages Source : jamais les sources brutes). Schéma `{ "verdict": "newer_source_wins" | "older_text_wins" | "both_hold" | "unsure", "section": string, "note": string }` : `section` = la section réécrite, `note` = une phrase expliquant la résolution, `max_tokens` 1 200. Validation : mêmes notes `[^id]` présentes qu'avant, plus celle de l'encadré.
3. Juge sur le résultat : noul « does `section` keep every fact of `before` and of `callout`, with its citation? » ≥ `maintainJudge` → applicable.
4. Par défaut : entrée `contradiction` dans la file avec la proposition (`proposal` = la section réécrite et la `note`), visible sur `/queue/`, à appliquer par `cortex queue apply <n>` (cortex remplace la section, retire l'encadré) ou à écarter. `--apply` : applique directement les verdicts autres que `unsure` qui passent le juge ; les `unsure` restent en file. Une page `stable` ou `verified` repasse en `draft` (règle de `schema.md`).

### 8.3 Restructuration et découpage (`maintain split`)

1. Détection déterministe : page Concept/Entity de plus de `splitWords` (2 500) mots, **ou** multi-sujets : les sections `##` d'une page sont embarquées séparément (appel `/embeddings`, une fois par page changée, vecteurs gardés dans `.cortex/maintain.json` par hash de section) et la page est candidate si deux groupes de sections ont un cosinus moyen entre eux < `splitSectionCosine` (0,45) tout en étant cohérents en interne (> 0,6), par un regroupement hiérarchique simple sur 3 à 12 sections. Une page à moins de 3 sections n'est jamais candidate.
2. Juge : choice « one subject / several subjects / unsure » sur le titre, la description et la liste des `##` avec leur première phrase. `several` ≥ 0,8 → découpage ; `unsure` → entrée `review` « page à restructurer » avec les groupes de sections proposés ; `one` → notée, non reposée.
3. Appel `split` : entrée = titre, description, les sections avec leur numéro et leur première ligne (pas les corps : le modèle planifie, il ne réécrit pas), les groupes détectés comme suggestion. Schéma :
   ```json
   { "type": "object", "additionalProperties": false, "required": ["keep", "pages"],
     "properties": {
       "keep":  { "type": "object", "additionalProperties": false, "required": ["title", "description", "sections"],
                  "properties": { "title": { "type": "string", "maxLength": 80 }, "description": { "type": "string", "maxLength": 160 }, "sections": { "type": "array", "items": { "type": "integer", "minimum": 0 } } } },
       "pages": { "type": "array", "minItems": 1, "maxItems": 4, "items": {
         "type": "object", "additionalProperties": false, "required": ["kind", "title", "description", "sections", "intro"],
         "properties": { "kind": { "enum": ["Concept", "Entity"] }, "title": { "type": "string", "maxLength": 80 }, "description": { "type": "string", "maxLength": 160 },
                         "sections": { "type": "array", "minItems": 1, "items": { "type": "integer", "minimum": 0 } }, "intro": { "type": "string", "maxLength": 600 } } } } } }
   ```
   Validation : chaque section apparaît exactement une fois (dans `keep` ou une page) ; `keep.sections` non vide ; titres non pris (`nearTitle`, `nearDuplicate` comme pour toute création : un titre refusé → entrée `review`).
4. Écriture : les sections sont **déplacées** telles quelles (texte intact, notes comprises) dans les nouvelles pages créées par `newPageCtx` (`sources[]` restreint aux notes présentes dans leurs sections, tags hérités puis `stamp`), avec `intro` en tête ; la page d'origine garde ses sections `keep`, prend le nouveau titre et la nouvelle description si donnés, et reçoit une section « Voir aussi » listant les pages issues du découpage (renvoi) ; chaque nouvelle page lie la page d'origine. Liens entrants : inchangés (la page d'origine existe toujours), puis `suggestLinks` ciblé sur les nouvelles pages pour rediriger les mentions de leurs titres. Entrée `split` fermée dans la file.

### 8.4 Synthèses (`maintain synthesize`)

Prend les entrées `synthesis` ouvertes (§4.8). Appel `synthesize` : entrée = titre et résumé (description + première section) des pages des deux composantes (10 pages max, 6k tokens max, sinon `review`), `max_tokens` 1 500 ; schéma `{ "title", "description", "body" }` avec `[[p:N]]` pour les liens et aucune note : une synthèse cite des pages, pas des sources (ses `sources[]` restent vides, ses liens sont ses références). Validation : au moins un `[[p:N]]` vers chaque composante. Juge : noul « is `body` a synthesis that relates the two groups, not a list of their contents? » ≥ 0,8 → page Synthesis créée en `draft`, entrée fermée ; sinon la proposition va dans l'entrée (`proposal`), à relire.

### 8.5 Ce qui reste à l'humain

La file `review` (juge incertain, entrée trop longue, titre refusé) et la relecture des `draft` : `cortex queue` et `/queue/` sur le site les montrent, `cortex queue done|dismiss|apply` les ferme. Aucune de ces tâches ne suppose un autre modèle que la pile locale ; quand le juge ne tranche pas, le design choisit de ne rien écrire plutôt que d'écrire faux.
