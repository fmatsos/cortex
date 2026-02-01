# Cortex - Agent Notes

This file is for agentic coding tools working in this repo. It summarizes how to build/test/lint and the local code style conventions.

## Project Snapshot

- Module: `github.com/cortex-ai/cortex-ai`
- Language: Go (Go 1.24+)
- CLI: Cobra
- Config: Viper
- Embeddings: Ollama (local)
- Storage: Gob files

Key locations

- `cmd/cortex/main.go` entry point
- `internal/cli/` Cobra commands
- `internal/memory/` domain model + service
- `internal/storage/` storage interface + Gob implementation
- `internal/embeddings/` embedder interface + Ollama client
- `internal/search/` cosine similarity
- `internal/config/` configuration
- `internal/mcp/` MCP server (JSON-RPC 2.0)
- `pkg/` helpers (markdown, json)

## Build / Lint / Test

From repo root:

```bash
make build          # ./bin/cortex
make install        # install to $GOBIN
make test           # all tests (verbose + coverage)
make test-race      # race detector
make lint           # golangci-lint run ./...
make fmt            # go fmt ./...
make deps           # go mod download + tidy
make clean          # remove build artifacts
```

Run a single package:

```bash
go test ./internal/memory/...
go test ./internal/storage/...
```

Run a single test (regex):

```bash
go test ./internal/memory -run TestCreate
go test ./internal/storage -run "TestGobStorage/.*"
```

Run a single test once (avoid cached results):

```bash
go test ./internal/memory -run TestCreate -count=1
```

Benchmarks:

```bash
go test ./internal/storage -bench=. -count=1
```

## Code Style Guidelines

General

- Follow Effective Go and standard library patterns.
- Keep functions small and focused; prefer clear control flow over cleverness.
- Keep exported APIs stable; add new helpers rather than changing call sites widely.
- Use context-aware operations where IO or long work happens.
- Avoid global state; prefer constructor-based dependency injection.

Formatting

- Use `gofmt` for all Go files; `make fmt` is available.
- Keep lines reasonably short when it improves readability; avoid dense one-liners.

Imports

- Use standard Go import grouping: stdlib, blank line, third-party.
- Avoid dot imports; avoid aliasing unless it resolves a conflict or improves clarity.
- Prefer explicit package names over renaming to short aliases.

Types and naming

- Use Go naming conventions: `camelCase` for locals, `PascalCase` for exported.
- Avoid stuttering in type names when package already provides context.
- Prefer concrete types in structs; use interfaces at boundaries.
- Use pointer receivers for methods that mutate state or to avoid large copies.
- Use `time.Time` consistently; capture `time.Now()` once when needed.

Error handling

- Return early on error; avoid deep nesting.
- Wrap errors with context using `fmt.Errorf("...: %w", err)`.
- Error strings should be lowercase, no trailing punctuation.
- Prefer typed errors or sentinel values only when callers need to branch on them.

Logging and output

- CLI commands should report user-facing errors at the command layer, not deep inside.
- Avoid printing from library packages; return errors instead.

Concurrency

- Use `sync.RWMutex` or `sync.Mutex` consistently for shared state.
- Keep critical sections minimal; lock ordering should be obvious.

Testing

- Tests are colocated with source files (`*_test.go`).
- Prefer table-driven tests where multiple cases share structure.
- Use `t.Helper()` in helper functions.
- Name tests with behavior intent: `TestCreate_ValidInput`.

## CLI and Configuration Patterns

- Cobra commands live in `internal/cli/` and are registered in the root command.
- Viper configuration is in `internal/config/`.
- If you add flags, wire them to config where appropriate.

## Data and Storage Notes

- Storage files live under `.ai/cortex/` by default.
- Storage mode is configured by `storage.mode` (single or multi).
- Respect existing Gob serialization formats when changing structures.

## MCP Integration

- MCP server is implemented in `internal/mcp/` and exposes JSON-RPC tools.
- Keep tool names stable; update docs if you add or rename tools.

## Repo Rules from Other Systems

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` found in this repo at this time.

## Useful Docs

- `docs/ARCHITECTURE.md`
- `docs/CONFIGURATION.md`
- `docs/MCP.md`
- `docs/CONTRIBUTING.md`
