---
applyTo: "internal/config/**,**/*.toml"
paths:
  - "internal/config/**"
  - "**/*.toml"
---

# Cortex - Configuration Reference

This document provides a complete reference for configuring Cortex.

## Table of Contents

- [Configuration File](#configuration-file)
- [Configuration Options](#configuration-options)
- [Environment Variables](#environment-variables)
- [Priority Order](#priority-order)
- [Examples](#examples)

---

## Configuration File

The default configuration file location is:

```
.agents/cortex/config.toml
```

> Configuration is **project-local** by default. The `.agents/cortex/` directory is created in the current working directory when Cortex first runs. Override the location with the `CORTEX_CONFIG` environment variable.

### Creating the Config File

Use the `init` command to scaffold a default config file:

```bash
# Global config (~/.config/cortex/config.toml)
cortex init

# Project-local config (.agents/cortex/config.toml)
cortex init --local
```

### Default Configuration

```toml
[storage]
backend = "chroma"
path = ".agents/cortex"

[embeddings]
provider = "ollama"
model = "nomic-embed-text"
endpoint = "http://localhost:11434"
timeout = 30
chunk_size = 8000
chunk_overlap = 200
chunk_strategy = "average"

[search]
top_k = 5
min_score = 0.5
include_obsolete = false

[output]
format = "text"
colors = true

[logging]
level = "info"
file = ""

[consolidation]
similarity_threshold = 0.85
auto_transfer_on_session_end = true

[autoprune]
duplicates_threshold = 0.92
episodic_retention_days = 90
semantic_merge_threshold = 0.88

[session]
auto_derive = true
pattern_type = "prefix"
prefix = "session-"
separator = "-"
max_segments = 2
fallback_to_uuid = true

[mcp]
transport = "stdio"
address = ":8080"
```

---

## Configuration Options

### Storage Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage.backend` | string | `chroma` | Storage backend (`chroma` is the only supported backend) |
| `storage.path` | string | `.agents/cortex` | Directory for storing memories |

### Embeddings Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embeddings.provider` | string | `ollama` | Embedding provider |
| `embeddings.model` | string | `nomic-embed-text` | Embedding model name |
| `embeddings.endpoint` | string | `http://localhost:11434` | API endpoint URL |
| `embeddings.timeout` | integer | `30` | Request timeout in seconds |
| `embeddings.chunk_size` | integer | `8000` | Max characters per chunk (0 = no chunking) |
| `embeddings.chunk_overlap` | integer | `200` | Overlap between chunks for context preservation |
| `embeddings.chunk_strategy` | string | `average` | How to combine chunk embeddings: `average`, `first`, or `max_pool` |

#### Text Chunking

Text chunking automatically handles long content that exceeds embedding model context limits.

**Chunk Strategies:**

| Strategy | Description | Best For |
|----------|-------------|----------|
| `average` | Averages embeddings across all chunks (default) | General purpose, balanced representation |
| `first` | Uses only first chunk's embedding | Content with strong opening, performance |
| `max_pool` | Takes max value per dimension | Keyword-focused search, distinct features |

**Disable chunking:**
```toml
[embeddings]
chunk_size = 0  # no chunking
```

#### Recommended Embedding Models

| Model | Dimensions | Speed | Quality | Notes |
|-------|------------|-------|---------|-------|
| `nomic-embed-text` | 768 | Fast | Good | Default, balanced |
| `mxbai-embed-large` | 1024 | Medium | Better | Higher quality |
| `all-minilm` | 384 | Very Fast | Fair | Lightweight |

### Search Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `search.top_k` | integer | `5` | Maximum number of results |
| `search.min_score` | float | `0.5` | Minimum similarity score (0.0–1.0) |
| `search.include_obsolete` | boolean | `false` | Include obsolete memories in results |

### Output Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `output.format` | string | `text` | Output format (`text` or `json`) |
| `output.colors` | boolean | `true` | Enable colored output |

### Logging Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logging.level` | string | `info` | Log level: `debug`, `info`, `warning`, `error`, `critical` |
| `logging.file` | string | `""` | Log file path (empty = stderr only) |

### Consolidation Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `consolidation.similarity_threshold` | float | `0.85` | Similarity threshold for duplicate detection (0.0–1.0) |
| `consolidation.auto_transfer_on_session_end` | boolean | `true` | Automatically transfer working memories to episodic on session end |

**Similarity Threshold Guide:**

| Value | Behavior |
|-------|----------|
| 0.95+ | Only merge nearly identical content |
| 0.85 (default) | Merge very similar content |
| 0.75 | Merge moderately similar content |
| < 0.7 | Not recommended (too aggressive) |

### Autoprune Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoprune.duplicates_threshold` | float | `0.92` | Similarity threshold for duplicate detection |
| `autoprune.episodic_retention_days` | integer | `90` | Days to retain episodic memories before archiving |
| `autoprune.semantic_merge_threshold` | float | `0.88` | Similarity threshold for merging semantic memories |

### Session Section

Configuration for automatic session ID derivation from git branch names.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `session.auto_derive` | boolean | `true` | Automatically derive session ID from git branch |
| `session.pattern_type` | string | `prefix` | Pattern type: `prefix`, `regex`, or `full` |
| `session.pattern` | string | `""` | Regex pattern (only used when `pattern_type = "regex"`) |
| `session.prefix` | string | `"session-"` | Prefix to add to derived session ID |
| `session.separator` | string | `"-"` | Separator when transforming branch name |
| `session.max_segments` | integer | `2` | Max number of branch segments to include (0 = all) |
| `session.strip_prefix` | string | `""` | Optional prefix to strip from branch name before processing |
| `session.fallback_to_uuid` | boolean | `true` | Fallback to UUID if pattern doesn't match |

**Pattern Types:**

1. **prefix** (default) — Extracts first N segments from branch name
   - `fix/sil-123/implementation` → `session-fix-sil-123` (max_segments = 2)

2. **regex** — Uses custom regex pattern with a capture group
   - Pattern `([A-Z]+-\d+)` on branch `feature/JIRA-456/auth` → `session-JIRA-456`

3. **full** — Uses entire branch name
   - `fix/sil-123/implementation` → `session-fix-sil-123-implementation`

**Common Configuration Examples:**

```toml
# Default: first 2 segments with dash separator
[session]
auto_derive = true
pattern_type = "prefix"
max_segments = 2
prefix = "session-"
separator = "-"

# Extract JIRA ticket from branch
[session]
auto_derive = true
pattern_type = "regex"
pattern = '([A-Z]+-\d+)'
prefix = "session-"

# Use full branch name
[session]
auto_derive = true
pattern_type = "full"
separator = "_"
prefix = "session-"

# Disable auto-derivation
[session]
auto_derive = false
```

### MCP Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mcp.transport` | string | `stdio` | Transport type (`stdio` or `sse`) |
| `mcp.address` | string | `:8080` | Address for SSE transport |

---

## Environment Variables

All configuration options can be set via environment variables using the `CORTEX_` prefix and `__` as the nested delimiter.

| Environment Variable | Config Equivalent |
|---------------------|-------------------|
| `CORTEX_STORAGE__BACKEND` | `storage.backend` |
| `CORTEX_STORAGE__PATH` | `storage.path` |
| `CORTEX_EMBEDDINGS__PROVIDER` | `embeddings.provider` |
| `CORTEX_EMBEDDINGS__MODEL` | `embeddings.model` |
| `CORTEX_EMBEDDINGS__ENDPOINT` | `embeddings.endpoint` |
| `CORTEX_EMBEDDINGS__TIMEOUT` | `embeddings.timeout` |
| `CORTEX_EMBEDDINGS__CHUNK_SIZE` | `embeddings.chunk_size` |
| `CORTEX_EMBEDDINGS__CHUNK_OVERLAP` | `embeddings.chunk_overlap` |
| `CORTEX_EMBEDDINGS__CHUNK_STRATEGY` | `embeddings.chunk_strategy` |
| `CORTEX_SEARCH__TOP_K` | `search.top_k` |
| `CORTEX_SEARCH__MIN_SCORE` | `search.min_score` |
| `CORTEX_SEARCH__INCLUDE_OBSOLETE` | `search.include_obsolete` |
| `CORTEX_OUTPUT__FORMAT` | `output.format` |
| `CORTEX_OUTPUT__COLORS` | `output.colors` |
| `CORTEX_LOGGING__LEVEL` | `logging.level` |
| `CORTEX_LOGGING__FILE` | `logging.file` |
| `CORTEX_CONSOLIDATION__SIMILARITY_THRESHOLD` | `consolidation.similarity_threshold` |
| `CORTEX_CONSOLIDATION__AUTO_TRANSFER_ON_SESSION_END` | `consolidation.auto_transfer_on_session_end` |
| `CORTEX_AUTOPRUNE__DUPLICATES_THRESHOLD` | `autoprune.duplicates_threshold` |
| `CORTEX_AUTOPRUNE__EPISODIC_RETENTION_DAYS` | `autoprune.episodic_retention_days` |
| `CORTEX_AUTOPRUNE__SEMANTIC_MERGE_THRESHOLD` | `autoprune.semantic_merge_threshold` |
| `CORTEX_SESSION__AUTO_DERIVE` | `session.auto_derive` |
| `CORTEX_SESSION__PATTERN_TYPE` | `session.pattern_type` |
| `CORTEX_SESSION__PATTERN` | `session.pattern` |
| `CORTEX_SESSION__PREFIX` | `session.prefix` |
| `CORTEX_SESSION__SEPARATOR` | `session.separator` |
| `CORTEX_SESSION__MAX_SEGMENTS` | `session.max_segments` |
| `CORTEX_SESSION__STRIP_PREFIX` | `session.strip_prefix` |
| `CORTEX_SESSION__FALLBACK_TO_UUID` | `session.fallback_to_uuid` |

**Example:**

```bash
export CORTEX_EMBEDDINGS__MODEL=mxbai-embed-large
export CORTEX_EMBEDDINGS__ENDPOINT=http://192.168.1.100:11434
export CORTEX_SEARCH__TOP_K=10
cortex search "authentication issues"
```

> **Note:** The `CORTEX_CONFIG` environment variable overrides the config file path entirely:
> ```bash
> CORTEX_CONFIG=/path/to/my-config.toml cortex search "query"
> ```

---

## Priority Order

Configuration values are resolved in the following order (highest priority first):

1. **CLI flags** — override everything
2. **`CORTEX_*` environment variables** — override config file
3. **Config file** (`.agents/cortex/config.toml` or `~/.config/cortex/config.toml`) — override defaults
4. **Built-in defaults** — used when nothing else is set

---

## Examples

### Minimal Configuration

```toml
# Only override what you need
[embeddings]
model = "mxbai-embed-large"
```

### Development Configuration

```toml
[storage]
path = "./data/cortex-dev"

[embeddings]
model = "nomic-embed-text"
endpoint = "http://localhost:11434"
timeout = 60
chunk_size = 8000
chunk_overlap = 200
chunk_strategy = "average"

[search]
top_k = 10
min_score = 0.3
include_obsolete = true

[output]
format = "json"
colors = false
```

### Production Configuration

```toml
[storage]
path = "/var/lib/cortex"

[embeddings]
model = "mxbai-embed-large"
endpoint = "http://ollama-server:11434"
timeout = 30

[search]
top_k = 5
min_score = 0.6

[output]
format = "text"
colors = true
```

### Docker / Remote Ollama

```toml
[storage]
path = "/data"

[embeddings]
endpoint = "http://host.docker.internal:11434"
model = "nomic-embed-text"
```

---

## Related Documentation

- [Architecture](../architecture/overview.md) - System architecture
- [Development Guide](development.md) - Setup and contributing
- [Troubleshooting](troubleshooting.md) - Common issues and solutions
