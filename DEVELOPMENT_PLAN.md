# Cortex AI - Development Plan

This document outlines the implementation roadmap for Cortex AI, a CLI tool for persistent AI agent memory.

---

## Phase 1: Project Foundation

### 1.1 Project Structure Setup

```
cortex-ai/
├── cmd/
│   └── cortex/
│       └── main.go              # CLI entry point
├── internal/
│   ├── cli/                     # CLI commands (cobra)
│   │   ├── root.go
│   │   ├── create.go
│   │   ├── search.go
│   │   ├── list.go
│   │   ├── delete.go
│   │   ├── export.go
│   │   └── import.go
│   ├── memory/                  # Memory domain
│   │   ├── memory.go            # Memory struct & interfaces
│   │   └── service.go           # Business logic
│   ├── storage/                 # Storage backends
│   │   ├── storage.go           # Storage interface
│   │   ├── gob.go               # Gob implementation
│   │   └── sqlite.go            # SQLite implementation
│   ├── embeddings/              # Embedding generation
│   │   ├── embedder.go          # Embedder interface
│   │   └── ollama.go            # Ollama implementation
│   ├── search/                  # Vector search
│   │   ├── search.go            # Search interface
│   │   └── cosine.go            # Cosine similarity search
│   └── config/                  # Configuration
│       └── config.go
├── pkg/
│   └── markdown/                # Markdown import/export
│       ├── export.go
│       └── import.go
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

### 1.2 Dependencies

```go
// go.mod
module github.com/your-org/cortex-ai

go 1.21

require (
    github.com/spf13/cobra v1.8.0       // CLI framework
    github.com/spf13/viper v1.18.0      // Configuration
    github.com/google/uuid v1.6.0       // UUID generation
    github.com/mattn/go-sqlite3 v1.14.0 // SQLite (optional)
    gopkg.in/yaml.v3 v3.0.1             // YAML parsing
)
```

### 1.3 Deliverables

- [ ] Initialize Go module
- [ ] Create directory structure
- [ ] Setup Makefile (build, test, lint)
- [ ] Configure CI/CD (GitHub Actions)
- [ ] Add .gitignore

---

## Phase 2: Core Domain

### 2.1 Memory Model

```go
// internal/memory/memory.go
type Memory struct {
    ID          string            `json:"id"`
    Title       string            `json:"title"`
    Content     string            `json:"content"`
    Tags        []string          `json:"tags,omitempty"`
    Type        MemoryType        `json:"type"`        // problem, solution, rule, note
    Embedding   []float64         `json:"-"`           // Vector embedding
    CreatedAt   time.Time         `json:"created_at"`
    UpdatedAt   time.Time         `json:"updated_at"`
    Metadata    map[string]string `json:"metadata,omitempty"`
    Obsolete    bool              `json:"obsolete"`
}

type MemoryType string

const (
    MemoryTypeProblem  MemoryType = "problem"
    MemoryTypeSolution MemoryType = "solution"
    MemoryTypeRule     MemoryType = "rule"
    MemoryTypeNote     MemoryType = "note"
)
```

### 2.2 Service Layer

```go
// internal/memory/service.go
type Service interface {
    Create(ctx context.Context, input CreateInput) (*Memory, error)
    Search(ctx context.Context, query string, opts SearchOptions) ([]SearchResult, error)
    List(ctx context.Context, opts ListOptions) ([]Memory, error)
    Get(ctx context.Context, id string) (*Memory, error)
    Delete(ctx context.Context, id string) error
    MarkObsolete(ctx context.Context, id string) error
}
```

### 2.3 Deliverables

- [ ] Define Memory struct with all fields
- [ ] Define MemoryType enum
- [ ] Create Service interface
- [ ] Implement service with dependency injection
- [ ] Write unit tests for service layer

---

## Phase 3: Embedding System

### 3.1 Embedder Interface

```go
// internal/embeddings/embedder.go
type Embedder interface {
    Embed(ctx context.Context, text string) ([]float64, error)
    EmbedBatch(ctx context.Context, texts []string) ([][]float64, error)
    Dimension() int
}
```

### 3.2 Ollama Implementation

```go
// internal/embeddings/ollama.go
type OllamaEmbedder struct {
    endpoint string
    model    string
    client   *http.Client
}

// Uses POST /api/embeddings endpoint
func (o *OllamaEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
    // Request to Ollama API
    payload := map[string]string{
        "model":  o.model,
        "prompt": text,
    }
    // ...
}
```

### 3.3 Text Preprocessing

For better embeddings, preprocess memory content:

```go
func PrepareForEmbedding(m *Memory) string {
    // Combine title and content with weighting
    return fmt.Sprintf("Title: %s\n\nContent: %s\n\nTags: %s",
        m.Title,
        m.Content,
        strings.Join(m.Tags, ", "),
    )
}
```

### 3.4 Deliverables

- [ ] Define Embedder interface
- [ ] Implement Ollama embedder
- [ ] Add connection pooling and retry logic
- [ ] Implement text preprocessing
- [ ] Add embedding dimension validation
- [ ] Write integration tests (requires Ollama running)

---

## Phase 4: Storage Layer

### 4.1 Storage Interface

```go
// internal/storage/storage.go
type Storage interface {
    Save(ctx context.Context, memory *Memory) error
    Get(ctx context.Context, id string) (*Memory, error)
    List(ctx context.Context, opts ListOptions) ([]Memory, error)
    Delete(ctx context.Context, id string) error
    Update(ctx context.Context, memory *Memory) error
    SearchByVector(ctx context.Context, vector []float64, topK int) ([]VectorMatch, error)
    Close() error
}

type VectorMatch struct {
    MemoryID string
    Score    float64
}
```

### 4.2 Gob Storage Implementation

```go
// internal/storage/gob.go
type GobStorage struct {
    basePath string
    index    *VectorIndex  // In-memory index
    mu       sync.RWMutex
}

// File structure:
// ~/.local/share/cortex-ai/
// ├── memories/
// │   ├── <uuid>.gob      # Individual memory files
// │   └── ...
// └── index.gob           # Vector index
```

### 4.3 SQLite Storage Implementation

```go
// internal/storage/sqlite.go
type SQLiteStorage struct {
    db *sql.DB
}

// Schema:
// CREATE TABLE memories (
//     id TEXT PRIMARY KEY,
//     title TEXT NOT NULL,
//     content TEXT NOT NULL,
//     type TEXT NOT NULL,
//     tags TEXT,           -- JSON array
//     embedding BLOB,      -- Serialized float64 array
//     metadata TEXT,       -- JSON object
//     obsolete INTEGER DEFAULT 0,
//     created_at DATETIME,
//     updated_at DATETIME
// );
// CREATE INDEX idx_memories_type ON memories(type);
// CREATE INDEX idx_memories_obsolete ON memories(obsolete);
```

### 4.4 Vector Search Implementation

```go
// internal/search/cosine.go
func CosineSimilarity(a, b []float64) float64 {
    var dotProduct, normA, normB float64
    for i := range a {
        dotProduct += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}
```

### 4.5 Deliverables

- [ ] Define Storage interface
- [ ] Implement Gob storage with file-based persistence
- [ ] Implement in-memory vector index for Gob storage
- [ ] Implement SQLite storage
- [ ] Implement cosine similarity search
- [ ] Add storage factory for backend selection
- [ ] Write unit tests for both backends
- [ ] Write benchmarks for vector search

---

## Phase 5: CLI Implementation

### 5.1 Root Command

```go
// internal/cli/root.go
var rootCmd = &cobra.Command{
    Use:   "cortex",
    Short: "Persistent memory for AI coding agents",
}

func init() {
    rootCmd.PersistentFlags().StringP("config", "c", "", "config file path")
    rootCmd.PersistentFlags().String("storage", "gob", "storage backend (gob|sqlite)")
}
```

### 5.2 Create Command

```go
// cortex create --title "Title" --content "Content" --type solution --tags "go,bug"
var createCmd = &cobra.Command{
    Use:   "create",
    Short: "Create a new memory",
    RunE:  runCreate,
}

func init() {
    createCmd.Flags().StringP("title", "t", "", "Memory title (required)")
    createCmd.Flags().StringP("content", "c", "", "Memory content (required)")
    createCmd.Flags().String("type", "note", "Memory type (problem|solution|rule|note)")
    createCmd.Flags().StringSlice("tags", nil, "Tags for the memory")
    createCmd.MarkFlagRequired("title")
    createCmd.MarkFlagRequired("content")
}
```

### 5.3 Search Command

```go
// cortex search "authentication issues" --top 5 --min-score 0.7
var searchCmd = &cobra.Command{
    Use:   "search [query]",
    Short: "Search memories semantically",
    Args:  cobra.ExactArgs(1),
    RunE:  runSearch,
}

func init() {
    searchCmd.Flags().IntP("top", "n", 5, "Number of results to return")
    searchCmd.Flags().Float64("min-score", 0.5, "Minimum similarity score")
    searchCmd.Flags().String("type", "", "Filter by memory type")
}
```

### 5.4 List Command

```go
// cortex list --type solution --include-obsolete
var listCmd = &cobra.Command{
    Use:   "list",
    Short: "List all memories",
    RunE:  runList,
}
```

### 5.5 Delete Command

```go
// cortex delete <memory-id>
// cortex delete --obsolete  # Delete all obsolete memories
var deleteCmd = &cobra.Command{
    Use:   "delete [id]",
    Short: "Delete a memory",
    RunE:  runDelete,
}
```

### 5.6 Export/Import Commands

```go
// cortex export --output memories.md
// cortex import --file memories.md
```

### 5.7 Deliverables

- [ ] Implement root command with global flags
- [ ] Implement create command
- [ ] Implement search command with output formatting
- [ ] Implement list command with filtering
- [ ] Implement delete command
- [ ] Implement export command (Markdown)
- [ ] Implement import command (Markdown)
- [ ] Add JSON output option for all commands
- [ ] Write CLI integration tests

---

## Phase 6: Markdown Format

### 6.1 Export Format

```markdown
# Cortex AI Memories Export

Exported: 2024-01-15T10:30:00Z
Total: 42 memories

---

## Auth Token Refresh Bug

- **ID:** `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- **Type:** solution
- **Tags:** `authentication`, `jwt`, `bug-fix`
- **Created:** 2024-01-10T14:22:00Z

### Content

When JWT tokens expire, the refresh mechanism was failing because...

The fix involved adding a retry loop with exponential backoff...

---

## Project Coding Standards

- **ID:** `b2c3d4e5-f6a7-8901-bcde-f12345678901`
- **Type:** rule
- **Tags:** `standards`, `code-style`
- **Created:** 2024-01-05T09:00:00Z

### Content

All error messages must include context using `fmt.Errorf("operation: %w", err)`...

---
```

### 6.2 Import Parser

The import parser should:
1. Parse the Markdown structure
2. Extract metadata from the frontmatter-style fields
3. Generate new embeddings for imported content
4. Handle conflicts (same ID exists)

### 6.3 Deliverables

- [ ] Define Markdown export format
- [ ] Implement Markdown exporter
- [ ] Implement Markdown parser/importer
- [ ] Handle import conflicts
- [ ] Add import validation
- [ ] Write tests for import/export round-trip

---

## Phase 7: Configuration

### 7.1 Configuration File

```yaml
# ~/.config/cortex-ai/config.yaml
storage:
  backend: gob                              # gob | sqlite
  path: ~/.local/share/cortex-ai

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434
  timeout: 30s

search:
  top_k: 5
  min_score: 0.5
  include_obsolete: false

output:
  format: text                              # text | json
  colors: true
```

### 7.2 Environment Variables

```bash
CORTEX_STORAGE_BACKEND=sqlite
CORTEX_EMBEDDINGS_ENDPOINT=http://localhost:11434
CORTEX_EMBEDDINGS_MODEL=nomic-embed-text
```

### 7.3 Deliverables

- [ ] Define config struct
- [ ] Implement config loading (file + env + flags)
- [ ] Add config validation
- [ ] Create default config on first run
- [ ] Add `cortex config` command to view/edit config

---

## Phase 8: MCP Integration (Optional)

### 8.1 MCP Server

For integration with AI agents via Model Context Protocol:

```go
// cmd/cortex-mcp/main.go
// Implements MCP server protocol for AI agent integration
```

### 8.2 Available Tools

```json
{
  "tools": [
    {
      "name": "cortex_search",
      "description": "Search memories by semantic similarity",
      "parameters": {
        "query": "string",
        "top_k": "integer"
      }
    },
    {
      "name": "cortex_create",
      "description": "Create a new memory (requires user confirmation)",
      "parameters": {
        "title": "string",
        "content": "string",
        "type": "string"
      }
    }
  ]
}
```

### 8.3 Deliverables

- [ ] Implement MCP server protocol
- [ ] Expose search tool
- [ ] Expose create tool (with user confirmation flow)
- [ ] Add MCP documentation
- [ ] Test with Claude Code / Cursor

---

## Phase 9: Testing & Quality

### 9.1 Testing Strategy

| Type | Coverage Target | Tools |
|------|-----------------|-------|
| Unit tests | 80%+ | `go test` |
| Integration tests | Key paths | `go test -tags=integration` |
| E2E tests | CLI commands | Shell scripts |

### 9.2 Deliverables

- [ ] Unit tests for all packages
- [ ] Integration tests for storage backends
- [ ] E2E tests for CLI commands
- [ ] Benchmark tests for vector search
- [ ] Add test fixtures and mocks

---

## Phase 10: Documentation & Release

### 10.1 Documentation

- [ ] Complete README with examples
- [ ] Add CONTRIBUTING.md
- [ ] Add LICENSE file (MIT)
- [ ] Create man pages
- [ ] Add shell completion scripts (bash, zsh, fish)

### 10.2 Release

- [ ] Setup GoReleaser
- [ ] Create Homebrew formula
- [ ] Add Docker image
- [ ] Create GitHub releases

---

## Development Milestones

| Milestone | Phases | Description |
|-----------|--------|-------------|
| **v0.1.0** | 1-4 | Core functionality: memory CRUD + vector search |
| **v0.2.0** | 5 | Full CLI implementation |
| **v0.3.0** | 6-7 | Markdown import/export + configuration |
| **v0.4.0** | 8 | MCP integration |
| **v1.0.0** | 9-10 | Production ready with full testing & docs |

---

## Getting Started

```bash
# 1. Initialize the project
mkdir -p cmd/cortex internal/{cli,memory,storage,embeddings,search,config} pkg/markdown
go mod init github.com/your-org/cortex-ai

# 2. Install dependencies
go get github.com/spf13/cobra
go get github.com/spf13/viper
go get github.com/google/uuid

# 3. Start with Phase 2 (Core Domain)
# Define the Memory struct and Service interface first

# 4. Then Phase 3 (Embeddings)
# Implement Ollama integration to generate embeddings

# 5. Then Phase 4 (Storage)
# Start with Gob storage for simplicity

# 6. Finally Phase 5 (CLI)
# Wire everything together with Cobra commands
```

---

## Technical Decisions

### Why Gob as Default?

- Zero external dependencies
- Fast serialization/deserialization
- Simple file-based storage
- Easy to backup and version control
- Sufficient for single-user scenarios

### Why Ollama?

- Privacy: All data stays local
- Free: No API costs
- Fast: Local inference
- Flexible: Multiple model options
- Compatible: Works offline

### Why Cosine Similarity?

- Standard for text embeddings
- Normalized comparison
- Efficient computation
- Works well with embedding models

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ollama not installed | High | Clear error messages, installation guide |
| Large memory count | Medium | Implement pagination, optimize vector search |
| Embedding dimension mismatch | Medium | Store dimension in config, validate on load |
| Concurrent access (Gob) | Low | File locking, recommend SQLite for teams |
