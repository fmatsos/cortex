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

// StorageMode defines the storage strategy
type StorageMode string

const (
	// ModeSingle stores all memories in a single cortex.gob file
	ModeSingle StorageMode = "single"
	// ModeMulti stores each memory in its own {uuid}.gob file
	ModeMulti StorageMode = "multi"
)

// StorageData represents all data stored in the single Gob file (single mode)
type StorageData struct {
	Memories map[string]*memory.Memory // map[ID]Memory
	Index    map[string][]float64      // map[ID]Embedding (vector index)
}

// GobStorage implements Storage interface using Gob encoding
type GobStorage struct {
	basePath string
	mode     StorageMode
	// Single mode: all data in memory
	data *StorageData
	// Multi mode: only index in memory
	index *VectorIndex
	mu    sync.RWMutex
}

// VectorIndex stores in-memory index of vectors (used in multi mode)
type VectorIndex struct {
	vectors map[string][]float64
	mu      sync.RWMutex
}

// NewGobStorage creates a new Gob storage backend
func NewGobStorage(basePath string) (*GobStorage, error) {
	return NewGobStorageWithMode(basePath, ModeSingle)
}

// NewGobStorageWithMode creates a new Gob storage backend with specified mode
func NewGobStorageWithMode(basePath string, mode StorageMode) (*GobStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	gs := &GobStorage{
		basePath: basePath,
		mode:     mode,
	}

	if mode == ModeMulti {
		// Multi mode: create memories subdirectory
		memoriesPath := filepath.Join(basePath, "memories")
		if err := os.MkdirAll(memoriesPath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create memories directory: %w", err)
		}
		gs.index = &VectorIndex{vectors: make(map[string][]float64)}
		// Load existing index
		_ = gs.loadIndex()
	} else {
		// Single mode: initialize in-memory data
		gs.data = &StorageData{
			Memories: make(map[string]*memory.Memory),
			Index:    make(map[string][]float64),
		}
		// Load existing data
		_ = gs.load()
	}

	return gs, nil
}

// Save saves a memory to storage
func (gs *GobStorage) Save(ctx context.Context, m *memory.Memory) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if gs.mode == ModeMulti {
		return gs.saveMulti(m)
	}
	return gs.saveSingle(m)
}

func (gs *GobStorage) saveSingle(m *memory.Memory) error {
	gs.data.Memories[m.ID] = m
	gs.data.Index[m.ID] = m.Embedding

	if err := gs.persist(); err != nil {
		return fmt.Errorf("failed to persist storage: %w", err)
	}
	return nil
}

func (gs *GobStorage) saveMulti(m *memory.Memory) error {
	path := filepath.Join(gs.basePath, "memories", m.ID+".gob")

	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create memory file: %w", err)
	}
	defer func() { _ = file.Close() }()

	if err := gob.NewEncoder(file).Encode(m); err != nil {
		return fmt.Errorf("failed to encode memory: %w", err)
	}

	// Update vector index
	gs.index.mu.Lock()
	gs.index.vectors[m.ID] = m.Embedding
	gs.index.mu.Unlock()

	if err := gs.saveIndex(); err != nil {
		return fmt.Errorf("failed to save index: %w", err)
	}
	return nil
}

// Get retrieves a memory by ID
func (gs *GobStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.mode == ModeMulti {
		return gs.getMulti(id)
	}
	return gs.getSingle(id)
}

func (gs *GobStorage) getSingle(id string) (*memory.Memory, error) {
	m, exists := gs.data.Memories[id]
	if !exists {
		return nil, fmt.Errorf("memory not found: %s", id)
	}
	return m, nil
}

func (gs *GobStorage) getMulti(id string) (*memory.Memory, error) {
	path := filepath.Join(gs.basePath, "memories", id+".gob")

	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("memory not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	var m memory.Memory
	if err := gob.NewDecoder(file).Decode(&m); err != nil {
		return nil, fmt.Errorf("failed to decode memory: %w", err)
	}
	return &m, nil
}

// List lists all memories
func (gs *GobStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.mode == ModeMulti {
		return gs.listMulti(ctx, opts)
	}
	return gs.listSingle(opts)
}

func (gs *GobStorage) listSingle(opts memory.ListOptions) ([]*memory.Memory, error) {
	var memories []*memory.Memory
	for _, m := range gs.data.Memories {
		if !opts.IncludeObsolete && m.Obsolete {
			continue
		}
		if len(opts.FilterTypes) > 0 && !containsType(m.Types, opts.FilterTypes) {
			continue
		}
		memories = append(memories, m)
	}

	sortMemories(memories, opts.SortBy)
	return memories, nil
}

func (gs *GobStorage) listMulti(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	memoriesPath := filepath.Join(gs.basePath, "memories")

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
		m, err := gs.getMulti(id)
		if err != nil {
			continue
		}

		if !opts.IncludeObsolete && m.Obsolete {
			continue
		}
		if len(opts.FilterTypes) > 0 && !containsType(m.Types, opts.FilterTypes) {
			continue
		}
		memories = append(memories, m)
	}

	sortMemories(memories, opts.SortBy)
	return memories, nil
}

// Delete deletes a memory
func (gs *GobStorage) Delete(ctx context.Context, id string) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if gs.mode == ModeMulti {
		return gs.deleteMulti(id)
	}
	return gs.deleteSingle(id)
}

func (gs *GobStorage) deleteSingle(id string) error {
	if _, exists := gs.data.Memories[id]; !exists {
		return fmt.Errorf("memory not found: %s", id)
	}

	delete(gs.data.Memories, id)
	delete(gs.data.Index, id)

	if err := gs.persist(); err != nil {
		return fmt.Errorf("failed to persist storage: %w", err)
	}
	return nil
}

func (gs *GobStorage) deleteMulti(id string) error {
	path := filepath.Join(gs.basePath, "memories", id+".gob")

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("failed to delete memory: %w", err)
	}

	gs.index.mu.Lock()
	delete(gs.index.vectors, id)
	gs.index.mu.Unlock()

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
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	var vectors map[string][]float64
	if gs.mode == ModeMulti {
		gs.index.mu.RLock()
		vectors = gs.index.vectors
		gs.index.mu.RUnlock()
	} else {
		vectors = gs.data.Index
	}

	var matches []*memory.VectorMatch
	for id, stored := range vectors {
		score := search.CosineSimilarity(vector, stored)
		matches = append(matches, &memory.VectorMatch{
			MemoryID: id,
			Score:    score,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].Score > matches[j].Score
	})

	if len(matches) > topK {
		matches = matches[:topK]
	}

	return matches, nil
}

// Close closes the storage
func (gs *GobStorage) Close() error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if gs.mode == ModeMulti {
		return gs.saveIndex()
	}
	return gs.persist()
}

// Helper methods for single mode

func (gs *GobStorage) persist() error {
	filePath := filepath.Join(gs.basePath, "cortex.gob")

	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create storage file: %w", err)
	}
	defer func() { _ = file.Close() }()

	if err := gob.NewEncoder(file).Encode(gs.data); err != nil {
		return fmt.Errorf("failed to encode storage data: %w", err)
	}
	return nil
}

func (gs *GobStorage) load() error {
	filePath := filepath.Join(gs.basePath, "cortex.gob")

	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("storage file not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	var data StorageData
	if err := gob.NewDecoder(file).Decode(&data); err != nil {
		return fmt.Errorf("failed to decode storage data: %w", err)
	}

	gs.data = &data
	if gs.data.Memories == nil {
		gs.data.Memories = make(map[string]*memory.Memory)
	}
	if gs.data.Index == nil {
		gs.data.Index = make(map[string][]float64)
	}
	return nil
}

// Helper methods for multi mode

func (gs *GobStorage) saveIndex() error {
	indexPath := filepath.Join(gs.basePath, "index.gob")

	file, err := os.Create(indexPath)
	if err != nil {
		return fmt.Errorf("failed to create index file: %w", err)
	}
	defer func() { _ = file.Close() }()

	gs.index.mu.RLock()
	defer gs.index.mu.RUnlock()

	if err := gob.NewEncoder(file).Encode(gs.index.vectors); err != nil {
		return fmt.Errorf("failed to encode index: %w", err)
	}
	return nil
}

func (gs *GobStorage) loadIndex() error {
	indexPath := filepath.Join(gs.basePath, "index.gob")

	file, err := os.Open(indexPath)
	if err != nil {
		return fmt.Errorf("index not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	vectors := make(map[string][]float64)
	if err := gob.NewDecoder(file).Decode(&vectors); err != nil {
		return fmt.Errorf("failed to decode index: %w", err)
	}

	gs.index.mu.Lock()
	gs.index.vectors = vectors
	gs.index.mu.Unlock()
	return nil
}

// Common helpers

func sortMemories(memories []*memory.Memory, sortBy string) {
	sort.Slice(memories, func(i, j int) bool {
		switch sortBy {
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
}

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

// FilePath returns the path to the storage file (single mode) or directory (multi mode)
func (gs *GobStorage) FilePath() string {
	if gs.mode == ModeMulti {
		return filepath.Join(gs.basePath, "memories")
	}
	return filepath.Join(gs.basePath, "cortex.gob")
}

// MemoryCount returns the number of memories in storage
func (gs *GobStorage) MemoryCount() int {
	gs.mu.RLock()
	defer gs.mu.RUnlock()

	if gs.mode == ModeMulti {
		gs.index.mu.RLock()
		defer gs.index.mu.RUnlock()
		return len(gs.index.vectors)
	}
	return len(gs.data.Memories)
}

// Mode returns the current storage mode
func (gs *GobStorage) Mode() StorageMode {
	return gs.mode
}
