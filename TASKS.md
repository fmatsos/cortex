# Cortex AI - Implementation Tasks

This file tracks the implementation progress for each development phase.

**Legend:** `[ ]` Not started | `[~]` In progress | `[x]` Completed

---

## Phase 1: Project Foundation

### 1.1 Project Setup
- [ ] Initialize Go module (`go mod init`)
- [ ] Create directory structure
  - [ ] `cmd/cortex/`
  - [ ] `internal/cli/`
  - [ ] `internal/memory/`
  - [ ] `internal/storage/`
  - [ ] `internal/embeddings/`
  - [ ] `internal/search/`
  - [ ] `internal/config/`
  - [ ] `pkg/markdown/`

### 1.2 Build & CI
- [ ] Create Makefile
  - [ ] `build` target
  - [ ] `test` target
  - [ ] `lint` target
  - [ ] `install` target
- [ ] Configure GitHub Actions CI
- [ ] Add `.gitignore`
- [ ] Add `.golangci.yml` (linter config)

### 1.3 Dependencies
- [ ] Add `github.com/spf13/cobra`
- [ ] Add `github.com/spf13/viper`
- [ ] Add `github.com/google/uuid`
- [ ] Add `gopkg.in/yaml.v3`
- [ ] Add `github.com/mattn/go-sqlite3` (optional)

---

## Phase 2: Core Domain

### 2.1 Memory Model
- [ ] Define `Memory` struct in `internal/memory/memory.go`
- [ ] Define `MemoryType` enum (problem, solution, rule, note)
- [ ] Define `CreateInput` struct
- [ ] Define `SearchOptions` struct
- [ ] Define `SearchResult` struct
- [ ] Define `ListOptions` struct

### 2.2 Service Interface
- [ ] Define `Service` interface in `internal/memory/service.go`
  - [ ] `Create(ctx, input) (*Memory, error)`
  - [ ] `Search(ctx, query, opts) ([]SearchResult, error)`
  - [ ] `List(ctx, opts) ([]Memory, error)`
  - [ ] `Get(ctx, id) (*Memory, error)`
  - [ ] `Delete(ctx, id) error`
  - [ ] `MarkObsolete(ctx, id) error`

### 2.3 Service Implementation
- [ ] Implement `MemoryService` struct
- [ ] Wire dependencies (storage, embedder)
- [ ] Implement all interface methods

### 2.4 Tests
- [ ] Write unit tests for `Memory` model
- [ ] Write unit tests for `MemoryService`
- [ ] Create test fixtures

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
- [ ] Flags: `--title`, `--content`, `--type`, `--tags`
- [ ] Input validation
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
- [ ] Required fields definition

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
- [ ] Required field checks (title, type)
- [ ] Type validation (problem|solution|rule|note)
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
| 1. Project Foundation | Not started | 0% |
| 2. Core Domain | Not started | 0% |
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
