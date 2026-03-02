# Cortex - Architecture

This document provides a comprehensive overview of Cortex's system architecture, component design, and data flow.

## Table of Contents

- [System Overview](#system-overview)
- [Architectural Layers](#architectural-layers)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Memory System Architecture](#memory-system-architecture)
- [Storage Architecture](#storage-architecture)
- [MCP Integration](#mcp-integration)
- [Design Decisions](#design-decisions)

---

## System Overview

Cortex is a **three-layer semantic memory system** for AI assistants, implementing a clean architecture with clear separation of concerns.

```mermaid
graph TB
    subgraph "Presentation Layer"
        CLI[CLI Commands<br/>Cobra Framework]
        MCP[MCP Server<br/>JSON-RPC 2.0]
    end

    subgraph "Application Layer"
        MS[Memory Service]
        CS[Consolidation Service]
        AS[Autoprune Service]
    end

    subgraph "Domain Layer"
        DM[Domain Models<br/>Memory, Context, Level]
        BL[Business Logic<br/>Validation, Rules]
    end

    subgraph "Infrastructure Layer"
        ST[Storage<br/>GobStorage]
        EM[Embeddings<br/>Ollama Client]
        SE[Search<br/>Cosine Similarity]
        CF[Config<br/>Viper]
    end

    CLI --> MS
    CLI --> CS
    CLI --> AS
    MCP --> MS
    MCP --> CS

    MS --> DM
    MS --> ST
    MS --> EM
    MS --> SE

    CS --> MS
    AS --> MS

    ST --> CF
    EM --> CF

    style CLI fill:#fff4e6,stroke:#fd7e14,stroke-width:2px
    style MCP fill:#fff4e6,stroke:#fd7e14,stroke-width:2px
    style MS fill:#e7f5ff,stroke:#228be6,stroke-width:2px
    style CS fill:#e7f5ff,stroke:#228be6,stroke-width:2px
    style AS fill:#e7f5ff,stroke:#228be6,stroke-width:2px
    style DM fill:#d3f9d8,stroke:#37b24d,stroke-width:2px
    style BL fill:#d3f9d8,stroke:#37b24d,stroke-width:2px
```

### Key Characteristics

- **Layered Architecture**: Clear separation between presentation, application, domain, and infrastructure
- **Dependency Injection**: Services receive dependencies via constructors
- **Interface-Based Design**: Infrastructure components implement interfaces for testability
- **Context-Aware**: All I/O operations accept `context.Context` for cancellation and timeout
- **Thread-Safe**: Concurrent operations protected by appropriate synchronization primitives

---

## Architectural Layers

### 1. Presentation Layer

**Purpose**: Handle user interaction and external communication

**Components**:
- **CLI Commands** (`internal/cli/`)
  - Cobra command definitions
  - Flag parsing and validation
  - User-facing error messages
  - Output formatting (text/JSON)

- **MCP Server** (`internal/mcp/`)
  - JSON-RPC 2.0 protocol implementation
  - Tool definitions and handlers
  - Transport abstraction (stdio/SSE)
  - MCP specification compliance

**Responsibilities**:
- Parse and validate user input
- Format and display output
- Handle protocol-specific concerns
- Translate between external and internal representations

### 2. Application Layer

**Purpose**: Coordinate business operations and use cases

**Components**:
- **Memory Service** (`internal/memory/service.go`)
  - CRUD operations for memories
  - Semantic search orchestration
  - Embedding generation coordination
  - Memory lifecycle management

- **Consolidation Service** (`internal/consolidation/service.go`)
  - Duplicate detection
  - Memory merging logic
  - Similarity threshold enforcement
  - Multi-level consolidation

- **Autoprune Service** (`internal/consolidation/autoprune.go`)
  - Duplicate cleanup
  - Episodic memory archiving
  - Semantic memory merging
  - Batch optimization

**Responsibilities**:
- Implement use cases
- Coordinate between domain and infrastructure
- Enforce business rules
- Manage transactions and error handling

### 3. Domain Layer

**Purpose**: Define core business entities and rules

**Components**:
- **Memory Model** (`internal/memory/types.go`)
  ```go
  type Memory struct {
      ID         string        // UUID identifier
      Level      MemoryLevel   // working|episodic|semantic
      Title      string        // Human-readable title
      Content    string        // Full content (Markdown supported)
      Tags       []string      // Categorization tags
      Embedding  []float64     // Vector representation
      Context    MemoryContext // Metadata and relationships
      CreatedAt  time.Time     // Creation timestamp
      UpdatedAt  time.Time     // Last modification
      MergedFrom []string      // Source memory IDs (for consolidation)
      Obsolete   bool          // Soft delete flag
  }
  ```

- **Memory Level Enum**
  ```go
  type MemoryLevel string
  const (
      LevelWorking  MemoryLevel = "working"   // Session-scoped
      LevelEpisodic MemoryLevel = "episodic"  // Time-bound
      LevelSemantic MemoryLevel = "semantic"  // Permanent
  )
  ```

- **Memory Context**
  ```go
  type MemoryContext struct {
      TaskID          string    // Associated task/ticket
      SessionID       string    // Development session
      Timestamp       time.Time // Event timestamp
      Author          string    // Creator identity
      Tags            []string  // Additional categorization
      Source          string    // Origin (manual|auto|llm)
      RelatedMemories []string  // Connected memory IDs
  }
  ```

**Responsibilities**:
- Define core entities
- Enforce domain invariants
- Encapsulate business logic
- Provide domain services

### 4. Infrastructure Layer

**Purpose**: Implement technical capabilities

**Components**:

#### Storage (`internal/storage/`)

```mermaid
classDiagram
    class Storage {
        <<interface>>
        +Save(ctx, memory) error
        +Get(ctx, id) (*Memory, error)
        +List(ctx, opts) ([]*Memory, error)
        +Delete(ctx, id) error
        +Update(ctx, memory) error
        +SearchAllLayers(ctx, vector, opts) ([]*SearchResult, error)
        +TransferWorkingToEpisodic(ctx, sessionID) (int, error)
        +Close() error
    }

    class GobStorage {
        -path string
        -mu sync.RWMutex
        -persistentIndex map[string]*Memory
        -workingIndex map[string]map[string]*Memory
        +NewGobStorage(path) *GobStorage
        -load() error
        -save() error
        -loadWorking(sessionID) error
        -saveWorking(sessionID) error
    }

    Storage <|.. GobStorage
```

#### Embeddings (`internal/embeddings/`)

```mermaid
classDiagram
    class Embedder {
        <<interface>>
        +Embed(ctx, text) ([]float64, error)
        +EmbedBatch(ctx, texts) ([][]float64, error)
        +Dimension() int
    }

    class OllamaEmbedder {
        -endpoint string
        -model string
        -timeout time.Duration
        -client *http.Client
        +NewOllamaEmbedder(cfg) *OllamaEmbedder
        -makeRequest(ctx, prompt) ([]float64, error)
        -normalize(vector) []float64
    }

    Embedder <|.. OllamaEmbedder
```

#### Search (`internal/search/`)

```mermaid
classDiagram
    class CosineSimilarity {
        <<function>>
        +CosineSimilarity(a, b []float64) float64
    }

    class SearchOptions {
        +TopK int
        +MinScore float64
        +Level MemoryLevel
        +SessionID string
        +IncludeObsolete bool
    }

    class SearchResult {
        +Memory *Memory
        +Score float64
    }
```

**Responsibilities**:
- Implement storage mechanisms
- Provide embedding generation
- Execute similarity search
- Manage configuration
- Handle external integrations

---

## Core Components

### Memory Service

The central orchestrator for all memory operations.

```mermaid
sequenceDiagram
    participant CLI as CLI Command
    participant MS as Memory Service
    participant EM as Embedder
    participant ST as Storage

    CLI->>MS: Create(ctx, memory)
    MS->>MS: Validate(memory)
    MS->>EM: Embed(ctx, title+content+tags)
    EM-->>MS: vector
    MS->>MS: Normalize(vector)
    MS->>ST: Save(ctx, memory)
    ST-->>MS: nil (success)
    MS-->>CLI: memory.ID, nil
```

**Key Methods**:
- `Create(ctx, memory)` - Create new memory with embeddings
- `Search(ctx, query, opts)` - Semantic search across layers
- `Get(ctx, id)` - Retrieve memory by ID
- `List(ctx, opts)` - List with filtering
- `Update(ctx, memory)` - Update existing memory
- `Delete(ctx, id)` - Permanent deletion
- `MarkObsolete(ctx, id)` - Soft deletion

### Consolidation Service

Handles memory consolidation with duplicate detection.

```mermaid
flowchart TD
    A[New Content] --> B[Generate Embedding]
    B --> C{Search Similar<br/>Score >= 0.85?}
    C -->|Yes| D{Force Flag?}
    C -->|No| E[Create New Memory]
    D -->|No| F[Merge with Existing]
    D -->|Yes| E
    F --> G[Update Memory]
    E --> H[Save Memory]
    G --> H
    H --> I[Return Result]

    style C fill:#e7f5ff,stroke:#228be6
    style D fill:#fff4e6,stroke:#fd7e14
    style F fill:#d3f9d8,stroke:#37b24d
    style E fill:#d3f9d8,stroke:#37b24d
```

**Consolidation Result**:
```go
type ConsolidationResult struct {
    Action     string  // "created" | "merged"
    MemoryID   string  // Resulting memory ID
    Level      string  // Memory level
    Similarity float64 // Similarity score (if merged)
    Message    string  // Human-readable description
}
```

### Autoprune Service

Automated memory maintenance and optimization.

```mermaid
flowchart TD
    Start[Start Autoprune] --> CheckDups[Check Duplicates]
    CheckDups --> Dups{Found Duplicates<br/>Score >= 0.92?}
    Dups -->|Yes| RemoveDups[Remove Duplicates]
    Dups -->|No| CheckEpisodic[Check Episodic Age]

    RemoveDups --> CheckEpisodic
    CheckEpisodic --> Old{Older than<br/>90 days?}
    Old -->|Yes| Archive[Archive/Delete]
    Old -->|No| CheckSemantic[Check Semantic Similarity]

    Archive --> CheckSemantic
    CheckSemantic --> Similar{Similar Semantic<br/>Score >= 0.88?}
    Similar -->|Yes| Merge[Merge Semantic]
    Similar -->|No| Done[Done]

    Merge --> Done

    style CheckDups fill:#e7f5ff,stroke:#228be6
    style CheckEpisodic fill:#e7f5ff,stroke:#228be6
    style CheckSemantic fill:#e7f5ff,stroke:#228be6
    style Done fill:#d3f9d8,stroke:#37b24d
```

**Autoprune Operations**:
1. **Remove Duplicates**: Similarity >= 0.92
2. **Archive Episodic**: Age > retention period (default 90 days)
3. **Merge Semantic**: Similarity >= 0.88

---

## Data Flow

### Create Memory Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant MemoryService
    participant Embedder
    participant Storage

    User->>CLI: cortex create --title "..." --content "..."
    CLI->>CLI: Parse flags & validate input
    CLI->>MemoryService: Create(ctx, memory)
    MemoryService->>MemoryService: Validate memory (min lengths, level)
    MemoryService->>Embedder: Embed(ctx, text)
    Embedder->>Embedder: Call Ollama API
    Embedder-->>MemoryService: vector [768]float64
    MemoryService->>MemoryService: Normalize vector
    MemoryService->>Storage: Save(ctx, memory)
    Storage->>Storage: Add to index
    Storage->>Storage: Write to disk (memories.gob or working/*.gob)
    Storage-->>MemoryService: nil (success)
    MemoryService-->>CLI: memory, nil
    CLI->>CLI: Format output
    CLI-->>User: Success message with ID
```

### Search Memory Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant MemoryService
    participant Embedder
    participant Storage
    participant Search

    User->>CLI: cortex search "query text"
    CLI->>CLI: Parse query & options
    CLI->>MemoryService: Search(ctx, query, opts)
    MemoryService->>Embedder: Embed(ctx, query)
    Embedder-->>MemoryService: queryVector
    MemoryService->>Storage: SearchAllLayers(ctx, queryVector, opts)

    Storage->>Storage: Search persistent memories
    Storage->>Storage: Search working memories

    loop For each memory
        Storage->>Search: CosineSimilarity(queryVector, memVector)
        Search-->>Storage: score
    end

    Storage->>Storage: Filter by min_score
    Storage->>Storage: Sort by score (descending)
    Storage->>Storage: Take top_k results
    Storage-->>MemoryService: []*SearchResult
    MemoryService-->>CLI: results, nil
    CLI->>CLI: Format results
    CLI-->>User: Ranked memories with scores
```

### Transfer Working Memory Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Storage

    User->>CLI: cortex transfer-working --session dev-123
    CLI->>Storage: TransferWorkingToEpisodic(ctx, "dev-123")
    Storage->>Storage: Load working/session-dev-123.gob

    loop For each working memory
        Storage->>Storage: Change level to episodic
        Storage->>Storage: Add to persistent index
    end

    Storage->>Storage: Save memories.gob
    Storage->>Storage: Delete working/session-dev-123.gob
    Storage-->>CLI: count, nil
    CLI-->>User: "Transferred N memories"
```

---

## Memory System Architecture

### Three-Layer Hierarchy

```mermaid
graph TB
    subgraph "Layer 1: Working Memory"
        W1[Session: dev-2024]
        W2[Session: bugfix-auth]
        W3[Session: feature-x]
        style W1 fill:#fff4e6,stroke:#fd7e14
        style W2 fill:#fff4e6,stroke:#fd7e14
        style W3 fill:#fff4e6,stroke:#fd7e14
    end

    subgraph "Layer 2: Episodic Memory"
        E1[Bug Fix: Auth timeout]
        E2[Decision: Use Redis]
        E3[Meeting: Architecture review]
        style E1 fill:#e7f5ff,stroke:#228be6
        style E2 fill:#e7f5ff,stroke:#228be6
        style E3 fill:#e7f5ff,stroke:#228be6
    end

    subgraph "Layer 3: Semantic Memory"
        S1[Convention: Context timeout]
        S2[Pattern: Retry with backoff]
        S3[Architecture: Microservices]
        style S1 fill:#d3f9d8,stroke:#37b24d
        style S2 fill:#d3f9d8,stroke:#37b24d
        style S3 fill:#d3f9d8,stroke:#37b24d
    end

    W1 -->|Session End| E1
    W2 -->|Transfer| E2
    W3 -->|Complete| E3

    E1 -.->|Abstraction| S1
    E2 -.->|Pattern Extraction| S2
    E3 -.->|Document| S3

    Time[Time] -.->|90 days| Archive[(Archive)]
    E1 -.-> Time
    E2 -.-> Time
    E3 -.-> Time
```

### Memory Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Working: Create with --level working
    [*] --> Episodic: Create with --level episodic
    [*] --> Semantic: Create with --level semantic

    Working --> Episodic: transfer-working
    Working --> Deleted: delete

    Episodic --> Archived: Age > retention
    Episodic --> Semantic: Abstraction
    Episodic --> Obsolete: mark-obsolete
    Episodic --> Deleted: delete

    Semantic --> Merged: Consolidation
    Semantic --> Obsolete: mark-obsolete
    Semantic --> Deleted: delete

    Obsolete --> Deleted: autoprune --remove-obsolete
    Archived --> Deleted: autoprune --archive-episodic

    Deleted --> [*]
```

---

## Storage Architecture

### File Organization

```mermaid
graph TB
    subgraph "Storage Directory: .agents/cortex/"
        Main[memories.gob<br/>Episodic + Semantic]

        subgraph "Working Directory"
            W1[session-abc123.gob]
            W2[session-def456.gob]
            WN[session-xyz789.gob]
        end

        Config[config.yaml]
    end

    Main --> Episodic[(Episodic Memories)]
    Main --> Semantic[(Semantic Memories)]

    W1 --> Working1[(Working: session-abc123)]
    W2 --> Working2[(Working: session-def456)]
    WN --> WorkingN[(Working: session-xyz789)]

    style Main fill:#e7f5ff,stroke:#228be6,stroke-width:2px
    style W1 fill:#fff4e6,stroke:#fd7e14
    style W2 fill:#fff4e6,stroke:#fd7e14
    style WN fill:#fff4e6,stroke:#fd7e14
```

### GobStorage Implementation

```mermaid
classDiagram
    class GobStorage {
        -path string
        -mu sync.RWMutex
        -persistentIndex map~string~*Memory
        -workingIndex map~string~map~string~*Memory
        -vectorIndex []vectorEntry

        +NewGobStorage(path) *GobStorage
        +Save(ctx, m) error
        +Get(ctx, id) (*Memory, error)
        +List(ctx, opts) ([]*Memory, error)
        +Delete(ctx, id) error
        +SearchAllLayers(ctx, vector, opts) ([]*SearchResult, error)
        +TransferWorkingToEpisodic(ctx, sessionID) (int, error)
        +Close() error

        -load() error
        -save() error
        -loadWorking(sessionID) error
        -saveWorking(sessionID) error
        -buildVectorIndex()
        -searchWithVector(vector, opts) []*SearchResult
    }

    class vectorEntry {
        +id string
        +vector []float64
        +level MemoryLevel
        +sessionID string
    }

    GobStorage --> vectorEntry
```

**Key Features**:
- **Thread-Safe**: Uses `sync.RWMutex` for concurrent access
- **In-Memory Index**: Fast lookups without disk I/O
- **Separate Files**: Working memories isolated by session
- **Vector Index**: Optimized for similarity search
- **Lazy Loading**: Working files loaded on-demand

---

## MCP Integration

### MCP Server Architecture

```mermaid
graph TB
    subgraph "MCP Server"
        Server[MCP Server]
        Protocol[JSON-RPC 2.0 Handler]
        Tools[Tool Registry]
    end

    subgraph "Transports"
        Stdio[Stdio Transport<br/>stdin/stdout]
        SSE[SSE Transport<br/>HTTP Server]
    end

    subgraph "Tools"
        T1[cortex_search]
        T2[cortex_create]
        T3[cortex_consolidate]
        T4[cortex_list]
        T5[cortex_get]
        T6[cortex_choose_memory_layer]
        T7[cortex_choose_working_consolidation]
    end

    subgraph "Services"
        MS[Memory Service]
        CS[Consolidation Service]
    end

    Client1[Claude Code] --> Stdio
    Client2[Cursor] --> Stdio
    Client3[Web Client] --> SSE

    Stdio --> Server
    SSE --> Server
    Server --> Protocol
    Protocol --> Tools

    Tools --> T1
    Tools --> T2
    Tools --> T3
    Tools --> T4
    Tools --> T5
    Tools --> T6
    Tools --> T7

    T1 --> MS
    T2 --> MS
    T3 --> CS
    T4 --> MS
    T5 --> MS

    style Server fill:#e7f5ff,stroke:#228be6,stroke-width:2px
    style Stdio fill:#fff4e6,stroke:#fd7e14
    style SSE fill:#fff4e6,stroke:#fd7e14
```

### MCP Protocol Flow

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Transport as Transport Layer
    participant Server as MCP Server
    participant Tool as Tool Handler
    participant Service as Memory Service

    Client->>Transport: Initialize connection
    Transport->>Server: initialize request
    Server-->>Transport: capabilities
    Transport-->>Client: Server info

    Client->>Transport: tools/list request
    Transport->>Server: List available tools
    Server-->>Transport: Tool schemas
    Transport-->>Client: Tool list

    Client->>Transport: tools/call (cortex_search)
    Transport->>Server: Execute tool
    Server->>Tool: cortex_search handler
    Tool->>Service: Search(ctx, query, opts)
    Service-->>Tool: results
    Tool-->>Server: Tool result
    Server-->>Transport: JSON-RPC response
    Transport-->>Client: Search results
```

---

## Design Decisions

### Why Three Memory Layers?

**Rationale**: Mimics human memory systems (working, episodic, semantic)

**Benefits**:
- **Working**: Fast, temporary context for active sessions
- **Episodic**: Time-bound events with automatic cleanup
- **Semantic**: Permanent knowledge without clutter

**Trade-offs**:
- More complexity than flat storage
- Requires user understanding of levels
- Additional transfer operations

### Why Gob Storage?

**Rationale**: Simple, efficient, Go-native serialization

**Benefits**:
- No external dependencies
- Type-safe serialization
- Fast encoding/decoding
- Single-file simplicity

**Trade-offs**:
- Go-specific format
- No cross-language compatibility
- Not human-readable
- Limited query capabilities

**Future**: SQLite for advanced queries and larger datasets

### Why Ollama for Embeddings?

**Rationale**: Local-first, privacy-preserving, cost-effective

**Benefits**:
- Runs locally (no cloud costs)
- Privacy (no data leaves machine)
- Fast inference
- Offline capability
- Free and open source

**Trade-offs**:
- Requires Ollama installation
- Limited to Ollama-supported models
- Requires disk space and compute

### Why Cosine Similarity?

**Rationale**: Standard for semantic similarity in embedding spaces

**Benefits**:
- Well-understood metric
- Normalized to [0, 1] range
- Efficient computation
- Handles different vector magnitudes

**Trade-offs**:
- Linear search (O(n) for n memories)
- No spatial indexing (yet)

**Future**: Consider HNSW or Annoy for > 10k memories

### Why In-Memory Index?

**Rationale**: Fast search for small-to-medium datasets

**Benefits**:
- O(1) lookups by ID
- Fast similarity search
- Simple implementation
- No index maintenance overhead

**Trade-offs**:
- Memory usage scales with dataset
- Cold start requires loading
- Not suitable for 100k+ memories

**Threshold**: Consider disk-based index at 50k+ memories

---

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Create | O(E + W) | E = embedding time, W = disk write |
| Get by ID | O(1) | In-memory hash lookup |
| Search | O(N·D) | N = memories, D = vector dimension |
| List | O(N) | Linear scan with filter |
| Delete | O(1 + W) | Hash delete + disk write |
| Transfer | O(M·W) | M = memories to transfer |

### Space Complexity

| Component | Complexity | Notes |
|-----------|------------|-------|
| Memory Index | O(N) | N = total memories |
| Vector Index | O(N·D) | D = vector dimension (768) |
| Gob Files | O(N·S) | S = average memory size |

### Bottlenecks

1. **Embedding Generation**: 100-500ms per request (Ollama latency)
2. **Disk I/O**: File writes block (mitigated by in-memory index)
3. **Search**: Linear scan of all vectors

### Optimization Strategies

1. **Batch Embeddings**: Use `EmbedBatch` for bulk operations
2. **Lazy Loading**: Load working files on-demand
3. **Concurrent Search**: Can parallelize similarity computation
4. **Caching**: Ollama caches model in memory

---

## Related Documentation

- **[Storage Implementation](storage.md)** - Detailed storage design
- **[Embeddings System](embeddings.md)** - Vector generation details
- **[Memory Model](memory-model.md)** - Domain model specification
- **[MCP Integration](../cli/mcp.md)** - MCP server implementation
- **[Development Guide](../contributing/development.md)** - Contributing to architecture

---

**Last Updated**: 2026-02-04
**Architecture Version**: 1.0 (Three-layer system with consolidation)
