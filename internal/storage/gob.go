package storage

import (
	"context"
	"encoding/gob"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/search"
)

// VectorIndex stores in-memory index of vectors
type VectorIndex struct {
	vectors map[string][]float64
	mu      sync.RWMutex
}

// GobStorage implements Storage interface using Gob encoding
type GobStorage struct {
	basePath string
	index    *VectorIndex
	mu       sync.RWMutex
}

// NewGobStorage creates a new Gob storage backend
func NewGobStorage(basePath string) (*GobStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	// Create memories subdirectory
	memoriesPath := filepath.Join(basePath, "memories")
	if err := os.MkdirAll(memoriesPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create memories directory: %w", err)
	}

	gs := &GobStorage{
		basePath: basePath,
		index:    &VectorIndex{vectors: make(map[string][]float64)},
	}

	// Load existing index if it exists
	if err := gs.loadIndex(); err != nil {
		// Index doesn't exist yet, which is fine
	}

	return gs, nil
}

// Save saves a memory to storage
func (gs *GobStorage) Save(ctx context.Context, m *memory.Memory) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	path := filepath.Join(gs.basePath, "memories", m.ID+".gob")

	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create memory file: %w", err)
	}
	defer file.Close()

	if err := gob.NewEncoder(file).Encode(m); err != nil {
		return fmt.Errorf("failed to encode memory: %w", err)
	}

	// Update vector index
	gs.index.mu.Lock()
	gs.index.vectors[m.ID] = m.Embedding
	gs.index.mu.Unlock()

	// Save index
	if err := gs.saveIndex(); err != nil {
		return fmt.Errorf("failed to save index: %w", err)
	}

	return nil
}

// Get retrieves a memory by ID
func (gs *GobStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	gs.mu.RLock()
	path := filepath.Join(gs.basePath, "memories", id+".gob")
	gs.mu.RUnlock()

	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("memory not found: %w", err)
	}
	defer file.Close()

	var m memory.Memory
	if err := gob.NewDecoder(file).Decode(&m); err != nil {
		return nil, fmt.Errorf("failed to decode memory: %w", err)
	}

	return &m, nil
}

// List lists all memories
func (gs *GobStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	gs.mu.RLock()
	memoriesPath := filepath.Join(gs.basePath, "memories")
	gs.mu.RUnlock()

	dir, err := os.Open(memoriesPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open memories directory: %w", err)
	}
	defer dir.Close()

	files, err := dir.Readdirnames(-1)
	if err != nil {
		return nil, fmt.Errorf("failed to read memories directory: %w", err)
	}

	var memories []*memory.Memory
	for _, file := range files {
		if filepath.Ext(file) != ".gob" {
			continue
		}

		id := file[:len(file)-4] // Remove .gob extension
		m, err := gs.Get(ctx, id)
		if err != nil {
			continue
		}

		if !opts.IncludeObsolete && m.Obsolete {
			continue
		}

		if len(opts.FilterTypes) > 0 {
			if !containsType(m.Types, opts.FilterTypes) {
				continue
			}
		}

		memories = append(memories, m)
	}

	// Sort memories
	sort.Slice(memories, func(i, j int) bool {
		switch opts.SortBy {
		case "created":
			return memories[i].CreatedAt.Before(memories[j].CreatedAt)
		case "updated":
			return memories[i].UpdatedAt.Before(memories[j].UpdatedAt)
		case "title":
			return memories[i].Title < memories[j].Title
		default:
			return memories[i].CreatedAt.Before(memories[j].CreatedAt)
		}
	})

	return memories, nil
}

// Delete deletes a memory
func (gs *GobStorage) Delete(ctx context.Context, id string) error {
	gs.mu.Lock()
	path := filepath.Join(gs.basePath, "memories", id+".gob")
	gs.mu.Unlock()

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("failed to delete memory: %w", err)
	}

	// Update vector index
	gs.index.mu.Lock()
	delete(gs.index.vectors, id)
	gs.index.mu.Unlock()

	// Save index
	if err := gs.saveIndex(); err != nil {
		return fmt.Errorf("failed to save index: %w", err)
	}

	return nil
}

// Update updates a memory
func (gs *GobStorage) Update(ctx context.Context, m *memory.Memory) error {
	return gs.Save(ctx, m)
}

// SearchByVector searches memories by vector similarity
func (gs *GobStorage) SearchByVector(ctx context.Context, vector []float64, topK int) ([]*memory.VectorMatch, error) {
	gs.index.mu.RLock()
	defer gs.index.mu.RUnlock()

	var matches []*memory.VectorMatch
	for id, stored := range gs.index.vectors {
		score := search.CosineSimilarity(vector, stored)
		matches = append(matches, &memory.VectorMatch{
			MemoryID: id,
			Score:    score,
		})
	}

	// Sort by score descending
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].Score > matches[j].Score
	})

	// Limit to topK
	if len(matches) > topK {
		matches = matches[:topK]
	}

	return matches, nil
}

// Close closes the storage
func (gs *GobStorage) Close() error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	return gs.saveIndex()
}

// Helper methods

// saveIndex saves the vector index to disk
func (gs *GobStorage) saveIndex() error {
	indexPath := filepath.Join(gs.basePath, "index.gob")

	file, err := os.Create(indexPath)
	if err != nil {
		return fmt.Errorf("failed to create index file: %w", err)
	}
	defer file.Close()

	gs.index.mu.RLock()
	defer gs.index.mu.RUnlock()

	if err := gob.NewEncoder(file).Encode(gs.index.vectors); err != nil {
		return fmt.Errorf("failed to encode index: %w", err)
	}

	return nil
}

// loadIndex loads the vector index from disk
func (gs *GobStorage) loadIndex() error {
	indexPath := filepath.Join(gs.basePath, "index.gob")

	file, err := os.Open(indexPath)
	if err != nil {
		return fmt.Errorf("index not found: %w", err)
	}
	defer file.Close()

	vectors := make(map[string][]float64)
	if err := gob.NewDecoder(file).Decode(&vectors); err != nil {
		return fmt.Errorf("failed to decode index: %w", err)
	}

	gs.index.mu.Lock()
	gs.index.vectors = vectors
	gs.index.mu.Unlock()

	return nil
}

// containsType checks if memory types contain any of the filter types
func containsType(memoryTypes []memory.MemoryType, filterTypes []memory.MemoryType) bool {
	for _, mt := range memoryTypes {
		for _, ft := range filterTypes {
			if mt == ft {
				return true
			}
		}
	}
	return false
}
