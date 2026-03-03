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
4. **golangci-lint: use v2** (CI pins v2.10.1; install: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.10.1`)
5. **Return errors; never print from library packages.**
6. **Stderr for errors, stdout for data.**
7. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.
8. **CLI output via `cmd.OutOrStdout()`** — never use `fmt.Print*` in CLI commands; use `_, _ = fmt.Fprint*(cmd.OutOrStdout(), ...)`. The `errcheck` linter enforces this.
9. **No interface duplication** — use canonical interfaces (`memory.Embedder`, `storage.Storage`). The only accepted exception: the local storage interface in `memory/service.go` (breaks circular import). All other duplicates must be removed.
10. **Test mocks must satisfy the full interface** — implement ALL methods of the interface being mocked, not just those exercised in the test. Missing methods cause compile errors when the interface evolves.
11. **Prefer `EmbedBatch` over repeated `Embed`** — for batch embedding operations, use `EmbedBatch` to avoid per-item round-trips to Ollama.

---

## Documentation Index

Read **only** what the current task requires. Each row lists the trigger condition — if it doesn't match your task, skip that doc.

| When to read | Doc | What you'll find | Skip unless |
|---|---|---|---|
| Running builds, writing tests, checking CI targets | [`docs/agent/workflow.md`](docs/agent/workflow.md) | `make` targets, env vars, test commands, benchmarks | You already know the make targets |
| Writing or reviewing Go code | [`docs/agent/conventions.md`](docs/agent/conventions.md) | Naming rules, error handling, concurrency, testing patterns, CLI patterns | Doing doc-only or infra-only work |
| Adding a CLI command, MCP tool, or memory level | [`docs/agent/tasks.md`](docs/agent/tasks.md) | Step-by-step recipes for each extension point | Modifying existing code only |
| Fixing CLI help text, flags, or missing commands | [`docs/cli/reference.md`](docs/cli/reference.md) | All commands, flags, examples | Not touching the CLI surface |
| Configuring or debugging MCP server / tool list | [`docs/cli/mcp.md`](docs/cli/mcp.md) | Tool names, transport modes (stdio/SSE), client setup | Not working on MCP |
| Understanding how memories flow between layers | [`docs/architecture/memory-model.md`](docs/architecture/memory-model.md) | Three-layer design, `Memory` struct fields, lifecycle, decision tree | Not modifying memory types or promotion logic |
| Debugging persistence or changing storage format | [`docs/architecture/storage.md`](docs/architecture/storage.md) | Gob file layout, serialisation, migration notes | Not touching the storage layer |
| Changing embedding model, chunk size, or strategy | [`docs/architecture/embeddings.md`](docs/architecture/embeddings.md) | Ollama config, chunking strategies, vector dimensions | Not working on embeddings |
| Getting a first system-wide picture | [`docs/architecture/overview.md`](docs/architecture/overview.md) | Component diagram, data flow, tech stack | Already familiar with the architecture |
| Changing config keys, defaults, or env vars | [`docs/guides/configuration.md`](docs/guides/configuration.md) | All YAML/env keys with types and defaults | Not touching config |
| Diagnosing a runtime error or startup failure | [`docs/guides/troubleshooting.md`](docs/guides/troubleshooting.md) | Common errors, debug steps, log locations | No runtime issues |
| Setting up or contributing to the dev environment | [`docs/contributing/development.md`](docs/contributing/development.md) | Dev setup, PR process, contribution guidelines | Already set up |

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

