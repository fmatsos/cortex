# Plan — Migration des embeddings Ollama → FastEmbed (provider `builtin`)

## Context

Cortex utilise aujourd'hui **Ollama** comme fournisseur d'embeddings par défaut
(`provider = "ollama"`, modèle `nomic-embed-text`, endpoint HTTP local 768-dim).
Cela impose une dépendance système externe (daemon à lancer, modèle à puller,
endpoint à maintenir) qui complique l'onboarding et rend les index incohérents
entre utilisateurs.

L'objectif est de remplacer Ollama comme dépendance **obligatoire** par un moteur
d'embedding **embarqué en Python** (provider `builtin`, backend **FastEmbed /
ONNX Runtime**, modèle multilingue verrouillé), tout en conservant Ollama comme
provider *legacy* via configuration explicite. Le projet reste 100 % Python
(Typer / Pydantic / ChromaDB) — la mention de Go dans certaines instructions
`.agents` est obsolète et ne s'applique pas.

Point critique : l'embedding doit être traité comme une **partie versionnée du
stockage**. Sans métadonnées d'index ni réindexation contrôlée, changer de modèle
introduirait des incohérences vectorielles silencieuses.

Ce document est à la fois la **spécification finale révisée** et le **plan
d'implémentation**. La spec d'origine fournie était solide ; les corrections
ci-dessous l'alignent sur le code réel.

---

## Corrections apportées à la spec d'origine (vérifiées dans le code)

| # | Spec d'origine | Réalité du code | Décision |
|---|----------------|-----------------|----------|
| 1 | `cortex memory reindex` / `cortex memory add` | CLI **plat** : `cortex create`, `cortex search`, `cortex init`, `cortex transfer-working` (pas de sous-groupe `memory`) | Commande = **`cortex reindex`** (registre plat dans `cli/app.py`) |
| 2 | `dimension` hardcodée à 384 dans la signature d'index | `MockEmbedder` de test = **768-dim** ; `Embedder.dimension` est une `@property` | La **signature d'index est dérivée du runtime** (provider + `embedder.dimension` + config chunking), jamais d'un 384 figé |
| 3 | « Si aucun index n'existe → créer les métadonnées au 1er embedding » | Les upgraders ont un store Chroma **peuplé** mais **pas** de `embedding-index.json` | **Bloquer + exiger reindex** si metadata absent ET store non vide (voir §10.4) |
| 4 | Tests builtin appellent le vrai modèle | Pas de réseau / lenteur en CI ; règle projet « tests via mocks par défaut » | **Mock `fastembed.TextEmbedding`** en unit tests ; vrai téléchargement réservé à un test d'intégration `@pytest.mark.integration` opt-in |
| 5 | `normalize` importé de `cortex.search.cosine` | ✅ existe, signature `normalize(list[float]) -> list[float]` | Réutiliser tel quel |
| 6 | `storage.update()` / `storage.list()` pour reindex | ✅ existent, plus `get_all_with_embeddings(level)` | Réutiliser ; pas de nouvelle méthode Storage |

---

## Spécification finale (révisée)

### 1. Provider `builtin` par défaut

```toml
[embeddings]
provider = "builtin"
model = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
dimension = 384
```

`builtin` = moteur d'embedding embarqué par Cortex (backend technique FastEmbed).
Modèle multilingue verrouillé (384-dim), adapté FR/EN. Ollama reste supporté
uniquement si configuré explicitement.

### 2. Protocole `Embedder` (inchangé)

`embed(text) -> list[float]`, `embed_batch(texts) -> list[list[float]]`,
`@property dimension -> int`. `BuiltinEmbedder` et `OllamaEmbedder` implémentent
tous deux ce protocole + `close()`.

### 3. `EmbeddingsConfig` cible (`src/cortex/config/settings.py`)

```python
class EmbeddingsConfig(BaseModel):
    provider: str = "builtin"                  # builtin | ollama
    model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    dimension: int = 384
    cache_dir: str = ""                         # vide => cache FastEmbed par défaut
    # Legacy / HTTP providers only
    endpoint: str = "http://localhost:11434"
    timeout: int = 30
    # Shared chunking
    chunk_size: int = 8000
    chunk_overlap: int = 200
    chunk_strategy: str = "average"             # average | first | max_pool
```

Ajouter un `@field_validator("provider")` (valeurs `builtin`/`ollama`, sinon
erreur claire listant les providers supportés). Conserver le validator
`chunk_strategy` existant.

### 4. `BuiltinEmbedder` (`src/cortex/embeddings/builtin.py`)

Reprend le squelette de la spec d'origine §8.1 avec ces ajustements :
- `dimension` détectée **lazy via probe** au 1er accès (comme `OllamaEmbedder`),
  puis **comparée à `config.dimension`** ; lève `RuntimeError` explicite si
  écart (évite l'erreur tardive côté Chroma — spec §8.2).
- LRU(128) thread-safe + lock (parité avec `OllamaEmbedder`).
- Normalisation L2 via `normalize()` de `cortex.search.cosine`.
- Réutilise la **même logique de chunking** (`chunk_size`/`overlap`/`strategy`) ;
  `embed_batch` route aussi les textes longs via le chemin chunking (parité avec
  `embed`, corrige l'incohérence du squelette d'origine).
- `close()` no-op.
- `TextEmbedding(model_name=..., cache_dir=... si défini)` ; gérer les erreurs de
  chargement modèle avec le message §20.1 (offline / cache_dir).

### 5. Factory (`src/cortex/embeddings/factory.py`)

```python
def create_embedder(config: EmbeddingsConfig) -> Embedder:
    if config.provider == "builtin": return BuiltinEmbedder(config)
    if config.provider == "ollama":  return OllamaEmbedder(config)
    raise ValueError(... "Supported providers:\n- builtin\n- ollama")
```

Remplacer les imports directs de `OllamaEmbedder` par `create_embedder` :
- `src/cortex/cli/_common.py` : `get_embedder() -> Embedder` retourne
  `create_embedder(settings.embeddings)`.
- `src/cortex/mcp/server.py` : `_embedder: Embedder | None` ;
  `_embedder = create_embedder(settings.embeddings)` dans `_get_svc()`.

### 6. Versionnement de l'index (`embedding-index.json`)

Fichier à `<storage.path>/embedding-index.json` (par défaut
`.agents/cortex/embedding-index.json`). Signature dérivée du **runtime** :

```json
{
  "schema_version": 1,
  "embedding_provider": "builtin",
  "embedding_runtime": "fastembed",
  "embedding_model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  "embedding_dimension": 384,
  "embedding_normalized": true,
  "chunk_size": 8000, "chunk_overlap": 200,
  "chunk_strategy": "average", "chunking_version": 1
}
```

Compatibilité = égalité exacte de tous les champs (hors `schema_version` qui gère
l'évolution du format). `embedding_runtime` = `fastembed` pour builtin, `ollama`
pour ollama. `embedding_dimension` provient de `embedder.dimension` (runtime),
**pas** d'une constante.

### 7. Comportement des checks de compatibilité (§10.4 révisé)

Au point d'entrée (construction du service côté CLI/MCP, exécuté **une fois**) :
- **Pas de fichier metadata + store vide** → écrire la signature courante
  (install neuve).
- **Pas de fichier metadata + store NON vide** → **bloquer** lecture/écriture
  vectorielle, afficher l'erreur de mismatch (provenance inconnue/legacy) et
  proposer `cortex reindex`. *(décision retenue)*
- **Metadata présent + compatible** → continuer.
- **Metadata présent + incompatible** → bloquer + message §20.2 + `cortex reindex`.

« Store non vide » = `sum(storage.stats().values()) > 0`.

### 8. Commande `cortex reindex`

```
cortex reindex [--yes] [--level working|episodic|semantic]
```
1. charge les mémoires (`storage.list()`, filtré par `--level` si fourni) ;
2. recalcule les embeddings via le provider courant (`embed_batch`, par lots) ;
3. `storage.update(memory)` avec le nouvel embedding ;
4. réécrit `embedding-index.json` (signature runtime courante) ;
5. résumé par niveau (cf. §11.2 de la spec d'origine).
Confirmation `[y/N]` si elle remplace un index existant incompatible ; `--yes`
bypass (CI/script).

### 9. Dépendances (`pyproject.toml`)

Ajouter `fastembed>=0.7` aux dépendances principales. Conserver `httpx`
(provider Ollama legacy). Aucune dépendance Torch / transformers /
sentence-transformers.

### 10. Stockage / cache

- ChromaStorage inchangé : embeddings toujours passés **explicitement** (jamais
  d'auto-embedding Chroma). `embedding-index.json` = fichier JSON séparé
  (Option A de la spec), pas de collection technique.
- `cache_dir` optionnel ; vide ⇒ cache FastEmbed par défaut. Documenté comme
  option avancée.

### 11. Compatibilité ascendante

- Config `provider = "ollama"` explicite ⇒ Ollama continue de fonctionner.
- Sans config explicite ⇒ `builtin`.
- Index Ollama existants ⇒ détectés incompatibles ⇒ reindex obligatoire.
- Breaking change modéré documenté (cible ~`0.2.0`).

---

## Fichiers à créer / modifier

**Nouveaux**
- `src/cortex/embeddings/builtin.py` — `BuiltinEmbedder`.
- `src/cortex/embeddings/factory.py` — `create_embedder`.
- `src/cortex/embeddings/index_metadata.py` — build/read/write/compare signature + formatage d'erreur.
- `src/cortex/cli/reindex.py` — commande `cortex reindex`.
- `docs/specs/embeddings-builtin-migration.md` — spec révisée versionnée (réponse utilisateur : « also as a repo doc »).
- Tests : `tests/test_embeddings_builtin.py`, `tests/test_embeddings_factory.py`, `tests/test_index_metadata.py`, + cas dans `tests/test_cli.py`.

**Modifiés**
- `src/cortex/config/settings.py` — `EmbeddingsConfig` (defaults builtin, `dimension`, `cache_dir`, validator `provider`).
- `src/cortex/cli/_common.py` — `get_embedder()` via factory ; brancher le check d'index dans `get_storage()`/service init.
- `src/cortex/mcp/server.py` — `_embedder: Embedder` via factory ; check d'index au 1er `_get_svc()`.
- `src/cortex/cli/app.py` — enregistrer `app.command("reindex")(reindex.reindex)`.
- `pyproject.toml` — `fastembed>=0.7`.
- Docs (blast radius Ollama, ~17 fichiers) : `README.md`, `docs/guides/configuration.md`, `docs/architecture/embeddings.md`, `docs/guides/troubleshooting.md`, `docs/contributing/development.md`, `docs/cli/reference.md`, `docs/cli/mcp.md`, `docs/INDEX.md`, `.agents/instructions/{configuration,embeddings,development,troubleshooting,cli-reference,mcp}.md`, `man/man1/cortex.1`, `src/cortex/cli/manpage/cortex.1`, `CONTRIBUTING.md`. Nouveau message d'install (§14.1) + section « Ollama legacy ».
- `CLAUDE.md` / `.agents` : ajouter une Golden Rule ou instruction (rule 14) sur le versionnement d'index + provider builtin par défaut.

---

## Étapes d'implémentation (ordre)

1. **Abstraction** — `factory.py` ; brancher `cli/_common.py` + `mcp/server.py` sur la factory ; vérifier que les tests existants (Ollama / MockEmbedder) passent toujours.
2. **BuiltinEmbedder** — `builtin.py` + tests unitaires (mock `TextEmbedding`) : `embed`, `embed_batch` (ordre préservé), cache, dimension, probe-mismatch, chunking `average`/`first`/`max_pool`.
3. **Defaults** — `EmbeddingsConfig` (provider builtin, model, dimension, cache_dir, validator provider).
4. **Index metadata** — `index_metadata.py` + tests (absent+vide, compatible, mismatch provider/model/dimension/chunking).
5. **Wiring des checks** — avant recherche/écriture, une fois à l'init du service ; comportement legacy de §7.
6. **Commande reindex** — `cli/reindex.py` + enregistrement + tests CLI.
7. **Docs + spec repo** — `docs/specs/...md`, retrait d'Ollama du chemin principal, section legacy, reindex, mise à jour `CLAUDE.md`.

---

## Vérification (end-to-end)

- **Pré-commit (rule 1)** : `uv run ruff format src/ tests/ && uv run ruff check src/ tests/ && uv run pytest tests/`.
- **Unitaire** : factory (3 cas), BuiltinEmbedder (mock TextEmbedding), index_metadata (matrice mismatch).
- **Intégration (mock embedder 768-dim)** : create→search sur les 3 couches ; vérifier qu'un metadata incompatible déclenche le mismatch ; `cortex reindex` réécrit embeddings + metadata.
- **CLI** : `cortex create` / `cortex search` / `cortex reindex` fonctionnent **sans Ollama** ; `--yes` bypass la confirmation ; erreur claire si modèle indisponible/offline.
- **MCP** : serveur démarre sans Ollama ; outils create/search OK ; singleton `_embedder` conservé entre appels.
- **Intégration réelle (opt-in)** : un test `@pytest.mark.integration` télécharge le vrai modèle FastEmbed et vérifie `dimension == 384`. Exclu du run CI par défaut.
- Confirmer qu'aucun test n'effectue de téléchargement réseau dans le run standard.

## Risques / arbitrages
- Installation Python plus lourde (ONNX Runtime) — acceptable vs dépendance système.
- 1er lancement plus lent (download modèle) — documenté.
- Scores de recherche différents après reindex — inhérent au changement de modèle, assumé.
- Portabilité ONNX Runtime (Linux/macOS/Windows) — à valider.
