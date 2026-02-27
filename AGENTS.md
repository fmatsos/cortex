# Cortex – Agent Notes

**Module:** `github.com/cortex-ai/cortex-ai` · **Go 1.24+** · **Cobra / Viper / Ollama / Gob**

Three-layer memory system: `working` (session) → `episodic` (historical) → `semantic` (permanent).

---

## Golden Rules

1. **fmt → lint → test → build** before every commit — no exceptions.
   ```
   make fmt && make lint && make test && make build
   ```
2. **Never skip a failing step.** Fix it, restart from step 1.
3. **Keep MCP tool names stable** — renaming breaks integrations.
4. **golangci-lint: use latest v1** (1.64.x or later; install: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`)
5. **Return errors; never print from library packages.**
6. **Stderr for errors, stdout for data.**
7. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.

---

## Documentation Index

Read only what the current task requires.

| Context | Read |
|---------|------|
| Build, test, lint, env vars | [`docs/agent/workflow.md`](docs/agent/workflow.md) |
| Code style, naming, error handling | [`docs/agent/conventions.md`](docs/agent/conventions.md) |
| Adding commands / MCP tools / memory levels | [`docs/agent/tasks.md`](docs/agent/tasks.md) |
| CLI commands reference | [`docs/cli/reference.md`](docs/cli/reference.md) |
| MCP integration & tool list | [`docs/cli/mcp.md`](docs/cli/mcp.md) |
| Memory model & three-layer design | [`docs/architecture/memory-model.md`](docs/architecture/memory-model.md) |
| Storage internals (Gob) | [`docs/architecture/storage.md`](docs/architecture/storage.md) |
| Embeddings & Ollama | [`docs/architecture/embeddings.md`](docs/architecture/embeddings.md) |
| System architecture | [`docs/architecture/overview.md`](docs/architecture/overview.md) |
| Configuration reference | [`docs/guides/configuration.md`](docs/guides/configuration.md) |
| Troubleshooting | [`docs/guides/troubleshooting.md`](docs/guides/troubleshooting.md) |
| Contributing & dev setup | [`docs/contributing/development.md`](docs/contributing/development.md) |

Full docs index: [`docs/INDEX.md`](docs/INDEX.md)


## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

### Workflow

1. Start with `grepai search` to find relevant code
2. Use `grepai trace` to understand function relationships
3. Use `Read` tool to examine files from results
4. Only use Grep for exact string searches if needed

