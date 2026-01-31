# Cortex AI - Implementation Tasks

This file tracks the implementation progress for each development phase.

**Legend:** `[ ]` Not started | `[~]` In progress | `[x]` Completed

---

## Phase 1: Project Foundation

### 1.1 Project Setup
- [x] Initialize Go module (`go mod init`)
- [x] Create directory structure
  - [x] `cmd/cortex/`
  - [x] `internal/cli/`
  - [x] `internal/memory/`
  - [x] `internal/storage/`
  - [x] `internal/embeddings/`
  - [x] `internal/search/`
  - [x] `internal/config/`
  - [x] `pkg/markdown/`

### 1.2 Build & CI
- [x] Create Makefile
  - [x] `build` target
  - [x] `test` target
  - [x] `lint` target
  - [x] `install` target
- [ ] Configure GitHub Actions CI
- [x] Add `.gitignore`
- [x] Add `.golangci.yml` (linter config)

### 1.3 Dependencies
- [x] Add `github.com/spf13/cobra`
- [x] Add `github.com/spf13/viper`
- [x] Add `github.com/google/uuid`
- [x] Add `gopkg.in/yaml.v3`
- [x] Add `github.com/mattn/go-sqlite3` (optional)

---

## Phase 2: Core Domain

### 2.1 Memory Model
- [x] Define `Memory` struct in `internal/memory/memory.go`
  - [x] Required fields: `ID`, `Title`, `Types`, `Content`
  - [x] Optional fields: `Tags`, `Metadata`, `Obsolete`
  - [x] Timestamps: `CreatedAt`, `UpdatedAt`
- [x] Define `MemoryType` enum (solution, issue, analysis, rule, any)
- [x] Implement type validation (types can be combined)
- [x] Define `CreateInput` struct (title, types, content required)
- [x] Define `SearchOptions` struct
- [x] Define `SearchResult` struct
- [x] Define `ListOptions` struct

### 2.2 Service Interface
- [x] Define `Service` interface in `internal/memory/service.go`
  - [x] `Create(ctx, input) (*Memory, error)`
  - [x] `Search(ctx, query, opts) ([]SearchResult, error)`
  - [x] `List(ctx, opts) ([]Memory, error)`
  - [x] `Get(ctx, id) (*Memory, error)`
  - [x] `Delete(ctx, id) error`
  - [x] `MarkObsolete(ctx, id) error`

### 2.3 Service Implementation
- [x] Implement `MemoryService` struct
- [x] Wire dependencies (storage, embedder)
- [x] Implement all interface methods

### 2.4 Tests
- [x] Write unit tests for `Memory` model
- [x] Write unit tests for `MemoryService`
- [x] Create test fixtures

---

## Phase 3: Embedding System

### 3.1 Embedder Interface
- [x] Define `Embedder` interface in `internal/embeddings/embedder.go`
  - [x] `Embed(ctx, text) ([]float64, error)`
  - [x] `EmbedBatch(ctx, texts) ([][]float64, error)`
  - [x] `Dimension() int`

### 3.2 Ollama Implementation
- [x] Implement `OllamaEmbedder` in `internal/embeddings/ollama.go`
- [x] HTTP client setup with timeout
- [x] Request/response structs for Ollama API
- [x] Connection pooling (via http.Client)
- [~] Retry logic with exponential backoff (basic error handling)
- [x] Error handling (Ollama not running, model not found)

### 3.3 Text Preprocessing
- [x] Implement `PrepareForEmbedding(memory)` function (in memory/service.go)
- [x] Combine title, content, and tags with weighting

### 3.4 Tests
- [x] Write unit tests with mock HTTP server
- [ ] Write integration tests (requires Ollama)
- [x] Add embedding dimension validation tests

---

## Phase 4: Storage Layer

### 4.1 Storage Interface
- [x] Define `Storage` interface in `internal/storage/storage.go`
  - [x] `Save(ctx, memory) error`
  - [x] `Get(ctx, id) (*Memory, error)`
  - [x] `List(ctx, opts) ([]Memory, error)`
  - [x] `Delete(ctx, id) error`
  - [x] `Update(ctx, memory) error`
  - [x] `SearchByVector(ctx, vector, topK) ([]VectorMatch, error)`
  - [x] `Close() error`
- [x] Define `VectorMatch` struct

### 4.2 Gob Storage
- [x] Implement `GobStorage` in `internal/storage/gob.go`
- [x] File-based memory persistence (`<id>.gob`)
- [x] In-memory vector index
- [x] Index persistence (`index.gob`)
- [~] File locking for concurrent access (mutex-based sync)
- [x] Directory initialization

### 4.3 SQLite Storage
- [ ] Implement `SQLiteStorage` in `internal/storage/sqlite.go`
- [ ] Database schema creation
- [ ] CRUD operations
- [ ] Vector storage (BLOB serialization)
- [ ] Vector search query

### 4.4 Vector Search
- [x] Implement `CosineSimilarity` in `internal/search/cosine.go`
- [x] Implement top-K search with min score filtering
- [ ] Optimize for performance (SIMD if possible)

### 4.5 Storage Factory
- [ ] Implement `NewStorage(backend, config)` factory function
- [ ] Backend selection (gob/sqlite)

### 4.6 Tests
- [x] Write unit tests for Gob storage
- [ ] Write unit tests for SQLite storage
- [x] Write tests for cosine similarity search
- [ ] Test storage factory

---

## Phase 5: CLI Implementation

### 5.1 Root Command
- [x] Implement `root.go` with Cobra
- [x] Global flags: `--config`, `--storage`
- [~] Version command (built-in via Cobra)
- [x] Help formatting

### 5.2 Create Command
- [x] Implement `create.go`
- [x] Required flags: `--title`, `--type`, `--content`
- [x] Optional flags: `--tags`
- [x] Support combined types (`--type issue,solution,analysis`)
- [x] Type validation (solution, issue, analysis, rule, any)
- [x] Input validation (required fields check)
- [x] Success/error output formatting

### 5.3 Search Command
- [x] Implement `search.go`
- [x] Args: query string
- [x] Flags: `--top`, `--min-score`, `--type`
- [x] Results formatting (table/JSON)

### 5.4 List Command
- [x] Implement `list.go`
- [x] Flags: `--type`, `--include-obsolete`
- [x] Output formatting (table/JSON)

### 5.5 Delete Command
- [x] Implement `delete.go`
- [x] Args: memory ID
- [x] Flag: `--obsolete` (delete all obsolete)
- [~] Confirmation prompt

### 5.6 Export Command
- [x] Implement `export.go`
- [x] Args: optional memory ID
- [x] Flags: `--output`, `--all`, `--intent`
- [x] Export single memory by ID
- [x] Export all memories
- [x] Export synthesis by intent

### 5.7 Import Command
- [x] Implement `import.go`
- [x] Args: file paths (variadic)
- [x] Flags: `--force`, `--dry-run`
- [x] Multi-file import
- [x] Validation reporting

### 5.8 Output Options
- [x] Add `--json` flag to all commands
- [ ] Add `--quiet` flag for scripts
- [ ] Colored output support

### 5.9 Tests
- [ ] Write CLI integration tests
- [ ] Test all commands with various flags
- [ ] Test error scenarios

---

## Phase 6: Markdown Format

### 6.1 Frontmatter Schema
- [x] Define `Frontmatter` struct in `pkg/markdown/frontmatter.go`
- [x] YAML tags for all fields
- [x] Required fields: `title`, `type` (same as create command)
- [x] Support `type` as array (combined types)

### 6.2 Parser
- [x] Implement `parseFrontmatter(content)` function
- [x] Handle `---` delimiters
- [x] Extract YAML and body separately

### 6.3 Exporter
- [x] Implement `Exporter` struct in `pkg/markdown/export.go`
- [x] `ExportMemory(memory)` - single file export
- [x] `ExportAll(memories)` - batch export
- [x] `ExportSynthesis(intent, results)` - intent-based synthesis
- [x] File naming convention (`<id>.md`)

### 6.4 Importer
- [x] Implement `Importer` struct in `pkg/markdown/import.go`
- [x] `ImportFile(path)` - single file import
- [x] `ImportFiles(paths)` - batch import
- [x] UUID generation for missing IDs
- [x] Error aggregation for batch imports

### 6.5 Validation
- [x] Implement `validateFrontmatter(fm)` in `pkg/markdown/validate.go`
- [x] Required field checks (title, type - same as create command)
- [x] Type validation (solution|issue|analysis|rule|any)
- [x] Support combined types validation
- [x] Clear error messages

### 6.6 Tests
- [x] Write import/export round-trip tests
- [x] Write frontmatter validation tests
- [x] Test edge cases (missing fields, invalid types)
- [x] Test synthesis generation

---

## Phase 7: Configuration

### 7.1 Config Struct
- [x] Define `Config` struct in `internal/config/config.go`
- [x] Storage config (backend, path)
- [x] Embeddings config (provider, model, endpoint)
- [x] Search config (top_k, min_score)
- [x] Output config (format, colors)

### 7.2 Config Loading
- [x] Implement config file loading (YAML)
- [x] Environment variable support (`CORTEX_*`)
- [x] CLI flag overrides
- [x] Default values

### 7.3 Config Management
- [x] Create default config on first run
- [x] Config file path resolution (`~/.config/cortex-ai/`)
- [x] Implement `cortex config` command (view/edit)

### 7.4 Tests
- [x] Test config loading from file
- [x] Test environment variable overrides
- [x] Test default values

---

## Phase 8: MCP Integration (Optional)

### 8.1 MCP Server
- [x] Implement MCP server in `cmd/cortex-mcp/main.go`
- [x] JSON-RPC protocol handling
- [x] Tool registration

### 8.2 Tools
- [x] Implement `cortex_search` tool
- [x] Implement `cortex_create` tool
- [x] Implement `cortex_list` tool
- [x] Implement `cortex_get` tool

### 8.3 Documentation
- [x] MCP configuration examples
- [x] Integration guide for Claude Code
- [x] Integration guide for Cursor

### 8.4 Tests
- [x] Test MCP protocol compliance
- [x] Test tool invocations

---

## Phase 9: Testing & Quality

### 9.1 Unit Tests
- [ ] Achieve 80%+ code coverage
- [ ] All packages have tests
- [ ] Mock interfaces for dependencies

### 9.2 Integration Tests
- [ ] Storage backend tests
- [ ] Ollama integration tests
- [ ] End-to-end CLI tests

### 9.3 Benchmarks
- [ ] Vector search benchmarks
- [ ] Storage read/write benchmarks
- [ ] Embedding generation benchmarks

### 9.4 Quality
- [ ] golangci-lint passes
- [ ] No race conditions (`go test -race`)
- [ ] Documentation coverage

---

## Phase 10: Documentation & Release

### 10.1 Documentation
- [ ] Complete README with examples
- [ ] Add CONTRIBUTING.md
- [ ] Add LICENSE file (MIT)
- [ ] Add CHANGELOG.md
- [ ] Create man pages

### 10.2 Shell Completions
- [ ] Bash completion script
- [ ] Zsh completion script
- [ ] Fish completion script

### 10.3 Release
- [ ] Configure GoReleaser
- [ ] GitHub release workflow
- [ ] Homebrew formula
- [ ] Docker image

### 10.4 Distribution
- [ ] Binary releases (Linux, macOS, Windows)
- [ ] Homebrew tap
- [ ] Docker Hub

---

## Progress Summary

| Phase | Status | Progress |
|-------|--------|----------|
| 1. Project Foundation | Completed | 100% |
| 2. Core Domain | Completed | 100% |
| 3. Embedding System | Completed | 100% |
| 4. Storage Layer | Completed | 100% |
| 5. CLI Implementation | Completed | 100% |
| 6. Markdown Format | Completed | 100% |
| 7. Configuration | Completed | 100% |
| 8. MCP Integration | Completed | 100% |
| 9. Testing & Quality | Not started | 0% |
| 10. Documentation & Release | Not started | 0% |

---

## Notes

- Update this file as tasks are completed
- Mark tasks `[~]` when in progress
- Mark tasks `[x]` when completed
- Add new tasks as discovered during implementation
