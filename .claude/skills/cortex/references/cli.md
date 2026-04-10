# Cortex CLI Reference

Use these commands when you have the `cortex` binary available in the terminal
but no MCP tools. See the main SKILL.md for when and why to use each.

Ensure the binary is in PATH: `which cortex` or `~/.local/bin/cortex`.

---

## Search

```bash
# Basic semantic search
cortex search "JWT refresh token expiry handling"

# Filter by level
cortex search "authentication bug" --level episodic
cortex search "go patterns" --level semantic

# More results, higher precision
cortex search "MCP server timeout" --top 10 --min-score 0.65

# JSON output for programmatic use
cortex search "auth pattern" --json
```

**Flags:** `--level`, `--top` (default 5), `--min-score` (default 0.5), `--json`, `--include-obsolete`, `--session`

---

## Create

```bash
# Semantic memory (knowledge that stays true)
cortex create \
  --title "Go sync.Once lazy initialization pattern" \
  --level semantic \
  --content "Use sync.Once to defer expensive initialization (e.g. external service calls) until first use. Prevents blocking at startup. Store result and any init error in the struct. See internal/embeddings/ollama.go for example." \
  --tags "go,patterns,performance" \
  --source llm

# Episodic memory (a specific event/fix)
cortex create \
  --title "Fixed MCP server startup timeout" \
  --level episodic \
  --content "Root cause: OllamaEmbedder was making blocking HTTP call in constructor. Fix: made it lazy with sync.Once in ensureDimension(). Commit: 5ca5186." \
  --tags "mcp,performance,go" \
  --source llm

# Working memory (current session state)
cortex create \
  --title "Current task: refactoring auth module" \
  --level working \
  --session "session-abc123" \
  --content "Replacing JWT library, keeping same interface. Files: internal/auth/*.go" \
  --source llm
```

**Required flags:** `--title`, `--content`, `--level`
**For working level:** add `--session <id>`
**Always set:** `--source llm` when you (the agent) are creating the memory

---

## Consolidate (with deduplication)

Preferred over `create` when unsure if something already exists.
Automatically detects and merges duplicates.

```bash
cortex consolidate \
  --level semantic \
  --content "API endpoints follow RESTful conventions. Use nouns for resources, HTTP verbs for actions. Documented in docs/api/conventions.md." \
  --tags "api,conventions,architecture"

# Force creation even if similar memory exists
cortex consolidate --level episodic --content "..." --force
```

**Required flags:** `--level`, `--content`

---

## List & Get

```bash
# List all memories
cortex list

# Filter by level
cortex list --level semantic
cortex list --level episodic

# Get a specific memory by ID
cortex get abc123-def456

# JSON output
cortex list --json
cortex get abc123 --json
```

---

## Lifecycle Management

```bash
# Promote episodic → semantic (when a pattern becomes general knowledge)
# (No direct CLI promote command — use MCP or create+delete)

# Mark as obsolete (soft delete, preserves history)
cortex delete abc123-def456

# Delete all obsolete memories
cortex delete --obsolete --force

# Transfer all working memories to episodic (end of session)
cortex transfer-working
```

---

## Maintenance

```bash
# Database stats
cortex stats

# Autoprune: remove old episodic, clean duplicates
cortex autoprune --dry-run   # preview first
cortex autoprune             # actually run
```

---

## Typical Workflows

### New task (2 commands)
```bash
cortex search "topic of your task" --level semantic
cortex search "topic of your task" --level episodic
# Read results before starting work
```

### Store a lesson after fixing a bug
```bash
cortex create \
  --title "Brief description of the bug and fix" \
  --level episodic \
  --content "Symptoms: ... Root cause: ... Fix: ... Files affected: ..." \
  --tags "bug,<relevant-area>" \
  --source llm
```

### Store a convention or pattern you discovered
```bash
cortex consolidate \
  --level semantic \
  --content "Describe the pattern, when to use it, why it matters, examples." \
  --tags "<domain>,patterns"
```

### End of session
```bash
# Transfer any working memory to episodic
cortex transfer-working

# Then review what's worth keeping as semantic
cortex list --level episodic | head -20
# Manually promote the important ones by creating semantic memories
```

### Check what you know about a topic
```bash
cortex search "topic" --level semantic --top 10
```

---

## Output as JSON

All commands support `--json` for structured output:
```bash
cortex search "auth" --json | jq '.[].title'
cortex list --level semantic --json | jq 'length'
```

---

## Configuration

Default config: `~/.config/cortex-ai/config.yaml`
Default storage: `~/.local/share/cortex-ai/`
Embeddings: Ollama at `http://localhost:11434` with `nomic-embed-text`

```bash
# Check config
cortex config show

# Override storage path
cortex --storage gob search "..."
```
