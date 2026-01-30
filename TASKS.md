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
- [ ] Define `Embedder` interface in `internal/embeddings/embedder.go`
  - [ ] `Embed(ctx, text) ([]float64, error)`
  - [ ] `EmbedBatch(ctx, texts) ([][]float64, error)`
  - [ ] `Dimension() int`

### 3.2 Ollama Implementation
- [ ] Implement `OllamaEmbedder` in `internal/embeddings/ollama.go`
- [ ] HTTP client setup with timeout
- [ ] Request/response structs for Ollama API
- [ ] Connection pooling
- [ ] Retry logic with exponential backoff
- [ ] Error handling (Ollama not running, model not found)

### 3.3 Text Preprocessing
- [ ] Implement `PrepareForEmbedding(memory)` function
- [ ] Combine title, content, and tags with weighting

### 3.4 Tests
- [ ] Write unit tests with mock HTTP server
- [ ] Write integration tests (requires Ollama)
- [ ] Add embedding dimension validation tests

---

## Phase 4: Storage Layer

### 4.1 Storage Interface
- [ ] Define `Storage` interface in `internal/storage/storage.go`
  - [ ] `Save(ctx, memory) error`
  - [ ] `Get(ctx, id) (*Memory, error)`
  - [ ] `List(ctx, opts) ([]Memory, error)`
  - [ ] `Delete(ctx, id) error`
  - [ ] `Update(ctx, memory) error`
  - [ ] `SearchByVector(ctx, vector, topK) ([]VectorMatch, error)`
  - [ ] `Close() error`
- [ ] Define `VectorMatch` struct

### 4.2 Gob Storage
- [ ] Implement `GobStorage` in `internal/storage/gob.go`
- [ ] File-based memory persistence (`<id>.gob`)
- [ ] In-memory vector index
- [ ] Index persistence (`index.gob`)
- [ ] File locking for concurrent access
- [ ] Directory initialization

### 4.3 SQLite Storage
- [ ] Implement `SQLiteStorage` in `internal/storage/sqlite.go`
- [ ] Database schema creation
- [ ] CRUD operations
- [ ] Vector storage (BLOB serialization)
- [ ] Vector search query

### 4.4 Vector Search
- [ ] Implement `CosineSimilarity` in `internal/search/cosine.go`
- [ ] Implement top-K search with min score filtering
- [ ] Optimize for performance (SIMD if possible)

### 4.5 Storage Factory
- [ ] Implement `NewStorage(backend, config)` factory function
- [ ] Backend selection (gob/sqlite)

### 4.6 Tests
- [ ] Write unit tests for Gob storage
- [ ] Write unit tests for SQLite storage
- [ ] Write benchmarks for vector search
- [ ] Test storage factory

---

## Phase 5: CLI Implementation

### 5.1 Root Command
- [ ] Implement `root.go` with Cobra
- [ ] Global flags: `--config`, `--storage`
- [ ] Version command
- [ ] Help formatting

### 5.2 Create Command
- [ ] Implement `create.go`
- [ ] Required flags: `--title`, `--type`, `--content`
- [ ] Optional flags: `--tags`
- [ ] Support combined types (`--type issue,solution,analysis`)
- [ ] Type validation (solution, issue, analysis, rule, any)
- [ ] Input validation (required fields check)
- [ ] Success/error output formatting

### 5.3 Search Command
- [ ] Implement `search.go`
- [ ] Args: query string
- [ ] Flags: `--top`, `--min-score`, `--type`
- [ ] Results formatting (table/JSON)

### 5.4 List Command
- [ ] Implement `list.go`
- [ ] Flags: `--type`, `--include-obsolete`
- [ ] Output formatting (table/JSON)

### 5.5 Delete Command
- [ ] Implement `delete.go`
- [ ] Args: memory ID
- [ ] Flag: `--obsolete` (delete all obsolete)
- [ ] Confirmation prompt

### 5.6 Export Command
- [ ] Implement `export.go`
- [ ] Args: optional memory ID
- [ ] Flags: `--output`, `--all`, `--intent`
- [ ] Export single memory by ID
- [ ] Export all memories
- [ ] Export synthesis by intent

### 5.7 Import Command
- [ ] Implement `import.go`
- [ ] Args: file paths (variadic)
- [ ] Flags: `--force`, `--dry-run`
- [ ] Multi-file import
- [ ] Validation reporting

### 5.8 Output Options
- [ ] Add `--json` flag to all commands
- [ ] Add `--quiet` flag for scripts
- [ ] Colored output support

### 5.9 Tests
- [ ] Write CLI integration tests
- [ ] Test all commands with various flags
- [ ] Test error scenarios

---

## Phase 6: Markdown Format

### 6.1 Frontmatter Schema
- [ ] Define `Frontmatter` struct in `pkg/markdown/frontmatter.go`
- [ ] YAML tags for all fields
- [ ] Required fields: `title`, `type` (same as create command)
- [ ] Support `type` as array (combined types)

### 6.2 Parser
- [ ] Implement `parseFrontmatter(content)` function
- [ ] Handle `---` delimiters
- [ ] Extract YAML and body separately

### 6.3 Exporter
- [ ] Implement `Exporter` struct in `pkg/markdown/export.go`
- [ ] `ExportMemory(memory)` - single file export
- [ ] `ExportAll(memories)` - batch export
- [ ] `ExportSynthesis(intent, results)` - intent-based synthesis
- [ ] File naming convention (`<id>.md`)

### 6.4 Importer
- [ ] Implement `Importer` struct in `pkg/markdown/import.go`
- [ ] `ImportFile(path)` - single file import
- [ ] `ImportFiles(paths)` - batch import
- [ ] UUID generation for missing IDs
- [ ] Error aggregation for batch imports

### 6.5 Validation
- [ ] Implement `validateFrontmatter(fm)` in `pkg/markdown/validate.go`
- [ ] Required field checks (title, type - same as create command)
- [ ] Type validation (solution|issue|analysis|rule|any)
- [ ] Support combined types validation
- [ ] Clear error messages

### 6.6 Tests
- [ ] Write import/export round-trip tests
- [ ] Write frontmatter validation tests
- [ ] Test edge cases (missing fields, invalid types)
- [ ] Test synthesis generation

---

## Phase 7: Configuration

### 7.1 Config Struct
- [ ] Define `Config` struct in `internal/config/config.go`
- [ ] Storage config (backend, path)
- [ ] Embeddings config (provider, model, endpoint)
- [ ] Search config (top_k, min_score)
- [ ] Output config (format, colors)

### 7.2 Config Loading
- [ ] Implement config file loading (YAML)
- [ ] Environment variable support (`CORTEX_*`)
- [ ] CLI flag overrides
- [ ] Default values

### 7.3 Config Management
- [ ] Create default config on first run
- [ ] Config file path resolution (`~/.config/cortex-ai/`)
- [ ] Implement `cortex config` command (view/edit)

### 7.4 Tests
- [ ] Test config loading from file
- [ ] Test environment variable overrides
- [ ] Test default values

---

## Phase 8: MCP Integration (Optional)

### 8.1 MCP Server
- [ ] Implement MCP server in `cmd/cortex-mcp/main.go`
- [ ] JSON-RPC protocol handling
- [ ] Tool registration

### 8.2 Tools
- [ ] Implement `cortex_search` tool
- [ ] Implement `cortex_create` tool (with user confirmation)
- [ ] Implement `cortex_list` tool

### 8.3 Documentation
- [ ] MCP configuration examples
- [ ] Integration guide for Claude Code
- [ ] Integration guide for Cursor

### 8.4 Tests
- [ ] Test MCP protocol compliance
- [ ] Test tool invocations

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
| 2. Core Domain | In progress | 100% |
| 3. Embedding System | Not started | 0% |
| 4. Storage Layer | Not started | 0% |
| 5. CLI Implementation | Not started | 0% |
| 6. Markdown Format | Not started | 0% |
| 7. Configuration | Not started | 0% |
| 8. MCP Integration | Not started | 0% |
| 9. Testing & Quality | Not started | 0% |
| 10. Documentation & Release | Not started | 0% |

---

## Notes

- Update this file as tasks are completed
- Mark tasks `[~]` when in progress
- Mark tasks `[x]` when completed
- Add new tasks as discovered during implementation
