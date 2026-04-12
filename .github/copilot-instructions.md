# Copilot Instructions — Cortex

## What Is This Repository?

Cortex is a **semantic memory system** for AI coding assistants.  
It stores, organizes, and retrieves developer knowledge using vector embeddings and cosine-similarity search, organized into three lifecycle layers: **working → episodic → semantic**.

- **Module:** `github.com/cortex-ai/cortex-ai`
- **Language:** Go 1.24+
- **Key libraries:** Cobra (CLI), Viper (config), Ollama (embeddings), mark3labs/mcp-go (MCP server)
- **Entry point:** `cmd/cortex/main.go` → `internal/cli/root.go`

---

## Repository Layout

```
cmd/cortex/          Entry point (main.go)
internal/
  cli/               Cobra commands (one file per command)
  config/            Viper-based config (config.go)
  consolidation/     Deduplication & merge logic
  embeddings/        Ollama HTTP client (OllamaEmbedder)
  chunking/          Long-text chunking before embedding
  memory/            Domain model (types.go) + Service
  mcp/               MCP server (JSON-RPC 2.0 over stdio/SSE)
  schemas/           Embedded JSON schemas for MCP tools
  search/            Cosine similarity
  storage/           Persistence (GobStorage, LanceDB)
  templates/         Markdown export templates
  tui/               Bubbletea TUI helpers
pkg/                 Exported helpers (markdown, json)
docs/                Architecture & API documentation
.agents/instructions/ Detailed per-area instruction files (symlinked into .github/instructions/)
AGENTS.md            Golden Rules — read this first for every task
```

---

## Golden Rules (Non-Negotiable)

These rules are enforced by the linter and CI. Violations will break the build.

### 1. Build sequence — always run in this order before committing
```bash
make fmt && make lint && make test && make build
```
Never skip a failing step. Fix it, then restart from `make fmt`.

### 2. golangci-lint version
CI pins **golangci-lint v2.10.1** via `golangci-lint-action@v8`.  
`.golangci.yml` must start with `version: "2"`.  
Install locally: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.10.1`

### 3. CLI output — never use `fmt.Print*` in CLI commands
```go
// ✅ Correct
_, _ = fmt.Fprint(cmd.OutOrStdout(), "message\n")
_, _ = fmt.Fprintf(cmd.OutOrStdout(), "value: %s\n", v)

// ❌ Wrong — fails errcheck linter
fmt.Println("message")
fmt.Printf("value: %s\n", v)
```
- **Errors** go to **stderr** (`cmd.ErrOrStderr()` or `os.Stderr`)
- **Data/output** goes to **stdout** (`cmd.OutOrStdout()`)
- Library packages **return errors** — never print from non-CLI code

### 4. Interface discipline
Use the canonical interfaces:
- `storage.Storage` — defined in `internal/storage/storage.go`
- `embeddings.Embedder` — defined in `internal/embeddings/`
- **Exception:** `memory/service.go` declares its own local `Storage` and `Embedder` interfaces to break a circular import. This is the only accepted duplication.

### 5. Batch embeddings
Use `EmbedBatch(ctx, texts)` instead of looping over `Embed(ctx, text)` when embedding multiple items.

### 6. MCP tool names are stable
Renaming an MCP tool breaks all client integrations. Do not rename.

### 7. Test mocks must implement the full interface
When writing a mock for any interface, implement **all** methods, even those not used in the test. Missing stubs cause compile errors when the interface gains new methods.

### 8. Minimal changes
Do not refactor unrelated code. Only change what is necessary to fulfil the task.

---

## Build & Development Commands

```bash
make build       # Compiles ./bin/cortex
make install     # Installs to $GOBIN
make test        # go test -v -cover ./...
make test-race   # go test -v -race ./...
make lint        # golangci-lint run ./...
make fmt         # go fmt ./...
make deps        # go mod download && go mod tidy
make clean       # Removes ./bin/
make qa          # fmt → lint → test → build (full pre-commit workflow)
```

Run a single package test:
```bash
go test ./internal/memory/... -run TestCreate -v -count=1
go test ./internal/storage/... -run "TestGobStorage" -v
```

---

## Architecture — Three-Layer Memory

```
Working  →  Episodic  →  Semantic
(session)   (90 days)    (permanent)
```

| Layer | File | Retention | Session ID required |
|-------|------|-----------|---------------------|
| `working` | `working/<session>.gob` | Until transferred | Yes |
| `episodic` | `memories.gob` | 90 days (autoprune) | No |
| `semantic` | `memories.gob` | Forever | No |

Working memories are stored in separate per-session Gob files. Episodic + semantic share `memories.gob`.

---

## Storage Backends

Configured via `storage.backend` (env: `CORTEX_STORAGE_BACKEND`):

| Backend | Build tag | Description |
|---------|-----------|-------------|
| `gob` (default) | none | Pure-Go, single-file Gob serialisation |
| `lancedb` | `-tags lancedb` | Arrow/LanceDB vector store (requires CGO + native libs) |

Factory: `internal/storage/factory.go → storage.New(cfg)`

---

## Configuration

Config file: `.agents/cortex/config.toml` (project-local).  
Full hierarchy: **CLI flags > env vars > config file > built-in defaults**.

Key env vars:
```
CORTEX_STORAGE_PATH              default: .agents/cortex
CORTEX_EMBEDDINGS_ENDPOINT       default: http://localhost:11434
CORTEX_EMBEDDINGS_MODEL          default: nomic-embed-text
CORTEX_EMBEDDINGS_TIMEOUT        default: 30s
CORTEX_SEARCH_TOP_K              default: 5
CORTEX_SEARCH_MIN_SCORE          default: 0.5
CORTEX_CONSOLIDATION_SIMILARITY_THRESHOLD  default: 0.85
CORTEX_AUTOPRUNE_EPISODIC_RETENTION_DAYS   default: 90
CORTEX_SESSION_AUTO_DERIVE       default: true
```

Session IDs are auto-derived from the current git branch (configurable pattern). Override with `--session`.

---

## Adding a CLI Command

1. Create `internal/cli/<name>.go` with a `var <Name>Cmd = &cobra.Command{...}`
2. Use `_, _ = fmt.Fprint(cmd.OutOrStdout(), ...)` for all output
3. Register in the appropriate `init()` via `rootCmd.AddCommand(<Name>Cmd)`
4. Add tests in `internal/cli/cli_test.go`

## Adding an MCP Tool

1. Define the schema in `internal/schemas/mcp/`
2. Register the tool name in `internal/schemas/embed.go` (`MCPToolNames`)
3. Add handler in `internal/mcp/server.go` and dispatch case in `handleCallTool()`
4. Do **not** rename existing tools

---

## CI Pipeline

File: `.github/workflows/ci.yml`

Steps (in order):
1. `make deps`
2. `go fmt ./...` (fails if uncommitted formatting changes)
3. `golangci-lint-action@v8` with `version: v2.10.1`
4. `make test`
5. `make test-race`
6. `make build`

Active linters (`.golangci.yml`): `errcheck`, `govet`, `ineffassign`, `unused`, `staticcheck`, `gocritic`

---

## Detailed Documentation

Instruction files in `.github/instructions/` (symlinked from `.agents/instructions/`) cover:

| File | When to read |
|------|-------------|
| `conventions.instructions.md` | General Go code style |
| `cli-reference.instructions.md` | Every CLI command with flags |
| `mcp.instructions.md` | MCP tools, protocol, client config |
| `storage.instructions.md` | GobStorage internals, thread-safety |
| `memory-model.instructions.md` | Three-layer model, lifecycle, best practices |
| `embeddings.instructions.md` | Ollama client, chunking, normalization |
| `configuration.instructions.md` | Full config reference |
| `workflow.instructions.md` | Task workflow, pre-commit checklist |
| `knowledge-capture.instructions.md` | When/how to update AGENTS.md |

**Always read `AGENTS.md`** for the full Golden Rules list before making changes.

---

## Semantic Code Search (grepai)

This repository has `grepai` for semantic code search:

```bash
# Find code by intent (preferred over grep for understanding)
grepai search "how memories are persisted" --json --compact
grepai search "embedding generation" --json --compact

# Trace call graphs before modifying a function
grepai trace callers "Save" --json
grepai trace callees "NewOllamaEmbedder" --json
```

Fall back to `grep`/`glob` only for exact text/pattern matching.

---

## Common Errors & Workarounds

| Error | Cause | Fix |
|-------|-------|-----|
| `errcheck: Error return value of ... is not checked` | `fmt.Print*` without `_, _ =` | Use `_, _ = fmt.Fprint(cmd.OutOrStdout(), ...)` |
| `golangci-lint: configuration file version is not set` | Missing `version: "2"` in `.golangci.yml` | Add `version: "2"` as first line |
| `undefined: newLanceDBStorageOrError` | lancedb build tag missing | Add `-tags lancedb` or use `gob` backend |
| Mock compile error after interface change | Mock missing new method | Implement all interface methods in mock |
| `go fmt` CI failure | Uncommitted formatting changes | Run `go fmt ./...` before committing |
