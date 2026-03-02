package storage

import (
	"container/heap"
	"context"
	"encoding/gob"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/search"
)

func init() {
	gob.Register(&memory.Memory{})
	gob.Register(&memory.MemoryContext{})
}

type persistentData struct {
	Memories map[string]*memory.Memory
	Index    map[string][]float64
}

type workingData struct {
	SessionID string
	Memories  map[string]*memory.Memory
	Index     map[string][]float64
}

// searchResultHeap is a min-heap of SearchResult by Score (smallest on top).
// Used to efficiently track top-K results without a full sort.
type searchResultHeap []*memory.SearchResult

func (h searchResultHeap) Len() int           { return len(h) }
func (h searchResultHeap) Less(i, j int) bool { return h[i].Score < h[j].Score } // min-heap
func (h searchResultHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *searchResultHeap) Push(x interface{}) {
	*h = append(*h, x.(*memory.SearchResult))
}

func (h *searchResultHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	old[n-1] = nil
	*h = old[:n-1]
	return x
}

// GobStorage implements Storage using Gob encoding.
type GobStorage struct {
	basePath    string
	data        *persistentData
	mu          sync.RWMutex
	workingDir  string
	workingMu   sync.RWMutex
	workingData map[string]*workingData
}

// NewGobStorage creates a new GobStorage.
func NewGobStorage(basePath string) (*GobStorage, error) {
	gs := &GobStorage{
		basePath:    basePath,
		workingDir:  filepath.Join(filepath.Dir(basePath), "working"),
		data:        &persistentData{Memories: make(map[string]*memory.Memory), Index: make(map[string][]float64)},
		workingData: make(map[string]*workingData),
	}

	if err := os.MkdirAll(gs.workingDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create working dir: %w", err)
	}

	if err := gs.loadPersistent(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	if err := gs.loadAllWorking(); err != nil {
		return nil, err
	}

	return gs, nil
}

// Save saves a memory to the appropriate storage.
func (gs *GobStorage) Save(ctx context.Context, m *memory.Memory) error {
	if m.Level == memory.MemoryLevelWorking {
		return gs.saveWorking(m)
	}
	return gs.savePersistent(m)
}

func (gs *GobStorage) savePersistent(m *memory.Memory) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.data.Memories[m.ID] = m
	gs.data.Index[m.ID] = m.Embedding
	return gs.flushPersistent()
}

func (gs *GobStorage) saveWorking(m *memory.Memory) error {
	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()

	sessionID := m.Context.SessionID
	if sessionID == "" {
		return fmt.Errorf("session_id required for working memory")
	}
	if _, ok := gs.workingData[sessionID]; !ok {
		gs.workingData[sessionID] = &workingData{
			SessionID: sessionID,
			Memories:  make(map[string]*memory.Memory),
			Index:     make(map[string][]float64),
		}
	}

	gs.workingData[sessionID].Memories[m.ID] = m
	gs.workingData[sessionID].Index[m.ID] = m.Embedding
	return gs.flushWorking(sessionID)
}

// resolveID resolves a full or short (prefix) ID to a full memory ID.
// Lock ordering: acquire mu before workingMu (same as other methods).
func (gs *GobStorage) resolveID(id string) (string, error) {
	gs.mu.RLock()
	if _, ok := gs.data.Memories[id]; ok {
		gs.mu.RUnlock()
		return id, nil
	}
	var matches []string
	for k := range gs.data.Memories {
		if strings.HasPrefix(k, id) {
			matches = append(matches, k)
		}
	}
	gs.mu.RUnlock()

	gs.workingMu.RLock()
	defer gs.workingMu.RUnlock()
	for _, wd := range gs.workingData {
		if _, ok := wd.Memories[id]; ok {
			return id, nil
		}
		for k := range wd.Memories {
			if strings.HasPrefix(k, id) {
				matches = append(matches, k)
			}
		}
	}

	switch len(matches) {
	case 0:
		return "", fmt.Errorf("memory not found: %s", id)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("ambiguous ID prefix %q matches %d memories", id, len(matches))
	}
}

// Get retrieves a memory by ID or unambiguous ID prefix.
func (gs *GobStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	fullID, err := gs.resolveID(id)
	if err != nil {
		return nil, err
	}

	gs.mu.RLock()
	if m, ok := gs.data.Memories[fullID]; ok {
		gs.mu.RUnlock()
		return m, nil
	}
	gs.mu.RUnlock()

	gs.workingMu.RLock()
	defer gs.workingMu.RUnlock()
	for _, wd := range gs.workingData {
		if m, ok := wd.Memories[fullID]; ok {
			return m, nil
		}
	}
	return nil, fmt.Errorf("memory not found: %s", id)
}

// List lists memories with filtering.
func (gs *GobStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	var memories []*memory.Memory

	includeWorking := len(opts.FilterLevels) == 0 || containsLevel(opts.FilterLevels, memory.MemoryLevelWorking)
	includeEpisodic := len(opts.FilterLevels) == 0 || containsLevel(opts.FilterLevels, memory.MemoryLevelEpisodic)
	includeSemantic := len(opts.FilterLevels) == 0 || containsLevel(opts.FilterLevels, memory.MemoryLevelSemantic)

	if includeWorking {
		gs.workingMu.RLock()
		for _, wd := range gs.workingData {
			for _, m := range wd.Memories {
				if !opts.IncludeObsolete && m.Obsolete {
					continue
				}
				memories = append(memories, m)
			}
		}
		gs.workingMu.RUnlock()
	}

	gs.mu.RLock()
	for _, m := range gs.data.Memories {
		if m.Level == memory.MemoryLevelEpisodic && !includeEpisodic {
			continue
		}
		if m.Level == memory.MemoryLevelSemantic && !includeSemantic {
			continue
		}
		if !opts.IncludeObsolete && m.Obsolete {
			continue
		}
		memories = append(memories, m)
	}
	gs.mu.RUnlock()

	sort.Slice(memories, func(i, j int) bool {
		if opts.Reverse {
			return memories[i].CreatedAt.Before(memories[j].CreatedAt)
		}
		return memories[i].CreatedAt.After(memories[j].CreatedAt)
	})

	if opts.Limit > 0 && len(memories) > opts.Limit {
		memories = memories[:opts.Limit]
	}

	return memories, nil
}

// Delete permanently deletes a memory by full ID or unambiguous ID prefix.
func (gs *GobStorage) Delete(ctx context.Context, id string) error {
	fullID, err := gs.resolveID(id)
	if err != nil {
		return err
	}

	gs.mu.Lock()
	if _, ok := gs.data.Memories[fullID]; ok {
		delete(gs.data.Memories, fullID)
		delete(gs.data.Index, fullID)
		gs.mu.Unlock()
		return gs.flushPersistent()
	}
	gs.mu.Unlock()

	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()
	for sessionID, wd := range gs.workingData {
		if _, ok := wd.Memories[fullID]; ok {
			delete(wd.Memories, fullID)
			delete(wd.Index, fullID)
			return gs.flushWorking(sessionID)
		}
	}
	return fmt.Errorf("memory not found: %s", id)
}

// Update updates a memory.
func (gs *GobStorage) Update(ctx context.Context, m *memory.Memory) error {
	return gs.Save(ctx, m)
}

// SearchAllLayers searches across all memory layers.
func (gs *GobStorage) SearchAllLayers(ctx context.Context, vector []float64, opts memory.SearchOptions) ([]*memory.SearchResult, error) {
	var results []*memory.SearchResult

	searchLevels := opts.FilterLevels
	if len(searchLevels) == 0 {
		searchLevels = []memory.MemoryLevel{
			memory.MemoryLevelWorking,
			memory.MemoryLevelEpisodic,
			memory.MemoryLevelSemantic,
		}
	}

	if containsLevel(searchLevels, memory.MemoryLevelWorking) {
		gs.workingMu.RLock()
		for _, wd := range gs.workingData {
			if opts.SessionID != "" && wd.SessionID != opts.SessionID {
				continue
			}
			for id, stored := range wd.Index {
				score := search.CosineSimilarity(vector, stored)
				if score >= opts.MinScore {
					m := wd.Memories[id]
					if !opts.IncludeObsolete && m.Obsolete {
						continue
					}
					results = append(results, &memory.SearchResult{Memory: m, Score: score})
				}
			}
		}
		gs.workingMu.RUnlock()
	}

	gs.mu.RLock()
	for id, m := range gs.data.Memories {
		if !containsLevel(searchLevels, m.Level) {
			continue
		}
		if !opts.IncludeObsolete && m.Obsolete {
			continue
		}
		stored := gs.data.Index[id]
		score := search.CosineSimilarity(vector, stored)
		if score >= opts.MinScore {
			results = append(results, &memory.SearchResult{Memory: m, Score: score})
		}
	}
	gs.mu.RUnlock()

	// Use a min-heap for efficient top-K selection when TopK is set and we have many results
	if opts.TopK > 0 && len(results) > opts.TopK {
		h := make(searchResultHeap, 0, opts.TopK+1)
		heap.Init(&h)
		for _, r := range results {
			heap.Push(&h, r)
			if h.Len() > opts.TopK {
				heap.Pop(&h)
			}
		}
		// Extract results from heap in descending order
		results = make([]*memory.SearchResult, h.Len())
		for i := len(results) - 1; i >= 0; i-- {
			results[i] = heap.Pop(&h).(*memory.SearchResult)
		}
	} else {
		// Sort all results in descending order
		sort.Slice(results, func(i, j int) bool {
			return results[i].Score > results[j].Score
		})
	}

	return results, nil
}

// TransferWorkingToEpisodic transfers working memories to episodic level.
func (gs *GobStorage) TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error) {
	gs.workingMu.Lock()
	wd, ok := gs.workingData[sessionID]
	if !ok {
		gs.workingMu.Unlock()
		return 0, fmt.Errorf("session not found: %s", sessionID)
	}

	toTransfer := make([]*memory.Memory, 0, len(wd.Memories))
	for _, m := range wd.Memories {
		m.Level = memory.MemoryLevelEpisodic
		toTransfer = append(toTransfer, m)
	}

	delete(gs.workingData, sessionID)
	gs.workingMu.Unlock()

	workingPath := filepath.Join(gs.workingDir, sessionID+".gob")
	_ = os.Remove(workingPath)

	gs.mu.Lock()
	for _, m := range toTransfer {
		gs.data.Memories[m.ID] = m
		gs.data.Index[m.ID] = m.Embedding
	}
	gs.mu.Unlock()

	if err := gs.flushPersistent(); err != nil {
		return 0, err
	}

	return len(toTransfer), nil
}

// Close closes the storage.
func (gs *GobStorage) Close() error {
	return nil
}

func (gs *GobStorage) loadPersistent() error {
	f, err := os.Open(gs.basePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return gob.NewDecoder(f).Decode(&gs.data)
}

func (gs *GobStorage) flushPersistent() error {
	if err := os.MkdirAll(filepath.Dir(gs.basePath), 0755); err != nil {
		return err
	}
	f, err := os.Create(gs.basePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return gob.NewEncoder(f).Encode(gs.data)
}

func (gs *GobStorage) loadAllWorking() error {
	entries, err := os.ReadDir(gs.workingDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".gob" {
			continue
		}
		sessionID := entry.Name()[:len(entry.Name())-4]
		if err := gs.loadWorking(sessionID); err != nil {
			return err
		}
	}
	return nil
}

func (gs *GobStorage) loadWorking(sessionID string) error {
	path := filepath.Join(gs.workingDir, sessionID+".gob")
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	wd := &workingData{}
	if err := gob.NewDecoder(f).Decode(wd); err != nil {
		return err
	}
	gs.workingData[sessionID] = wd
	return nil
}

func (gs *GobStorage) flushWorking(sessionID string) error {
	wd := gs.workingData[sessionID]
	if wd == nil {
		return nil
	}
	path := filepath.Join(gs.workingDir, sessionID+".gob")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return gob.NewEncoder(f).Encode(wd)
}

func containsLevel(levels []memory.MemoryLevel, level memory.MemoryLevel) bool {
	for _, l := range levels {
		if l == level {
			return true
		}
	}
	return false
}
