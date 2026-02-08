# Cortex - Agent Notes

This file is for agentic coding tools working in this repo. It summarizes how to build/test/lint and the local code style conventions.

## Project Snapshot

- **Module**: `github.com/cortex-ai/cortex-ai`
- **Language**: Go (Go 1.24+)
- **CLI Framework**: Cobra
- **Configuration**: Viper
- **Embeddings**: Ollama (local)
- **Storage**: Gob files (binary serialization)
- **Architecture**: Three-layer memory system (working/episodic/semantic)

### Key Locations

```
cortex/
├── cmd/cortex/main.go                # Entry point
├── internal/
│   ├── cli/                          # Cobra commands (16 files)
│   │   ├── root.go                   # Root command setup
│   │   ├── search.go                 # Semantic search command
│   │   ├── create.go                 # Create memory command
│   │   ├── list.go                   # List memories command
│   │   ├── get.go                    # Get memory by ID
│   │   ├── delete.go                 # Delete memory
│   │   ├── export.go                 # Export to Markdown
│   │   ├── import.go                 # Import from Markdown
│   │   ├── transfer-working.go       # Transfer working to episodic
│   │   ├── consolidate.go            # Consolidation with dedup
│   │   ├── autoprune.go              # Cleanup and optimization
│   │   ├── stats.go                  # Database statistics
│   │   ├── config.go                 # Configuration management
│   │   ├── completion.go             # Shell completion
│   │   ├── validate_template.go      # Template validation
│   │   └── mcp.go                    # MCP server
│   ├── memory/                       # Domain model + service
│   │   ├── types.go                  # Memory struct, enums
│   │   └── service.go                # Memory service layer
│   ├── storage/                      # Storage interface + Gob impl
│   │   ├── storage.go                # Storage interface
│   │   └── gob.go                    # Gob implementation
│   ├── embeddings/                   # Embedder interface + Ollama
│   │   ├── embedder.go               # Interface definition
│   │   └── ollama.go                 # Ollama HTTP client
│   ├── search/                       # Cosine similarity search
│   │   └── cosine.go                 # Cosine similarity impl
│   ├── consolidation/                # Memory consolidation system
│   │   ├── service.go                # Consolidation with dedup
│   │   └── autoprune.go              # Cleanup and optimization
│   ├── config/                       # Configuration management
│   │   └── config.go                 # Viper configuration
│   ├── mcp/                          # MCP server (JSON-RPC 2.0)
│   │   ├── protocol.go               # JSON-RPC types
│   │   ├── server.go                 # MCP server implementation
│   │   ├── transport.go              # Transport interface
│   │   ├── transport_stdio.go        # Stdio transport
│   │   └── transport_sse.go          # SSE transport
│   ├── schemas/                      # JSON schemas
│   │   ├── cli/                      # CLI output schemas
│   │   ├── mcp/                      # MCP tool schemas
│   │   ├── templates/                # Template schemas
│   │   ├── template_loader.go        # Template loading
│   │   ├── validate.go               # Schema validation
│   │   └── embed.go                  # Embedded schemas
│   └── templates/                    # Template system
└── pkg/                              # Shared utilities
    ├── json/                         # JSON marshaling helpers
    │   ├── memory.go
    │   ├── export.go
    │   └── import.go
    ├── markdown/                     # Markdown import/export
    │   ├── parser.go                 # Markdown parser
    │   ├── frontmatter.go            # YAML frontmatter
    │   ├── export.go                 # Export to Markdown
    │   ├── import.go                 # Import from Markdown
    │   └── validate.go               # Validation
    └── session/                      # Session ID derivation
        ├── session.go                # Git branch-based session ID
        └── session_test.go           # Session derivation tests
```

## Three-Layer Memory System

Cortex implements a hierarchical memory architecture:

1. **Working Memory** - Session-scoped, temporary context
   - Stored in `working/session-{id}.gob` files
   - Used for active development sessions
   - Transferred to episodic when session ends

2. **Episodic Memory** - Time-bound historical events (90 days default)
   - Bug fixes, decisions, meeting notes
   - Auto-pruned after retention period
   - Stored in `memories.gob` (main file)

3. **Semantic Memory** - Permanent knowledge and patterns
   - Conventions, best practices, architecture
   - Never auto-pruned
   - Stored in `memories.gob` (main file)

## CLI Commands

### Memory Operations (6 commands)
- `cortex create` - Create a new memory with embeddings
- `cortex search` - Semantic search across all layers
- `cortex list` - List memories with filtering by level/tags
- `cortex get <id>` - Get a specific memory by ID
- `cortex delete <id>` - Delete a memory permanently
- `cortex mark-obsolete <id>` - Soft-delete a memory

### Advanced Operations (5 commands)
- `cortex transfer-working` - Transfer working memories to episodic by session ID
- `cortex consolidate` - Create memory with duplicate detection and merging
- `cortex autoprune` - Clean duplicates, archive episodic, merge semantic
- `cortex export` - Export memories to Markdown (single/batch/synthesis modes)
- `cortex import` - Import memories from Markdown files with validation

### System Commands (4 commands)
- `cortex config` - View/edit configuration, validate templates, export schemas
- `cortex stats` - Display database statistics (count by level, storage size)
- `cortex completion` - Generate shell completions (bash/zsh/fish/powershell)
- `cortex start-mcp-server` - Start MCP server (stdio or SSE transport)

## Build / Lint / Test

From repo root:

```bash
make build          # Build to ./bin/cortex
make install        # Install to $GOBIN
make test           # Run all tests (verbose + coverage)
make test-race      # Run tests with race detector
make lint           # Run golangci-lint run ./...
make fmt            # Run go fmt ./...
make deps           # Run go mod download + tidy
make clean          # Remove build artifacts
```

Run tests for a single package:

```bash
go test ./internal/memory/...
go test ./internal/storage/...
go test ./internal/consolidation/...
```

Run a single test by name (regex match):

```bash
go test ./internal/memory -run TestCreate
go test ./internal/storage -run "TestGobStorage/.*"
go test ./internal/consolidation -run TestAutoprune
```

Run a single test without cached results:

```bash
go test ./internal/memory -run TestCreate -count=1
```

Run benchmarks:

```bash
go test ./internal/storage -bench=. -count=1
go test ./internal/search -bench=BenchmarkCosine -count=1
```

## Code Style Guidelines

### General Principles

- Follow **Effective Go** and standard library patterns
- Keep functions small and focused; prefer clear control flow over cleverness
- Keep exported APIs stable; add new helpers rather than changing call sites widely
- Use context-aware operations where IO or long work happens
- Avoid global state; prefer constructor-based dependency injection

### Formatting

- Use `gofmt` for all Go files; `make fmt` is available
- Keep lines reasonably short when it improves readability
- Avoid dense one-liners that sacrifice clarity

### Imports

- Use standard Go import grouping: stdlib, blank line, third-party
- Avoid dot imports
- Avoid aliasing unless it resolves a conflict or improves clarity
- Prefer explicit package names over short aliases

### Types and Naming

- Use Go naming conventions: `camelCase` for locals, `PascalCase` for exported
- Avoid stuttering in type names when package already provides context
  - Good: `memory.Service` (not `memory.MemoryService`)
  - Good: `storage.Storage` (interface), `storage.GobStorage` (concrete type)
- Prefer concrete types in structs; use interfaces at boundaries
- Use pointer receivers for methods that mutate state or to avoid large copies
- Use `time.Time` consistently; capture `time.Now()` once when needed

### Error Handling

- Return early on error; avoid deep nesting
- Wrap errors with context using `fmt.Errorf("...: %w", err)`
- Error strings should be lowercase, no trailing punctuation
- Prefer typed errors or sentinel values only when callers need to branch on them

### Logging and Output

- CLI commands should report user-facing errors at the command layer, not deep inside
- Avoid printing from library packages; return errors instead
- Use stderr for errors, stdout for data output

### Concurrency

- Use `sync.RWMutex` or `sync.Mutex` consistently for shared state
- Keep critical sections minimal
- Lock ordering should be obvious to avoid deadlocks

### Testing

- Tests are colocated with source files (`*_test.go`)
- Prefer table-driven tests where multiple cases share structure
- Use `t.Helper()` in helper functions
- Name tests with behavior intent: `TestCreate_ValidInput`, `TestSearch_EmptyQuery`
- Test error cases as thoroughly as success cases

## CLI and Configuration Patterns

- Cobra commands live in `internal/cli/` and are registered in the root command
- Viper configuration is in `internal/config/`
- Configuration hierarchy: CLI flags > Environment variables > Config file > Defaults
- If you add flags, wire them to config where appropriate
- Use consistent flag naming: `--level`, `--session`, `--tags`, etc.

## Data and Storage Notes

### Storage Locations

- Default storage path: `~/.local/share/cortex-ai/`
- Main file: `memories.gob` (contains episodic + semantic)
- Working files: `working/session-{id}.gob` (one per session)
- Config file: `~/.config/cortex-ai/config.yaml`

### Storage Architecture

- **GobStorage** implements the `Storage` interface
- Thread-safe with `sync.RWMutex` locks
- Separate indices for persistent (episodic/semantic) and working memories
- In-memory vector index for fast cosine similarity search
- Gob format is Go-specific but very efficient

### Memory Structure

```go
type Memory struct {
    ID        string           // UUID
    Level     MemoryLevel      // working|episodic|semantic
    Title     string           // Min 3 chars
    Content   string           // Min 10 chars
    Tags      []string         // Optional categorization
    Embedding []float64        // Vector (e.g., 768 dims for nomic-embed-text)
    Context   MemoryContext    // Metadata (task, session, author, etc.)
    CreatedAt time.Time
    UpdatedAt time.Time
    MergedFrom []string        // Track consolidation sources
    Obsolete  bool             // Soft delete flag
}
```

## Embeddings System

- **Interface**: `embeddings.Embedder`
- **Implementation**: Ollama HTTP client (`embeddings.OllamaEmbedder`)
- **Default model**: `nomic-embed-text` (768 dimensions)
- **Endpoint**: `http://localhost:11434` (configurable)
- **Normalization**: All vectors are normalized to unit vectors for cosine similarity

### Key Operations

- `Embed(ctx, text)` - Single text embedding
- `EmbedBatch(ctx, texts)` - Batch embedding for efficiency
- `Dimension()` - Returns vector dimension (768 for nomic-embed-text)

## Consolidation System

Located in `internal/consolidation/`:

- **Service**: Handles consolidation with duplicate detection
- **Autoprune**: Cleans duplicates, archives old episodic, merges semantic
- **Similarity threshold**: 0.85 (configurable) for duplicate detection
- **Force flag**: Bypass duplicate detection when needed

### Consolidation Flow

1. Embed new content
2. Search for similar existing memories (similarity >= threshold)
3. If found: merge with existing memory, track in `MergedFrom`
4. If not found: create new memory
5. Return result indicating action taken (created/merged)

## MCP Integration

Located in `internal/mcp/`:

- **Protocol**: JSON-RPC 2.0
- **MCP Version**: 2024-11-05
- **Transports**: stdio (default) and SSE (HTTP)
- **Tools**: 13 tools across memory, workflow, and decision categories

### MCP Server Features

- Stdio transport for Claude Code/Cursor integration
- SSE transport for web/remote clients
- Full semantic search capabilities
- Memory creation with all metadata
- Three-level consolidation support
- Duplicate detection and merging
- Workflow tools for memory self-maintenance (promote, update, mark obsolete)
- Thinking checkpoint tools for LLM-guided reflection (session review, maintenance, task completion)
- Configurable prompts for all thinking/decision tools

### Tool Names (keep stable!)

**Memory Tools:**
- `cortex_search` - Semantic search
- `cortex_create` - Create memory (legacy, without dedup)
- `cortex_list` - List all memories
- `cortex_get` - Get by ID
- `cortex_consolidate` - Multi-level storage with dedup

**Workflow Action Tools:**
- `cortex_promote_memory` - Promote memory to higher layer (working→episodic→semantic)
- `cortex_update_memory` - Update memory title/content/tags with re-embedding
- `cortex_mark_obsolete` - Soft-delete a memory

**Workflow Thinking Tools:**
- `cortex_review_session` - End-of-session review prompt
- `cortex_think_about_memory_maintenance` - Maintenance checkpoint prompt
- `cortex_think_about_task_completion` - Post-task reflection prompt

**Decision Support Tools:**
- `cortex_choose_memory_layer` - Layer selection prompt
- `cortex_choose_working_consolidation` - Working memory consolidation prompt

> **Important**: Keep tool names stable; update docs if you add or rename tools.

## JSON Schemas

Located in `internal/schemas/`:

- **CLI Schemas** (`cli/`): Output formats for CLI commands
- **MCP Schemas** (`mcp/`): Tool schemas for MCP protocol
- **Template Schemas** (`templates/`): Markdown template schemas
- **Embedded**: Schemas are embedded at compile time using `go:embed`
- **Validation**: Schema validation using JSON Schema Draft 2020-12

### Schema Management

- Export schemas: `cortex config schema <type> -o file.json`
- Validate templates: `cortex config template validate file.yaml`
- Schema types: `markdown`, `memory`, `synthesis`, `cli-output`, `mcp-tool`

## Templates System

Located in `internal/schemas/` and `internal/templates/`:

- **Markdown templates**: Customizable export templates
- **Go templates**: Uses Go `text/template` syntax
- **Frontmatter**: YAML metadata in Markdown files
- **Validation**: JSON Schema validation before use
- **Default templates**: Embedded in binary

### Template Variables

- `{{.Content}}` - Memory content
- `{{.Title}}` - Memory title
- `{{.Level}}` - Memory level
- `{{.Tags}}` - Memory tags
- `{{.CreatedAt}}` - Creation timestamp
- `{{.UpdatedAt}}` - Update timestamp

## Common Development Tasks

### Adding a New CLI Command

1. Create file in `internal/cli/` (e.g., `newcommand.go`)
2. Define Cobra command with flags
3. Register in `root.go`
4. Add tests in `cli_test.go`
5. Update `docs/CLI_REFERENCE.md`
6. Add JSON schema if command produces output

### Adding a New Memory Level

1. Update `MemoryLevel` enum in `internal/memory/types.go`
2. Update validation logic
3. Update storage layer (`internal/storage/gob.go`)
4. Update CLI commands to support new level
5. Update documentation
6. Add tests

### Adding a New MCP Tool

1. Define schema in `internal/schemas/mcp/`
2. Add tool handler in `internal/mcp/server.go`
3. Register tool name in `internal/schemas/embed.go` (`MCPToolNames`)
4. Add dispatch case in `handleCallTool()` switch
5. For thinking tools: add configurable prompt in `internal/config/config.go`
6. Update `docs/MCP.md`
7. Add tests in `server_test.go`

### Updating Embeddings Model

1. Update default in `internal/config/config.go`
2. Test with new model: `CORTEX_EMBEDDINGS_MODEL=new-model cortex search "test"`
3. Update `docs/EMBEDDINGS.md` with model details
4. Consider dimension changes (affects storage)

## Performance Considerations

- **Embeddings**: Batch operations when possible (use `EmbedBatch`)
- **Search**: In-memory index is fast; no optimization needed for < 10k memories
- **Storage**: Gob is efficient; consider SQLite for > 100k memories
- **Locks**: Keep critical sections minimal; use RWMutex for read-heavy operations

## Security Notes

- No sensitive data in logs
- Respect file permissions for storage files
- Validate all user input in CLI commands
- MCP server runs locally by default (stdio transport)
- SSE transport should use localhost or be behind auth

## Useful Documentation

- `docs/ARCHITECTURE.md` - System architecture
- `docs/CONFIGURATION.md` - Configuration reference
- `docs/MCP.md` - MCP integration guide
- `docs/CONTRIBUTING.md` - Contribution guidelines
- `docs/CLI_REFERENCE.md` - Complete CLI reference
- `docs/MEMORY_MODEL.md` - Memory model details
- `docs/EMBEDDINGS.md` - Embeddings system
- `docs/STORAGE.md` - Storage implementation

## Quick Development Checklist

Before pushing:

- [ ] Run `make fmt` - Format code
- [ ] Run `make lint` - Check linting
- [ ] Run `make test` - All tests pass
- [ ] Run `make test-race` - No race conditions
- [ ] Update documentation if adding features
- [ ] Add tests for new code
- [ ] Update CHANGELOG.md if user-facing changes

## Environment Variables

Quick reference for common environment variables:

```bash
# Storage
CORTEX_STORAGE_PATH=~/.local/share/cortex-ai

# Embeddings
CORTEX_EMBEDDINGS_ENDPOINT=http://localhost:11434
CORTEX_EMBEDDINGS_MODEL=nomic-embed-text
CORTEX_EMBEDDINGS_TIMEOUT=30s

# Search
CORTEX_SEARCH_TOP_K=5
CORTEX_SEARCH_MIN_SCORE=0.5

# Consolidation
CORTEX_CONSOLIDATION_SIMILARITY_THRESHOLD=0.85
CORTEX_CONSOLIDATION_AUTO_TRANSFER=true

# Autoprune
CORTEX_AUTOPRUNE_DUPLICATES_THRESHOLD=0.92
CORTEX_AUTOPRUNE_EPISODIC_RETENTION_DAYS=90
CORTEX_AUTOPRUNE_SEMANTIC_MERGE_THRESHOLD=0.88

# Session
CORTEX_SESSION_AUTO_DERIVE=true
CORTEX_SESSION_PATTERN_TYPE=prefix
CORTEX_SESSION_MAX_SEGMENTS=2
CORTEX_SESSION_PREFIX=session-
CORTEX_SESSION_SEPARATOR=-
```

## Troubleshooting Common Issues

### Ollama Connection Errors

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Pull model
ollama pull nomic-embed-text
```

### Storage Permission Errors

```bash
# Check storage directory
ls -la ~/.local/share/cortex-ai/

# Create if missing
mkdir -p ~/.local/share/cortex-ai
```

### Test Failures

```bash
# Run single test with verbose output
go test -v ./internal/memory -run TestCreate

# Run with race detector
go test -race ./internal/memory

# Clear test cache and re-run
go clean -testcache && go test ./...
```

## Additional Notes

- The codebase follows Go project layout conventions
- Use `make` for all build operations
- Keep dependencies minimal (currently only 5 direct deps)
- MCP integration is a key feature - maintain compatibility
- Documentation should stay in sync with code changes
