# Cortex - Configuration Reference

This document provides a complete reference for configuring Cortex.

## Table of Contents

- [Configuration File](#configuration-file)
- [Configuration Options](#configuration-options)
- [Environment Variables](#environment-variables)
- [CLI Flags](#cli-flags)
- [Priority Order](#priority-order)
- [Examples](#examples)

---

## Configuration File

The default configuration file location is:

```
~/.config/cortex-ai/config.yaml
```

### Default Configuration

```yaml
storage:
  backend: gob
  path: ~/.local/share/cortex-ai

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434
  timeout: 30s
  chunk_size: 8000
  chunk_overlap: 200
  chunk_strategy: average

search:
  top_k: 5
  min_score: 0.5
  include_obsolete: false

output:
  format: text
  colors: true

consolidation:
  similarity_threshold: 0.85
  prompt_template: default
  auto_transfer_on_session_end: true

autoprune:
  duplicates_threshold: 0.92
  episodic_retention_days: 90
  semantic_merge_threshold: 0.88

session:
  auto_derive: true
  pattern_type: prefix
  prefix: "session-"
  separator: "-"
  max_segments: 2
  fallback_to_uuid: true
```

---

## Configuration Options

### Storage Section

```mermaid
graph LR
    Storage["storage"]
    Storage --> Backend["backend"]
    Storage --> Path["path"]

    Backend --> Gob["gob (default)"]
    Backend --> SQLite["sqlite (planned)"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage.backend` | string | `gob` | Storage backend to use (`gob` or `sqlite`) |
| `storage.path` | string | `~/.local/share/cortex-ai` | Directory for storing memories |

### Embeddings Section

```mermaid
graph LR
    Embeddings["embeddings"]
    Embeddings --> Provider["provider"]
    Embeddings --> Model["model"]
    Embeddings --> Endpoint["endpoint"]
    Embeddings --> Timeout["timeout"]
    Embeddings --> ChunkSize["chunk_size"]
    Embeddings --> ChunkOverlap["chunk_overlap"]
    Embeddings --> ChunkStrategy["chunk_strategy"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embeddings.provider` | string | `ollama` | Embedding provider |
| `embeddings.model` | string | `nomic-embed-text` | Embedding model name |
| `embeddings.endpoint` | string | `http://localhost:11434` | API endpoint URL |
| `embeddings.timeout` | duration | `30s` | Request timeout |
| `embeddings.chunk_size` | integer | `8000` | Max characters per chunk (0 = no chunking) |
| `embeddings.chunk_overlap` | integer | `200` | Overlap between chunks for context preservation |
| `embeddings.chunk_strategy` | string | `average` | How to combine chunk embeddings: `average`, `first`, or `max_pool` |

#### Text Chunking

Text chunking automatically handles long content that exceeds embedding model context limits.

**When chunking activates:**
- Content length > `chunk_size` characters
- Automatically splits into overlapping chunks
- Embeds each chunk separately
- Combines using selected strategy

**Chunk Strategies:**

| Strategy | Description | Best For |
|----------|-------------|----------|
| `average` | Averages embeddings across all chunks (default) | General purpose, balanced representation |
| `first` | Uses only first chunk's embedding | Content with strong opening, performance |
| `max_pool` | Takes max value per dimension | Keyword-focused search, distinct features |

**Recommended values:**
- **chunk_size**: 8000 chars (~2000 tokens for nomic-embed-text)
- **chunk_overlap**: 200-400 chars to preserve context at boundaries
- **chunk_strategy**: `average` for most use cases

**Disable chunking:**
```yaml
embeddings:
  chunk_size: 0  # No chunking
```

**Note:** See [EMBEDDINGS.md](./EMBEDDINGS.md#text-chunking) for detailed chunking documentation.

#### Recommended Embedding Models

| Model | Dimensions | Speed | Quality | Notes |
|-------|------------|-------|---------|-------|
| `nomic-embed-text` | 768 | Fast | Good | Default, balanced |
| `mxbai-embed-large` | 1024 | Medium | Better | Higher quality |
| `all-minilm` | 384 | Very Fast | Fair | Lightweight |

### Search Section

```mermaid
graph LR
    Search["search"]
    Search --> TopK["top_k"]
    Search --> MinScore["min_score"]
    Search --> IncludeObs["include_obsolete"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `search.top_k` | integer | `5` | Maximum number of results |
| `search.min_score` | float | `0.5` | Minimum similarity score (0.0-1.0) |
| `search.include_obsolete` | boolean | `false` | Include obsolete memories in results |

### Output Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `output.format` | string | `text` | Output format (`text` or `json`) |
| `output.colors` | boolean | `true` | Enable colored output |

### Consolidation Section

Configuration for the multi-level memory consolidation system.

```mermaid
graph LR
    Consolidation["consolidation"]
    Consolidation --> SimilarityThreshold["similarity_threshold"]
    Consolidation --> PromptTemplate["prompt_template"]
    Consolidation --> AutoTransfer["auto_transfer_on_session_end"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `consolidation.similarity_threshold` | float | `0.85` | Similarity threshold for duplicate detection (0.0-1.0) |
| `consolidation.prompt_template` | string | `default` | Template name for LLM-assisted consolidation |
| `consolidation.auto_transfer_on_session_end` | boolean | `true` | Automatically transfer working memories to episodic on session end |

**Similarity Threshold Guide:**

| Value | Behavior |
|-------|----------|
| 0.95+ | Only merge nearly identical content |
| 0.85 (default) | Merge very similar content |
| 0.75 | Merge moderately similar content |
| < 0.7 | Not recommended (too aggressive) |

### Autoprune Section

Configuration for automatic memory cleanup and optimization.

```mermaid
graph LR
    Autoprune["autoprune"]
    Autoprune --> DuplicatesThreshold["duplicates_threshold"]
    Autoprune --> EpisodicRetention["episodic_retention_days"]
    Autoprune --> SemanticMerge["semantic_merge_threshold"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoprune.duplicates_threshold` | float | `0.92` | Similarity threshold for duplicate detection |
| `autoprune.episodic_retention_days` | integer | `90` | Days to retain episodic memories before archiving |
| `autoprune.semantic_merge_threshold` | float | `0.88` | Similarity threshold for merging semantic memories |

**Retention Strategy:**

```mermaid
graph TB
    subgraph "Memory Lifecycle"
        Working["Working Memory<br/>Session-scoped"]
        Episodic["Episodic Memory<br/>90 days default"]
        Semantic["Semantic Memory<br/>Permanent"]
    end

    Working -->|"Session End"| Episodic
    Episodic -->|"After retention"| Archive["Archive/Delete"]
    Episodic -->|"Abstraction"| Semantic
    Semantic -->|"Merge similar"| Semantic
```

### Session Section

Configuration for automatic session ID derivation from git branch names.

```mermaid
graph LR
    Session["session"]
    Session --> AutoDerive["auto_derive"]
    Session --> PatternType["pattern_type"]
    Session --> Pattern["pattern"]
    Session --> Prefix["prefix"]
    Session --> Separator["separator"]
    Session --> MaxSegments["max_segments"]
    Session --> StripPrefix["strip_prefix"]
    Session --> FallbackToUUID["fallback_to_uuid"]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `session.auto_derive` | boolean | `true` | Automatically derive session ID from git branch |
| `session.pattern_type` | string | `prefix` | Pattern type: `prefix`, `regex`, or `full` |
| `session.pattern` | string | `""` | Regex pattern (only used when pattern_type is `regex`) |
| `session.prefix` | string | `"session-"` | Prefix to add to derived session ID |
| `session.separator` | string | `"-"` | Separator to use when transforming branch name |
| `session.max_segments` | integer | `2` | Max number of branch segments to include (0 = all) |
| `session.strip_prefix` | string | `""` | Optional prefix to strip from branch name before processing |
| `session.fallback_to_uuid` | boolean | `true` | Fallback to UUID if pattern doesn't match |

**Pattern Types:**

1. **prefix** (default) - Extracts first N segments from branch name
   - Example: `fix/sil-123/implementation` → `session-fix-sil-123` (with max_segments=2)
   - Example: `feature/auth/jwt/impl` → `session-feature-auth` (with max_segments=2)

2. **regex** - Uses custom regex pattern with capture group
   - Example pattern: `^[^/]+/([\w-]+)` matches second segment
   - Branch `fix/sil-123/impl` → `session-sil-123`
   - Example pattern: `([A-Z]+-\d+)` extracts JIRA ticket
   - Branch `feature/JIRA-456/auth` → `session-JIRA-456`

3. **full** - Uses entire branch name
   - Example: `fix/sil-123/implementation` → `session-fix-sil-123-implementation`

**Common Configuration Examples:**

```yaml
# Default: First 2 segments with dash separator
session:
  auto_derive: true
  pattern_type: prefix
  max_segments: 2
  prefix: "session-"
  separator: "-"

# Extract JIRA ticket from branch
session:
  auto_derive: true
  pattern_type: regex
  pattern: '([A-Z]+-\d+)'
  prefix: "session-"

# Use full branch name
session:
  auto_derive: true
  pattern_type: full
  separator: "_"
  prefix: "session-"

# Disable auto-derivation
session:
  auto_derive: false
```

**Behavior:**

- When `--session` flag is provided, it takes precedence over auto-derivation
- When `--session` is not provided and `auto_derive: true`, session ID is derived from current git branch
- When `--session` is not provided and `auto_derive: false`, an error is returned (for working level) or UUID is used (for consolidate)
- If git command fails or pattern doesn't match and `fallback_to_uuid: true`, a UUID is generated

### Templates Section

The templates section allows customization of Markdown export templates.

```yaml
templates:
  markdown:
    memory:
      frontmatter:
        include_id: true
        include_dates: true
        include_metadata: true
        date_format: "2006-01-02T15:04:05Z07:00"
      body: "{{.Content}}"
    synthesis:
      header: "# {{.Intent | title}} - Synthesis\n\nThis document synthesizes {{len .Results}} memories."
      summary_section:
        title: "## Summary"
        content: "Based on the stored memories, the following information was found:"
      learnings_section:
        title: "## Key Learnings"
        item_template: "### From: {{.Title}} (score: {{printf \"%.2f\" .Score}})\n\n{{.Preview}}"
        content_preview_length: 500
      footer: "---\n\n*Generated by Cortex*"
```

#### Template Variables

**Memory templates:**
- `{{.Content}}` - Memory content
- `{{.Title}}` - Memory title
- `{{.Types}}` - Memory types array
- `{{.Tags}}` - Memory tags array
- `{{.CreatedAt}}` - Creation timestamp
- `{{.UpdatedAt}}` - Update timestamp

**Synthesis templates:**
- `{{.Intent}}` - Search query/intent
- `{{len .Results}}` - Number of results
- `{{.Title}}` - Memory title (in item template)
- `{{.Score}}` - Similarity score (in item template)
- `{{.Preview}}` - Content preview (in item template)

#### Template Functions

- `title` - Convert string to Title Case

#### JSON Schema

Export the JSON schema for reference:

```bash
cortex config schema markdown -o markdown-template.schema.json
```

#### Validation

Validate custom template files before use:

```bash
cortex config template validate my-template.yaml
```

---

## Environment Variables

All configuration options can be set via environment variables using the `CORTEX_` prefix:

```mermaid
graph TB
    subgraph "Environment Variables"
        E1["CORTEX_STORAGE_BACKEND"]
        E2["CORTEX_STORAGE_PATH"]
        E3["CORTEX_EMBEDDINGS_PROVIDER"]
        E4["CORTEX_EMBEDDINGS_MODEL"]
        E5["CORTEX_EMBEDDINGS_ENDPOINT"]
        E6["CORTEX_EMBEDDINGS_TIMEOUT"]
        E7["CORTEX_SEARCH_TOP_K"]
        E8["CORTEX_SEARCH_MIN_SCORE"]
        E9["CORTEX_OUTPUT_FORMAT"]
    end
```

| Environment Variable | Config Equivalent |
|---------------------|-------------------|
| `CORTEX_STORAGE_BACKEND` | `storage.backend` |
| `CORTEX_STORAGE_PATH` | `storage.path` |
| `CORTEX_EMBEDDINGS_PROVIDER` | `embeddings.provider` |
| `CORTEX_EMBEDDINGS_MODEL` | `embeddings.model` |
| `CORTEX_EMBEDDINGS_ENDPOINT` | `embeddings.endpoint` |
| `CORTEX_EMBEDDINGS_TIMEOUT` | `embeddings.timeout` |
| `CORTEX_EMBEDDINGS_CHUNK_SIZE` | `embeddings.chunk_size` |
| `CORTEX_EMBEDDINGS_CHUNK_OVERLAP` | `embeddings.chunk_overlap` |
| `CORTEX_EMBEDDINGS_CHUNK_STRATEGY` | `embeddings.chunk_strategy` |
| `CORTEX_SEARCH_TOP_K` | `search.top_k` |
| `CORTEX_SEARCH_MIN_SCORE` | `search.min_score` |
| `CORTEX_SEARCH_INCLUDE_OBSOLETE` | `search.include_obsolete` |
| `CORTEX_OUTPUT_FORMAT` | `output.format` |
| `CORTEX_OUTPUT_COLORS` | `output.colors` |
| `CORTEX_CONSOLIDATION_SIMILARITY_THRESHOLD` | `consolidation.similarity_threshold` |
| `CORTEX_CONSOLIDATION_PROMPT_TEMPLATE` | `consolidation.prompt_template` |
| `CORTEX_CONSOLIDATION_AUTO_TRANSFER` | `consolidation.auto_transfer_on_session_end` |
| `CORTEX_AUTOPRUNE_DUPLICATES_THRESHOLD` | `autoprune.duplicates_threshold` |
| `CORTEX_AUTOPRUNE_EPISODIC_RETENTION_DAYS` | `autoprune.episodic_retention_days` |
| `CORTEX_AUTOPRUNE_SEMANTIC_MERGE_THRESHOLD` | `autoprune.semantic_merge_threshold` |
| `CORTEX_SESSION_AUTO_DERIVE` | `session.auto_derive` |
| `CORTEX_SESSION_PATTERN_TYPE` | `session.pattern_type` |
| `CORTEX_SESSION_PATTERN` | `session.pattern` |
| `CORTEX_SESSION_PREFIX` | `session.prefix` |
| `CORTEX_SESSION_SEPARATOR` | `session.separator` |
| `CORTEX_SESSION_MAX_SEGMENTS` | `session.max_segments` |
| `CORTEX_SESSION_STRIP_PREFIX` | `session.strip_prefix` |
| `CORTEX_SESSION_FALLBACK_TO_UUID` | `session.fallback_to_uuid` |

### Example

```bash
# Set custom endpoint and model
export CORTEX_EMBEDDINGS_ENDPOINT=http://192.168.1.100:11434
export CORTEX_EMBEDDINGS_MODEL=mxbai-embed-large

# Run cortex with environment configuration
cortex search "authentication issues"
```

---

## CLI Flags

### Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--config` | `-c` | Path to config file |
| `--storage` | | Storage backend override |
| `--output` | `-o` | Output format (`text` or `json`) |

### Command-Specific Flags

#### `cortex create`

| Flag | Short | Required | Description |
|------|-------|----------|-------------|
| `--title` | `-t` | Yes | Memory title |
| `--type` | | Yes | Memory type(s), comma-separated |
| `--content` | `-c` | Yes | Memory content |
| `--tags` | | No | Tags, comma-separated |

#### `cortex search`

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--top` | `-n` | 5 | Maximum results |
| `--min-score` | | 0.5 | Minimum similarity score |
| `--type` | | | Filter by memory type |

#### `cortex list`

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--type` | | | Filter by memory type |
| `--include-obsolete` | | false | Include obsolete memories |

#### `cortex export`

| Flag | Short | Description |
|------|-------|-------------|
| `--output` | `-o` | Output directory or file |
| `--all` | | Export all memories |
| `--intent` | | Export synthesis by intent |

#### `cortex import`

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Overwrite existing memories |
| `--dry-run` | | Validate without importing |

---

## Priority Order

Configuration values are resolved in the following order (highest priority first):

```mermaid
graph TB
    A["1. CLI Flags<br/>(highest priority)"] --> B["2. Environment Variables"]
    B --> C["3. Config File"]
    C --> D["4. Built-in Defaults<br/>(lowest priority)"]
```

### Example Resolution

```bash
# Config file has: embeddings.model: nomic-embed-text
# Environment has: CORTEX_EMBEDDINGS_MODEL=mxbai-embed-large
# CLI has: (none)

# Result: mxbai-embed-large (from environment)
cortex create --title "Test" --type solution --content "..."

# But if CLI flag is used:
# Result: all-minilm (from CLI flag)
cortex create --title "Test" --type solution --content "..." --model all-minilm
```

---

## Examples

### Minimal Configuration

```yaml
# Only override what you need
embeddings:
  model: mxbai-embed-large
```

### Development Configuration

```yaml
storage:
  backend: gob
  path: ./data/cortex-dev

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434
  timeout: 60s
  chunk_size: 8000
  chunk_overlap: 200
  chunk_strategy: average

search:
  top_k: 10
  min_score: 0.3
  include_obsolete: true

output:
  format: json
  colors: false
```

### Production Configuration

```yaml
storage:
  backend: gob
  path: /var/lib/cortex-ai

embeddings:
  provider: ollama
  model: mxbai-embed-large
  endpoint: http://ollama-server:11434
  timeout: 30s
  chunk_size: 8000
  chunk_overlap: 200
  chunk_strategy: average

search:
  top_k: 5
  min_score: 0.6
  include_obsolete: false

output:
  format: text
  colors: true
```

### Docker Configuration

```yaml
storage:
  backend: gob
  path: /data

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://host.docker.internal:11434
  timeout: 30s
  chunk_size: 8000
  chunk_overlap: 200
  chunk_strategy: average
```

---

## Managing Configuration

### View Current Configuration

```bash
cortex config --show
```

### Edit Configuration

```bash
cortex config --edit
```

This opens the config file in your default editor (`$EDITOR` or `vim`).

### Reset to Defaults

```bash
rm ~/.config/cortex-ai/config.yaml
cortex config --show  # Will use defaults
```

---

## Related Documentation

- [README.md](../README.md) - Getting started guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [MCP.md](./MCP.md) - MCP integration
