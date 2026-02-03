# Cortex - Memory Model

## Memory Structure

```mermaid
classDiagram
    class Memory {
        +string ID
        +MemoryLevel Level
        +string Title
        +string Content
        +[]string Tags
        +[]float64 Embedding
        +MemoryContext Context
        +time.Time CreatedAt
        +time.Time UpdatedAt
        +[]string MergedFrom
        +bool Obsolete
    }

    class MemoryLevel {
        <<enumeration>>
        working
        episodic
        semantic
    }

    class MemoryContext {
        +string TaskID
        +string SessionID
        +time.Time Timestamp
        +string Author
        +[]string Tags
        +string Source
        +[]string RelatedMemories
    }

    Memory --> MemoryLevel
    Memory --> MemoryContext
```

## Three-Layer Architecture

```mermaid
graph TB
    subgraph "Memory Layers"
        W[Working Memory<br/>🕐 Session-scoped<br/>Temporary]
        E[Episodic Memory<br/>📅 Time-bound<br/>90 days retention]
        S[Semantic Memory<br/>📚 Permanent<br/>Forever]
    end

    subgraph "Search Flow"
        Q[Query] --> EMB[Embedder]
        EMB --> VS[Vector Search]
        VS --> W
        VS --> E
        VS --> S
        W --> R[Ranked Results]
        E --> R
        S --> R
    end

    subgraph "Lifecycle"
        NEW[New Info] --> W
        W -->|transfer-working| E
        E -->|Abstraction| S
    end
```

## Layer Characteristics

### Working Memory
- **Scope**: Session-specific
- **Retention**: Until session ends or explicit transfer
- **Use case**: Current task context, temporary notes
- **Requires**: `--session` flag

### Episodic Memory
- **Scope**: Time-bound events
- **Retention**: Configurable (default 90 days)
- **Use case**: Bug fixes, decisions, completed tasks
- **Auto-cleanup**: Via `autoprune --archive-episodic`

### Semantic Memory
- **Scope**: Permanent knowledge
- **Retention**: Forever (unless manually deleted)
- **Use case**: Conventions, patterns, best practices
- **Optimization**: Via `autoprune --merge-semantic`
