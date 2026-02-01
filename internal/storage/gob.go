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

// StorageData represents all data stored in the single Gob file
type StorageData struct {
	Memories map[string]*memory.Memory // map[ID]Memory
	Index    map[string][]float64      // map[ID]Embedding (vector index)
}

// GobStorage implements Storage interface using a single Gob file
type GobStorage struct {
	filePath string
	data     *StorageData
	mu       sync.RWMutex
}

// NewGobStorage creates a new Gob storage backend with a single file
func NewGobStorage(basePath string) (*GobStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	gs := &GobStorage{
		filePath: filepath.Join(basePath, "cortex.gob"),
		data: &StorageData{
			Memories: make(map[string]*memory.Memory),
			Index:    make(map[string][]float64),
		},
	}

	// Load existing data if file exists (ignore error if it doesn't exist yet)
	_ = gs.load()

	return gs, nil
}

// Save saves a memory to storage
func (gs *GobStorage) Save(ctx context.Context, m *memory.Memory) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	// Store memory and its embedding
	gs.data.Memories[m.ID] = m
	gs.data.Index[m.ID] = m.Embedding

	// Persist to disk
	if err := gs.persist(); err != nil {
		return fmt.Errorf("failed to persist storage: %w", err)
	}

	return nil
}

// Get retrieves a memory by ID
func (gs *GobStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	m, exists := gs.data.Memories[id]
	if !exists {
		return nil, fmt.Errorf("memory not found: %s", id)
	}

	return m, nil
}

// List lists all memories
func (gs *GobStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	var memories []*memory.Memory
	for _, m := range gs.data.Memories {
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
	defer gs.mu.Unlock()

	if _, exists := gs.data.Memories[id]; !exists {
		return fmt.Errorf("memory not found: %s", id)
	}

	delete(gs.data.Memories, id)
	delete(gs.data.Index, id)

	// Persist to disk
	if err := gs.persist(); err != nil {
		return fmt.Errorf("failed to persist storage: %w", err)
	}

	return nil
}

// Update updates a memory
func (gs *GobStorage) Update(ctx context.Context, m *memory.Memory) error {
	return gs.Save(ctx, m)
}

// SearchByVector searches memories by vector similarity
func (gs *GobStorage) SearchByVector(ctx context.Context, vector []float64, topK int) ([]*memory.VectorMatch, error) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	var matches []*memory.VectorMatch
	for id, stored := range gs.data.Index {
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

	return gs.persist()
}

// Helper methods

// persist saves all data to the single Gob file
func (gs *GobStorage) persist() error {
	file, err := os.Create(gs.filePath)
	if err != nil {
		return fmt.Errorf("failed to create storage file: %w", err)
	}
	defer func() { _ = file.Close() }()

	if err := gob.NewEncoder(file).Encode(gs.data); err != nil {
		return fmt.Errorf("failed to encode storage data: %w", err)
	}

	return nil
}

// load loads all data from the single Gob file
func (gs *GobStorage) load() error {
	file, err := os.Open(gs.filePath)
	if err != nil {
		return fmt.Errorf("storage file not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	var data StorageData
	if err := gob.NewDecoder(file).Decode(&data); err != nil {
		return fmt.Errorf("failed to decode storage data: %w", err)
	}

	gs.data = &data

	// Ensure maps are initialized even if they were nil in the file
	if gs.data.Memories == nil {
		gs.data.Memories = make(map[string]*memory.Memory)
	}
	if gs.data.Index == nil {
		gs.data.Index = make(map[string][]float64)
	}

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

// FilePath returns the path to the storage file (useful for sharing)
func (gs *GobStorage) FilePath() string {
	return gs.filePath
}

// MemoryCount returns the number of memories in storage
func (gs *GobStorage) MemoryCount() int {
	gs.mu.RLock()
	defer gs.mu.RUnlock()
	return len(gs.data.Memories)
}
