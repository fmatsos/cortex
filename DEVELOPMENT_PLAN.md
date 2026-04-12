# Cortex - Development Plan

This document outlines the implementation roadmap for Cortex, a CLI tool for persistent AI agent memory.

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
    Title       string            `json:"title"`               // Required
    Content     string            `json:"content"`             // Required
    Types       []MemoryType      `json:"types"`               // Required, can be combined
    Tags        []string          `json:"tags,omitempty"`
    Embedding   []float64         `json:"-"`                   // Vector embedding
    CreatedAt   time.Time         `json:"created_at"`
    UpdatedAt   time.Time         `json:"updated_at"`
    Metadata    map[string]string `json:"metadata,omitempty"`
    Obsolete    bool              `json:"obsolete"`
}

type MemoryType string

const (
    MemoryTypeSolution MemoryType = "solution"  // A fix or workaround
    MemoryTypeIssue    MemoryType = "issue"     // A problem, bug, or challenge
    MemoryTypeAnalysis MemoryType = "analysis"  // Investigation, root cause analysis
    MemoryTypeRule     MemoryType = "rule"      // Convention, standard, guideline
    MemoryTypeAny      MemoryType = "any"       // Generic memory
)

// ValidMemoryTypes for validation
var ValidMemoryTypes = []MemoryType{
    MemoryTypeSolution,
    MemoryTypeIssue,
    MemoryTypeAnalysis,
    MemoryTypeRule,
    MemoryTypeAny,
}

// Memory can have combined types, e.g., []MemoryType{MemoryTypeIssue, MemoryTypeSolution}
// for a memory that documents both the problem and its fix
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
// cortex create --title "Title" --type solution --content "Content"
// cortex create --title "Bug Fix" --type issue,solution --content "..." --tags "go,bug"
var createCmd = &cobra.Command{
    Use:   "create",
    Short: "Create a new memory",
    RunE:  runCreate,
}

func init() {
    createCmd.Flags().StringP("title", "t", "", "Memory title (required)")
    createCmd.Flags().StringSlice("type", nil, "Memory type(s): solution,issue,analysis,rule,any (required, can be combined)")
    createCmd.Flags().StringP("content", "c", "", "Memory content (required)")
    createCmd.Flags().StringSlice("tags", nil, "Tags for the memory")
    createCmd.MarkFlagRequired("title")
    createCmd.MarkFlagRequired("type")
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

### 5.6 Export Command

```go
// internal/cli/export.go

// Export a specific memory by ID
// cortex export <memory-id> --output ./memories/

// Export all memories (each memory = separate file)
// cortex export --all --output ./memories/

// Export by intent (synthesis of relevant memories)
// cortex export --intent "authentication patterns" --output auth-synthesis.md

var exportCmd = &cobra.Command{
    Use:   "export [id]",
    Short: "Export memories to Markdown files",
    RunE:  runExport,
}

func init() {
    exportCmd.Flags().StringP("output", "o", ".", "Output directory or file path")
    exportCmd.Flags().Bool("all", false, "Export all memories")
    exportCmd.Flags().String("intent", "", "Export synthesis based on semantic search")
}
```

### 5.7 Import Command

```go
// internal/cli/import.go

// Import one or multiple memory files
// cortex import memory1.md memory2.md memory3.md

var importCmd = &cobra.Command{
    Use:   "import [files...]",
    Short: "Import memories from Markdown files",
    Args:  cobra.MinimumNArgs(1),
    RunE:  runImport,
}

func init() {
    importCmd.Flags().Bool("force", false, "Overwrite existing memories with same ID")
    importCmd.Flags().Bool("dry-run", false, "Validate files without importing")
}
```

### 5.8 Deliverables

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

### 6.1 Memory File Format (Individual Export)

Each memory is exported as a separate Markdown file with YAML frontmatter:

```markdown
---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
title: JWT Token Refresh Fix
type:
  - issue
  - solution
  - analysis
tags:
  - authentication
  - jwt
created_at: 2024-01-10T14:22:00Z
updated_at: 2024-01-10T14:22:00Z
obsolete: false
metadata:
  project: api-gateway
  author: dev-team
---

When JWT tokens expire, the refresh mechanism was failing because the token
validation was happening before the refresh attempt.

## Root Cause

The middleware was checking token validity synchronously...

## Solution

Added a retry loop with exponential backoff that attempts refresh before
rejecting the request...

## Code Example

\`\`\`go
func refreshToken(ctx context.Context, token string) (*Token, error) {
    // Implementation here
}
\`\`\`
```

**File naming convention:** `<id>.md` or `<slugified-title>.md`

**Note:** Types can be combined - in this example the memory documents an issue, its solution, and the analysis that led to the fix.

### 6.2 Frontmatter Schema

```go
// pkg/markdown/frontmatter.go
type Frontmatter struct {
    ID        string            `yaml:"id,omitempty"`        // Optional on import (generated if missing)
    Title     string            `yaml:"title"`               // Required
    Types     []string          `yaml:"type"`                // Required: solution|issue|analysis|rule|any (can be combined)
    Tags      []string          `yaml:"tags,omitempty"`
    CreatedAt time.Time         `yaml:"created_at,omitempty"`
    UpdatedAt time.Time         `yaml:"updated_at,omitempty"`
    Obsolete  bool              `yaml:"obsolete,omitempty"`
    Metadata  map[string]string `yaml:"metadata,omitempty"`
}

// Required fields for import (same as create command)
var requiredFields = []string{"title", "type"}

// ValidTypes for validation
var validTypes = []string{"solution", "issue", "analysis", "rule", "any"}
```

### 6.3 Synthesis Export (Intent-Based)

When exporting by intent, generate a synthesis document:

```markdown
---
type: synthesis
intent: "authentication patterns"
generated_at: 2024-01-15T10:30:00Z
source_memories:
  - id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
    title: JWT Token Refresh Fix
    score: 0.92
  - id: b2c3d4e5-f6a7-8901-bcde-f12345678901
    title: OAuth2 Integration Guide
    score: 0.87
  - id: c3d4e5f6-a789-0123-cdef-123456789012
    title: Session Management Rules
    score: 0.81
---

# Authentication Patterns - Synthesis

This document synthesizes 3 memories related to "authentication patterns".

## Summary

Based on the stored memories, the following authentication patterns are documented...

## Key Learnings

### From: JWT Token Refresh Fix (score: 0.92)

When JWT tokens expire, the refresh mechanism was failing...

### From: OAuth2 Integration Guide (score: 0.87)

OAuth2 integration requires careful handling of...

### From: Session Management Rules (score: 0.81)

Sessions should be managed with the following rules...

---

*Generated by Cortex - This is a read-only synthesis, not importable.*
```

### 6.4 Exporter Implementation

```go
// pkg/markdown/export.go
type Exporter struct {
    outputDir string
}

// ExportMemory exports a single memory to a Markdown file
func (e *Exporter) ExportMemory(m *Memory) (string, error) {
    filename := fmt.Sprintf("%s.md", m.ID)
    // Marshal frontmatter + content
    return filepath.Join(e.outputDir, filename), nil
}

// ExportAll exports all memories to separate files
func (e *Exporter) ExportAll(memories []*Memory) ([]string, error) {
    var paths []string
    for _, m := range memories {
        path, err := e.ExportMemory(m)
        if err != nil {
            return nil, err
        }
        paths = append(paths, path)
    }
    return paths, nil
}

// ExportSynthesis generates a synthesis from search results
func (e *Exporter) ExportSynthesis(intent string, results []SearchResult) (string, error) {
    // Generate synthesis document
    return filepath.Join(e.outputDir, "synthesis.md"), nil
}
```

### 6.5 Importer Implementation

```go
// pkg/markdown/import.go
type Importer struct {
    embedder Embedder
}

// ImportFile parses a Markdown file and returns a Memory
func (i *Importer) ImportFile(path string) (*Memory, error) {
    content, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }

    fm, body, err := parseFrontmatter(content)
    if err != nil {
        return nil, err
    }

    if err := validateFrontmatter(fm); err != nil {
        return nil, fmt.Errorf("invalid frontmatter in %s: %w", path, err)
    }

    memory := &Memory{
        ID:        fm.ID, // May be empty, will be generated
        Title:     fm.Title,
        Type:      MemoryType(fm.Type),
        Tags:      fm.Tags,
        Content:   body,
        Metadata:  fm.Metadata,
        CreatedAt: fm.CreatedAt,
        UpdatedAt: fm.UpdatedAt,
    }

    // Generate new ID if not provided
    if memory.ID == "" {
        memory.ID = uuid.New().String()
    }

    return memory, nil
}

// ImportFiles imports multiple files
func (i *Importer) ImportFiles(paths []string) ([]*Memory, []error) {
    var memories []*Memory
    var errors []error

    for _, path := range paths {
        m, err := i.ImportFile(path)
        if err != nil {
            errors = append(errors, fmt.Errorf("%s: %w", path, err))
            continue
        }
        memories = append(memories, m)
    }

    return memories, errors
}
```

### 6.6 Validation Rules

```go
// pkg/markdown/validate.go
func validateFrontmatter(fm *Frontmatter) error {
    var errs []string

    if fm.Title == "" {
        errs = append(errs, "title is required")
    }

    if len(fm.Types) == 0 {
        errs = append(errs, "type is required (at least one)")
    } else {
        for _, t := range fm.Types {
            if !isValidType(t) {
                errs = append(errs, fmt.Sprintf("invalid type: %s (must be solution|issue|analysis|rule|any)", t))
            }
        }
    }

    if len(errs) > 0 {
        return fmt.Errorf("validation failed: %s", strings.Join(errs, ", "))
    }

    return nil
}

func isValidType(t string) bool {
    for _, valid := range validTypes {
        if t == valid {
            return true
        }
    }
    return false
}
```

### 6.7 Deliverables

- [ ] Define YAML frontmatter schema
- [ ] Implement frontmatter parser (using `gopkg.in/yaml.v3`)
- [ ] Implement single memory exporter
- [ ] Implement batch exporter (all memories)
- [ ] Implement synthesis exporter (intent-based)
- [ ] Implement file importer with validation
- [ ] Implement multi-file import
- [ ] Handle import conflicts (--force flag)
- [ ] Add dry-run validation mode
- [ ] Write tests for import/export round-trip
- [ ] Write tests for frontmatter validation

---

## Phase 7: Configuration

### 7.1 Configuration File

```toml
# ~/.config/cortex/config.toml
[storage]
backend = "chroma"  # chroma | sqlite
path = "~/.local/share/cortex-ai"

[embeddings]
provider = "ollama"
model = "nomic-embed-text"
endpoint = "http://localhost:11434"
timeout = 30

[search]
top_k = 5
min_score = 0.5
include_obsolete = false

[output]
format = "text"  # text | json
colors = true
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
