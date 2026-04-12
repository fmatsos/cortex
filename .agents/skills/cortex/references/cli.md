# Cortex CLI Reference

Requires `cortex` binary in PATH. For session workflows see `workflows.md`.

---

## Search

```bash
cortex search "JWT refresh token expiry"                      # all layers
cortex search "auth pattern" --level semantic                 # conventions only
cortex search "MCP timeout" --level episodic --top 10         # past bugs, more results
cortex search "topic" --min-score 0.65 --json                 # high precision, JSON output
```

**Flags:** `--level working|episodic|semantic`, `--top` (default 5), `--min-score` (default 0.5), `--session <id>`, `--include-obsolete`, `--json`

---

## Create

```bash
# Episodic: specific event / fix
cortex create \
  --title "Fixed MCP server startup timeout" \
  --level episodic \
  --content "Root cause: blocking HTTP in constructor. Fix: lazy init with sync.Once." \
  --tags "mcp,performance" --source llm

# Semantic: always-true knowledge
cortex create \
  --title "Go sync.Once lazy initialization pattern" \
  --level semantic \
  --content "Use sync.Once to defer expensive init until first use. See embeddings/ollama.go." \
  --tags "go,patterns" --source llm

# Working: current session state (requires --session)
cortex create --title "Task in progress" --level working \
  --session "$(cortex session id)" --content "…" --source llm
```

**Required:** `--title`, `--content`, `--level` · **Working level:** add `--session <id>` · **Always set:** `--source llm`

---

## Consolidate (preferred — deduplicates automatically)

```bash
cortex consolidate --level episodic \
  --content "Symptoms: … Root cause: … Fix: …" --source llm

cortex consolidate --level semantic \
  --content "Pattern description, when to use, examples." --tags "patterns"

cortex consolidate --level episodic --content "…" --force   # skip duplicate check
```

**Required:** `--level`, `--content`

---

## List & Get

```bash
cortex list                              # all memories
cortex list --level semantic             # filter by layer
cortex list --level working --session "$(cortex session id)"
cortex list --json | jq 'length'         # count
cortex get <id>                          # retrieve by ID (prefix ok)
cortex get <id> --json
```

---

## Edit & Delete

```bash
cortex edit <id> --title "New title" --content "Updated…" --tags "new,tags"
cortex delete <id>                       # hard delete (prefer mark-obsolete via MCP)
```

---

## Session & Transfer

```bash
cortex session id                        # get deterministic session ID (from git branch)
cortex transfer-working                  # promote all working → episodic for current session
cortex transfer-working --session <id>   # explicit session
```

---

## Maintenance

```bash
cortex stats                    # memory counts by layer
cortex autoprune --dry-run      # preview cleanup
cortex autoprune                # remove duplicates, archive old episodic, merge semantic
```

---

## Export / Import

```bash
cortex export --level episodic --output ./backup/
cortex import ./backup/*.md --dry-run
cortex import ./backup/*.md --force
```
