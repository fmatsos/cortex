# Cortex AI - Architecture Documentation

This document provides a comprehensive overview of the Cortex AI architecture, including system design, component interactions, and data flows.

## Table of Contents

- [System Overview](#system-overview)
- [High-Level Architecture](#high-level-architecture)
- [Component Details](#component-details)
- [Data Flow](#data-flow)
- [Package Structure](#package-structure)
- [Design Patterns](#design-patterns)
- [Technical Decisions](#technical-decisions)

---

## System Overview

Cortex AI is a CLI tool that provides **persistent semantic memory** for AI coding agents. It enables LLMs to recall past solutions, problems, and project-specific rules across sessions using vector embeddings and local storage.

### Key Characteristics

| Attribute | Value |
|-----------|-------|
| Language | Go 1.24+ |
| Module | `github.com/cortex-ai/cortex-ai` |
| CLI Framework | Cobra |
| Configuration | Viper |
| Embedding Provider | Ollama (local) |
| Storage Backends | Gob (default), SQLite (planned) |
| Protocol | MCP (Model Context Protocol) via JSON-RPC 2.0 |

---

## High-Level Architecture

```mermaid
graph TB
    subgraph "External Interfaces"
        User["User / Developer"]
        Agent["AI Agent<br/>(Claude Code, Cursor, etc.)"]
    end

    subgraph "CLI Layer"
        CLI["Cortex CLI<br/>Cobra Commands"]
        MCP["MCP Server<br/>JSON-RPC 2.0"]
    end

    subgraph "Service Layer"
        MemService["Memory Service<br/>Business Logic"]
        ConfigMgr["Config Manager<br/>Viper"]
    end

    subgraph "Infrastructure"
        Embedder["Embedder<br/>Ollama API"]
        Storage["Storage<br/>Gob Files"]
        Search["Vector Search<br/>Cosine Similarity"]
    end

    subgraph "External Services"
        Ollama["Ollama<br/>Embedding Model"]
        FS["File System<br/>~/.local/share/cortex-ai"]
    end

    User --> CLI
    Agent --> MCP
    CLI --> MemService
    MCP --> MemService

    MemService --> ConfigMgr
    MemService --> Embedder
    MemService --> Storage
    MemService --> Search

    Embedder --> Ollama
    Storage --> FS
```

---

## Component Details

### CLI Layer

The CLI layer provides the user interface through Cobra commands.

```mermaid
graph LR
    subgraph "cortex CLI"
        Root["root"]
        Root --> Create["create"]
        Root --> Search["search"]
        Root --> List["list"]
        Root --> Get["get"]
        Root --> Delete["delete"]
        Root --> MarkObs["mark-obsolete"]
        Root --> Export["export"]
        Root --> Import["import"]
        Root --> Config["config"]
        Root --> MCP["start-mcp-server"]
        Root --> Completion["completion"]
    end
```

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `create` | Create a new memory | `--title`, `--type`, `--content`, `--tags` |
| `search` | Semantic search | `--top`, `--min-score`, `--type` |
| `list` | List all memories | `--type`, `--include-obsolete` |
| `get` | Get memory by ID | - |
| `delete` | Delete a memory | - |
| `mark-obsolete` | Soft delete | - |
| `export` | Export to Markdown | `--all`, `--intent`, `--output` |
| `import` | Import from Markdown | `--force`, `--dry-run` |
| `config` | View/edit config | `--show`, `--edit` |
| `start-mcp-server` | Start MCP server | - |
| `completion` | Generate shell completions | `bash`, `zsh`, `fish` |

### Memory Service

The Memory Service (`internal/memory/service.go`) is the core business logic layer.

```mermaid
classDiagram
    class Service {
        <<interface>>
        +Create(ctx, input) Memory, error
        +Search(ctx, query, opts) []SearchResult, error
        +List(ctx, opts) []Memory, error
        +Get(ctx, id) Memory, error
        +Delete(ctx, id) error
        +MarkObsolete(ctx, id) error
    }

    class DefaultService {
        -storage Storage
        -embedder Embedder
        +Create(ctx, input) Memory, error
        +Search(ctx, query, opts) []SearchResult, error
        +List(ctx, opts) []Memory, error
        +Get(ctx, id) Memory, error
        +Delete(ctx, id) error
        +MarkObsolete(ctx, id) error
        -prepareForEmbedding(memory) string
    }

    class Memory {
        +ID string
        +Title string
        +Content string
        +Types []MemoryType
        +Tags []string
        +Embedding []float64
        +CreatedAt time.Time
        +UpdatedAt time.Time
        +Metadata map[string]string
        +Obsolete bool
    }

    class SearchResult {
        +Memory Memory
        +Score float64
    }

    Service <|.. DefaultService
    DefaultService --> Memory
    DefaultService --> SearchResult
```

### Memory Types

```mermaid
graph TB
    subgraph "Memory Types"
        Solution["solution<br/>Fix, workaround, resolution"]
        Issue["issue<br/>Bug, problem, challenge"]
        Analysis["analysis<br/>Investigation, root cause"]
        Rule["rule<br/>Convention, standard, guideline"]
        Any["any<br/>Generic memory"]
    end

    subgraph "Type Combinations"
        Combined1["issue + solution<br/>Problem and its fix"]
        Combined2["issue + analysis + solution<br/>Full investigation"]
        Combined3["rule + analysis<br/>Guideline with rationale"]
    end

    Solution --> Combined1
    Issue --> Combined1
    Issue --> Combined2
    Analysis --> Combined2
    Solution --> Combined2
    Rule --> Combined3
    Analysis --> Combined3
```

### Embedding System

```mermaid
sequenceDiagram
    participant S as Service
    participant E as OllamaEmbedder
    participant O as Ollama API
    participant N as Normalizer

    S->>E: Embed(text)
    E->>E: Prepare request
    E->>O: POST /api/embeddings
    Note over O: model: nomic-embed-text<br/>prompt: text
    O-->>E: { embedding: [...] }
    E->>N: normalize(embedding)
    Note over N: Convert to unit vector
    N-->>E: normalized embedding
    E-->>S: []float64
```

### Storage Layer

```mermaid
classDiagram
    class Storage {
        <<interface>>
        +Save(ctx, memory) error
        +Get(ctx, id) Memory, error
        +List(ctx, opts) []Memory, error
        +Delete(ctx, id) error
        +Update(ctx, memory) error
        +SearchByVector(ctx, vector, topK) []VectorMatch, error
        +Close() error
    }

    class GobStorage {
        -basePath string
        -index *VectorIndex
        -mu sync.RWMutex
        +Save(ctx, memory) error
        +Get(ctx, id) Memory, error
        +List(ctx, opts) []Memory, error
        +Delete(ctx, id) error
        +Update(ctx, memory) error
        +SearchByVector(ctx, vector, topK) []VectorMatch, error
        +Close() error
        -loadIndex() error
        -saveIndex() error
    }

    class VectorIndex {
        +vectors map[string][]float64
        +mu sync.RWMutex
        +Add(id, vector) error
        +Remove(id) error
        +Search(vector, topK) []VectorMatch
    }

    class VectorMatch {
        +MemoryID string
        +Score float64
    }

    Storage <|.. GobStorage
    GobStorage --> VectorIndex
    GobStorage --> VectorMatch
```

### File System Layout

```
~/.local/share/cortex-ai/
├── memories/
│   ├── <uuid-1>.gob      # Serialized Memory struct
│   ├── <uuid-2>.gob
│   └── ...
└── index.gob              # Serialized VectorIndex
```

### MCP Server

```mermaid
sequenceDiagram
    participant C as MCP Client
    participant S as MCP Server
    participant H as Request Handler
    participant MS as Memory Service

    C->>S: initialize
    S-->>C: { capabilities: { tools: {} } }
    C->>S: initialized (notification)

    C->>S: tools/list
    S-->>C: [ cortex_search, cortex_create, ... ]

    C->>S: tools/call { name: "cortex_search", arguments: {...} }
    S->>H: handleToolCall
    H->>MS: Search(query, opts)
    MS-->>H: []SearchResult
    H-->>S: format response
    S-->>C: { content: [...] }

    C->>S: shutdown
    S-->>C: { }
```

---

## Data Flow

### Create Memory Flow

```mermaid
flowchart TD
    A[User: cortex create] --> B{Parse Flags}
    B --> C[Validate Input]
    C --> D{Valid?}
    D -->|No| E[Return Error]
    D -->|Yes| F[Prepare Text for Embedding]
    F --> G[title + content + tags]
    G --> H[Embed via Ollama]
    H --> I[Normalize Vector]
    I --> J[Generate UUID]
    J --> K[Set Timestamps]
    K --> L[Save to Storage]
    L --> M[Update Vector Index]
    M --> N[Return Memory]
```

### Search Memory Flow

```mermaid
flowchart TD
    A[User: cortex search query] --> B[Parse Options]
    B --> C[Embed Query via Ollama]
    C --> D[Normalize Query Vector]
    D --> E[Search Vector Index]
    E --> F[Compute Cosine Similarity]
    F --> G[Sort by Score DESC]
    G --> H[Take Top K]
    H --> I{Apply Filters}
    I --> J[Min Score Filter]
    J --> K[Type Filter]
    K --> L[Obsolete Filter]
    L --> M[Load Full Memories]
    M --> N[Return Search Results]
```

### Export Flow

```mermaid
flowchart TD
    A[cortex export] --> B{Export Type?}

    B -->|Single ID| C[Get Memory by ID]
    C --> D[Export to Markdown]

    B -->|--all| E[List All Memories]
    E --> F[Export Each to Markdown]

    B -->|--intent query| G[Search by Intent]
    G --> H[Generate Synthesis]
    H --> I[Export Synthesis Document]

    D --> J[Write to Output Path]
    F --> J
    I --> J
```

### Import Flow

```mermaid
flowchart TD
    A[cortex import files...] --> B[Parse Each File]
    B --> C{Valid Frontmatter?}
    C -->|No| D[Report Error]
    C -->|Yes| E{Has ID?}
    E -->|No| F[Generate New UUID]
    E -->|Yes| G{ID Exists?}
    G -->|Yes| H{--force?}
    H -->|No| I[Skip / Error]
    H -->|Yes| J[Update Existing]
    G -->|No| K[Create New]
    F --> K
    K --> L[Generate Embedding]
    J --> L
    L --> M[Save to Storage]
    M --> N[Report Success]
```

---

## Package Structure

```mermaid
graph TB
    subgraph "cmd/"
        main["cortex/main.go<br/>Entry Point"]
    end

    subgraph "internal/"
        cli["cli/<br/>Cobra Commands"]
        memory["memory/<br/>Domain Model"]
        storage["storage/<br/>Persistence"]
        embeddings["embeddings/<br/>Vector Generation"]
        search["search/<br/>Similarity Algorithms"]
        config["config/<br/>Configuration"]
        mcp["mcp/<br/>MCP Protocol"]
    end

    subgraph "pkg/"
        markdown["markdown/<br/>Import/Export"]
        json["json/<br/>JSON Format"]
    end

    main --> cli
    cli --> memory
    cli --> config
    cli --> mcp

    memory --> storage
    memory --> embeddings
    memory --> search

    mcp --> memory

    cli --> markdown
    cli --> json
```

### Package Dependencies

```mermaid
graph LR
    subgraph "External"
        cobra["github.com/spf13/cobra"]
        viper["github.com/spf13/viper"]
        uuid["github.com/google/uuid"]
        yaml["gopkg.in/yaml.v3"]
    end

    subgraph "Internal"
        cli["internal/cli"]
        memory["internal/memory"]
        storage["internal/storage"]
        embeddings["internal/embeddings"]
        search["internal/search"]
        config["internal/config"]
        mcp["internal/mcp"]
    end

    cli --> cobra
    config --> viper
    memory --> uuid
    markdown --> yaml

    memory --> storage
    memory --> embeddings
    storage --> search
```

---

## Design Patterns

### Repository Pattern
Storage interface abstracts the persistence mechanism.

```go
type Storage interface {
    Save(ctx context.Context, memory *Memory) error
    Get(ctx context.Context, id string) (*Memory, error)
    // ...
}
```

### Service Layer Pattern
MemoryService encapsulates business logic and coordinates dependencies.

### Dependency Injection
Constructor-based DI for testability.

```go
func NewService(storage Storage, embedder Embedder) *DefaultService {
    return &DefaultService{
        storage:  storage,
        embedder: embedder,
    }
}
```

### Strategy Pattern
Pluggable storage backends and embedding providers.

### Command Pattern
Cobra commands as command objects with standardized execution.

---

## Technical Decisions

### Why Gob Storage?

| Advantage | Description |
|-----------|-------------|
| Zero dependencies | No external database required |
| Fast serialization | Native Go binary encoding |
| Simple backup | Just copy files |
| Version control | Can track memory files in git |

### Why Ollama?

| Advantage | Description |
|-----------|-------------|
| Privacy | All data stays local |
| Free | No API costs |
| Fast | Local inference |
| Offline | Works without internet |

### Why Cosine Similarity?

| Advantage | Description |
|-----------|-------------|
| Standard | Industry standard for text embeddings |
| Normalized | Independent of vector magnitude |
| Efficient | Simple dot product computation |
| Range | Clear 0-1 similarity range |

---

## Related Documentation

- [README.md](../README.md) - Getting started guide
- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration reference
- [MCP.md](./MCP.md) - MCP integration guide
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
