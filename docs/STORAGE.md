# Cortex - Storage System Documentation

Documentation for the storage layer and different backend implementations.

## Table of Contents

- [Overview](#overview)
- [Storage Interface](#storage-interface)
- [Gob Storage (Default)](#gob-storage-default)
- [File Organization](#file-organization)
- [Vector Indexing](#vector-indexing)
- [Thread Safety](#thread-safety)
- [Performance Characteristics](#performance-characteristics)
- [Future Storage Backends](#future-storage-backends)

---

## Overview

The storage layer is responsible for persisting memories and their vector embeddings to disk. Cortex uses a modular storage architecture that allows for different backend implementations.

### Current Backends

| Backend | Status | Use Case |
|---------|--------|----------|
| **Gob** (default) | Stable | Single-user, local development, simple deployments |
| **SQLite** | Planned | Larger datasets, more advanced queries |
| **PostgreSQL** | Planned | Multi-user deployments, cloud environments |

---

## Storage Interface

All storage backends implement the `Storage` interface:

```go
type Storage interface {
    // Save a new memory to storage
    Save(ctx context.Context, memory *memory.Memory) error

    // Get a memory by ID
    Get(ctx context.Context, id string) (*memory.Memory, error)

    // List memories with optional filtering
    List(ctx context.Context, opts ListOptions) ([]*memory.Memory, error)

    // Update an existing memory
    Update(ctx context.Context, memory *memory.Memory) error

    // Delete a memory by ID
    Delete(ctx context.Context, id string) error

    // Search by vector similarity
    SearchByVector(ctx context.Context, vector []float64, topK int) ([]*VectorMatch, error)

    // Close storage and release resources
    Close() error
}

type ListOptions struct {
    Type            string   // Filter by memory type
    Tags            []string // Filter by tags
    IncludeObsolete bool     // Include soft-deleted memories
    Limit           int      // Maximum results
    Offset          int      // Pagination offset
}

type VectorMatch struct {
    MemoryID string  // UUID of the matching memory
    Score    float64 // Cosine similarity score (0-1)
}
```

---

## Gob Storage (Default)

Gob storage uses Go's `encoding/gob` package to serialize memories directly to the filesystem.

### Characteristics

- **Serialization:** Go's built-in gob encoding
- **Storage:** Individual `.gob` files per memory
- **Index:** Separate vector index file (`index.gob`)
- **Thread-safe:** Yes, uses `sync.RWMutex`
- **Dependencies:** None (part of Go stdlib)
- **Performance:** Fast for small-medium datasets (<10k memories)

### Configuration

```yaml
storage:
  backend: gob
  path: ~/.local/share/cortex-ai
```

Or via environment variable:

```bash
CORTEX_STORAGE_BACKEND=gob
CORTEX_STORAGE_PATH=~/.local/share/cortex-ai
```

### File Structure

```
~/.local/share/cortex-ai/
├── memories/
│   ├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.gob
│   ├── b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7.gob
│   ├── ...
│   └── {uuid}.gob
└── index.gob
```

### Memory Files

Each `.gob` file contains a single serialized `Memory` struct:

```
{memory_uuid}.gob
├── ID: string
├── Title: string
├── Content: string
├── Types: []MemoryType
├── Tags: []string
├── Embedding: []float64 (768 dims for nomic-embed-text)
├── CreatedAt: time.Time
├── UpdatedAt: time.Time
├── Metadata: map[string]string
└── Obsolete: bool
```

### Index File

The `index.gob` file contains a `VectorIndex` structure for fast vector search:

```go
type VectorIndex struct {
    vectors map[string][]float64 // memory_id -> vector
    mu      sync.RWMutex
}
```

The index is:
- Loaded into memory at startup
- Kept in sync with filesystem updates
- Serialized to disk after each modification

### Operations

#### Save (Create)

1. Generate UUID (if not provided)
2. Set timestamps
3. Serialize to `{uuid}.gob`
4. Add vector to in-memory index
5. Persist index to `index.gob`

**Time Complexity:** O(n) - must rewrite entire index file

#### Get (Read)

1. Load and deserialize `{uuid}.gob`
2. Return Memory struct

**Time Complexity:** O(1) - direct file access

#### Update

1. Deserialize existing memory
2. Update fields
3. Re-serialize to same file
4. Update index if embedding changed
5. Persist index to disk

**Time Complexity:** O(n) - must rewrite entire index file if vector changed

#### Delete

1. Remove `{uuid}.gob` file
2. Remove from in-memory index
3. Persist updated index to `index.gob`

**Time Complexity:** O(n) - must rewrite entire index file

#### SearchByVector

1. Load index from memory
2. Compute cosine similarity for all vectors
3. Sort by score descending
4. Return top K matches

**Time Complexity:** O(m log k) where m = total vectors, k = top K

---

## File Organization

### Best Practices

1. **Backup:** Regularly backup the `~/.local/share/cortex-ai/` directory
2. **Version Control:** You can optionally track memories in git
3. **Permissions:** Directory should be readable/writable by user only (600)

### Backup Strategies

**Simple copy:**
```bash
cp -r ~/.local/share/cortex-ai/ ~/backups/cortex-ai-backup-$(date +%Y%m%d)/
```

**With compression:**
```bash
tar -czf ~/backups/cortex-ai-$(date +%Y%m%d).tar.gz ~/.local/share/cortex-ai/
```

**Automated (cron):**
```bash
0 2 * * * cp -r ~/.local/share/cortex-ai/ ~/backups/cortex-ai-$(date +\%Y\%m\%d)/
```

---

## Vector Indexing

### Index Structure

The vector index is a simple in-memory map with disk persistence:

```go
type VectorIndex struct {
    vectors map[string][]float64 // memory_id -> normalized vector
    mu      sync.RWMutex         // protects vectors map
}
```

### Normalization

All vectors are normalized to unit length (L2 norm = 1):

```
normalized_vector = vector / ||vector||
||vector|| = sqrt(sum(x_i^2))
```

Benefits:
- Cosine similarity = dot product of normalized vectors
- Efficient computation
- Bounds similarity score to [0, 1]

### Search Algorithm

Cosine similarity search:

```
for each stored_vector:
    similarity = dot_product(query_vector, stored_vector)
    // Result in [0, 1] range

sort by similarity descending
return top K matches
```

**Example:**
```
Query: "authentication timeout"
  → Embedding: [0.12, -0.34, 0.56, ...]

Stored memories:
  1. JWT Token Refresh (similarity: 0.87)
  2. Session Management (similarity: 0.76)
  3. Password Reset (similarity: 0.45)
```

---

## Thread Safety

### Concurrency Model

Gob storage uses `sync.RWMutex` for thread-safe access:

```go
type GobStorage struct {
    mu sync.RWMutex
    // ...
}

// Read operations use RLock
func (s *GobStorage) Get(ctx context.Context, id string) (*Memory, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    // ...
}

// Write operations use Lock
func (s *GobStorage) Save(ctx context.Context, memory *Memory) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ...
}
```

### Guarantees

- **Read-Read:** Concurrent reads are allowed
- **Read-Write:** Blocked; writes have exclusive access
- **Write-Write:** Serialized; only one write at a time

### Implications

- Multiple concurrent searches are OK
- Concurrent creates/updates are safe but serialized
- No dirty reads or lost updates

---

## Performance Characteristics

### Memory Usage

- **In-memory index:** ~10 KB per memory (768-dim vector)
  - 1000 memories ≈ 10 MB
  - 10,000 memories ≈ 100 MB

- **Per-operation:** Minimal additional memory (operation-specific buffers)

### Disk Space

- **Per memory file:** ~2-5 KB (compressed gob format)
- **Index file:** ~10 KB + 768 floats * 8 bytes per memory
- **1000 memories:** ~3-10 MB disk usage

### Operation Latency

| Operation | Time | Notes |
|-----------|------|-------|
| Save (create) | 10-50ms | Includes index rewrite |
| Get | 1-5ms | Direct file I/O |
| List (all) | 50-200ms | Loads all memory files |
| Update | 10-50ms | Rewrite memory + index |
| Delete | 10-50ms | Remove file + index |
| Search | 5-100ms | Depends on dataset size |

### Scalability

**Recommended limits:**
- **Light use:** <1,000 memories
- **Moderate use:** 1,000-10,000 memories
- **Heavy use:** 10,000+ memories (consider SQLite/PostgreSQL)

At 100,000 memories:
- Index load: ~500ms
- Search: ~200-500ms
- Memory usage: ~1 GB

---

## Future Storage Backends

### SQLite Backend (Planned)

**Advantages:**
- Handles larger datasets efficiently
- Advanced query capabilities
- Index acceleration
- No additional dependencies

**Example configuration:**
```yaml
storage:
  backend: sqlite
  path: ~/.local/share/cortex-ai/cortex.db
```

### PostgreSQL Backend (Planned)

**Advantages:**
- Multi-user support
- Network accessibility
- Advanced vector extensions (pgvector)
- Full-text search
- ACID transactions

**Example configuration:**
```yaml
storage:
  backend: postgresql
  dsn: postgresql://user:pass@localhost/cortex
```

---

## Development & Extension

### Implementing a Custom Backend

To create a custom storage backend:

1. **Implement Storage interface:**

```go
type CustomStorage struct {
    // Your implementation
}

func (s *CustomStorage) Save(ctx context.Context, memory *memory.Memory) error {
    // Implement
}

func (s *CustomStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
    // Implement
}

// Implement remaining interface methods...
```

2. **Register factory in config:**

```go
// config/storage.go
func NewStorage(backend string, opts map[string]interface{}) (storage.Storage, error) {
    switch backend {
    case "gob":
        return storage.NewGobStorage(opts)
    case "custom":
        return NewCustomStorage(opts)
    default:
        return nil, fmt.Errorf("unknown backend: %s", backend)
    }
}
```

3. **Test thoroughly:**
   - Unit tests for all operations
   - Concurrency tests
   - Performance benchmarks

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Storage layer architecture
- [CONFIGURATION.md](./CONFIGURATION.md) - Storage configuration
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development guide
