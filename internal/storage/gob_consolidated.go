package storage

import (
	"context"
	"encoding/gob"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/search"
)

// ConsolidatedStorageData represents all consolidated memory data
type ConsolidatedStorageData struct {
	Memories map[string]*memory.ConsolidatedMemory // map[ID]Memory
	Index    map[string][]float64                  // map[ID]Embedding
}

// GobConsolidatedStorage implements ConsolidatedStorage interface using Gob encoding
type GobConsolidatedStorage struct {
	basePath    string
	data        *ConsolidatedStorageData
	workingData map[string]*ConsolidatedStorageData // map[sessionID]data for working memories
	mu          sync.RWMutex
	workingMu   sync.RWMutex
}

// NewGobConsolidatedStorage creates a new consolidated storage backend
func NewGobConsolidatedStorage(basePath string) (*GobConsolidatedStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	// Create working directory for session memories
	workingPath := filepath.Join(basePath, "working")
	if err := os.MkdirAll(workingPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create working directory: %w", err)
	}

	gs := &GobConsolidatedStorage{
		basePath: basePath,
		data: &ConsolidatedStorageData{
			Memories: make(map[string]*memory.ConsolidatedMemory),
			Index:    make(map[string][]float64),
		},
		workingData: make(map[string]*ConsolidatedStorageData),
	}

	// Load existing data
	_ = gs.load()

	return gs, nil
}

// SaveConsolidated saves a consolidated memory
func (gs *GobConsolidatedStorage) SaveConsolidated(ctx context.Context, m *memory.ConsolidatedMemory) error {
	if m.Level == memory.MemoryLevelWorking {
		return gs.saveWorking(m)
	}
	return gs.savePersistent(m)
}

func (gs *GobConsolidatedStorage) savePersistent(m *memory.ConsolidatedMemory) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	gs.data.Memories[m.ID] = m
	gs.data.Index[m.ID] = m.Embedding

	if err := gs.persist(); err != nil {
		return fmt.Errorf("failed to persist storage: %w", err)
	}
	return nil
}

func (gs *GobConsolidatedStorage) saveWorking(m *memory.ConsolidatedMemory) error {
	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()

	sessionID := m.Context.SessionID
	if sessionID == "" {
		return fmt.Errorf("session_id is required for working memory")
	}

	// Initialize session data if needed
	if _, exists := gs.workingData[sessionID]; !exists {
		gs.workingData[sessionID] = &ConsolidatedStorageData{
			Memories: make(map[string]*memory.ConsolidatedMemory),
			Index:    make(map[string][]float64),
		}
	}

	gs.workingData[sessionID].Memories[m.ID] = m
	gs.workingData[sessionID].Index[m.ID] = m.Embedding

	return gs.persistWorking(sessionID)
}

// GetConsolidated retrieves a consolidated memory by ID
func (gs *GobConsolidatedStorage) GetConsolidated(ctx context.Context, id string) (*memory.ConsolidatedMemory, error) {
	// First check persistent storage
	gs.mu.RLock()
	if m, exists := gs.data.Memories[id]; exists {
		gs.mu.RUnlock()
		return m, nil
	}
	gs.mu.RUnlock()

	// Then check working storage
	gs.workingMu.RLock()
	defer gs.workingMu.RUnlock()

	for _, sessionData := range gs.workingData {
		if m, exists := sessionData.Memories[id]; exists {
			return m, nil
		}
	}

	return nil, fmt.Errorf("consolidated memory not found: %s", id)
}

// ListByLevel lists memories by their level
func (gs *GobConsolidatedStorage) ListByLevel(ctx context.Context, level memory.MemoryLevel) ([]*memory.ConsolidatedMemory, error) {
	if level == memory.MemoryLevelWorking {
		return gs.listAllWorking()
	}

	gs.mu.RLock()
	defer gs.mu.RUnlock()

	var memories []*memory.ConsolidatedMemory
	for _, m := range gs.data.Memories {
		if m.Level == level {
			memories = append(memories, m)
		}
	}

	// Sort by creation time (newest first)
	sort.Slice(memories, func(i, j int) bool {
		return memories[i].CreatedAt.After(memories[j].CreatedAt)
	})

	return memories, nil
}

func (gs *GobConsolidatedStorage) listAllWorking() ([]*memory.ConsolidatedMemory, error) {
	gs.workingMu.RLock()
	defer gs.workingMu.RUnlock()

	var memories []*memory.ConsolidatedMemory
	for _, sessionData := range gs.workingData {
		for _, m := range sessionData.Memories {
			memories = append(memories, m)
		}
	}

	sort.Slice(memories, func(i, j int) bool {
		return memories[i].CreatedAt.After(memories[j].CreatedAt)
	})

	return memories, nil
}

// ListWorkingBySession lists working memories for a specific session
func (gs *GobConsolidatedStorage) ListWorkingBySession(ctx context.Context, sessionID string) ([]*memory.ConsolidatedMemory, error) {
	gs.workingMu.RLock()
	defer gs.workingMu.RUnlock()

	sessionData, exists := gs.workingData[sessionID]
	if !exists {
		return []*memory.ConsolidatedMemory{}, nil
	}

	var memories []*memory.ConsolidatedMemory
	for _, m := range sessionData.Memories {
		memories = append(memories, m)
	}

	sort.Slice(memories, func(i, j int) bool {
		return memories[i].CreatedAt.After(memories[j].CreatedAt)
	})

	return memories, nil
}

// DeleteWorkingBySession deletes all working memories for a session
func (gs *GobConsolidatedStorage) DeleteWorkingBySession(ctx context.Context, sessionID string) error {
	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()

	delete(gs.workingData, sessionID)

	// Remove the session file
	sessionFile := filepath.Join(gs.basePath, "working", sessionID+".gob")
	if err := os.Remove(sessionFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete session file: %w", err)
	}

	return nil
}

// DeleteConsolidated deletes a consolidated memory by ID
func (gs *GobConsolidatedStorage) DeleteConsolidated(ctx context.Context, id string) error {
	// Try persistent storage first
	gs.mu.Lock()
	if _, exists := gs.data.Memories[id]; exists {
		delete(gs.data.Memories, id)
		delete(gs.data.Index, id)
		err := gs.persist()
		gs.mu.Unlock()
		return err
	}
	gs.mu.Unlock()

	// Try working storage
	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()

	for sessionID, sessionData := range gs.workingData {
		if _, exists := sessionData.Memories[id]; exists {
			delete(sessionData.Memories, id)
			delete(sessionData.Index, id)
			return gs.persistWorking(sessionID)
		}
	}

	return fmt.Errorf("consolidated memory not found: %s", id)
}

// FindSimilar finds memories similar to the given embedding
func (gs *GobConsolidatedStorage) FindSimilar(ctx context.Context, embedding []float64, level memory.MemoryLevel, threshold float64) ([]*memory.ConsolidatedMemory, error) {
	matches, err := gs.SearchConsolidatedByVector(ctx, embedding, level, 100)
	if err != nil {
		return nil, err
	}

	var similar []*memory.ConsolidatedMemory
	for _, match := range matches {
		if match.Score >= threshold {
			m, err := gs.GetConsolidated(ctx, match.MemoryID)
			if err != nil {
				continue
			}
			similar = append(similar, m)
		}
	}

	return similar, nil
}

// Merge merges source memories into a target memory
func (gs *GobConsolidatedStorage) Merge(ctx context.Context, targetID string, sourceIDs []string, newContent string, newEmbedding []float64) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	target, exists := gs.data.Memories[targetID]
	if !exists {
		return fmt.Errorf("target memory not found: %s", targetID)
	}

	// Update target memory
	target.Content = newContent
	target.Embedding = newEmbedding
	target.UpdatedAt = time.Now()
	target.MergedFrom = append(target.MergedFrom, sourceIDs...)

	// Update index
	gs.data.Index[targetID] = newEmbedding

	// Delete source memories
	for _, sourceID := range sourceIDs {
		if sourceID != targetID {
			delete(gs.data.Memories, sourceID)
			delete(gs.data.Index, sourceID)
		}
	}

	return gs.persist()
}

// ArchiveOlderThan archives memories older than the given time
func (gs *GobConsolidatedStorage) ArchiveOlderThan(ctx context.Context, level memory.MemoryLevel, before time.Time) (int, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	var archived int
	var toDelete []string

	for id, m := range gs.data.Memories {
		if m.Level == level && m.CreatedAt.Before(before) {
			toDelete = append(toDelete, id)
			archived++
		}
	}

	for _, id := range toDelete {
		delete(gs.data.Memories, id)
		delete(gs.data.Index, id)
	}

	if archived > 0 {
		if err := gs.persist(); err != nil {
			return 0, fmt.Errorf("failed to persist after archive: %w", err)
		}
	}

	return archived, nil
}

// SearchConsolidatedByVector searches consolidated memories by vector similarity
func (gs *GobConsolidatedStorage) SearchConsolidatedByVector(ctx context.Context, vector []float64, level memory.MemoryLevel, topK int) ([]*ConsolidatedVectorMatch, error) {
	var allMatches []*ConsolidatedVectorMatch

	if level == memory.MemoryLevelWorking || level == "" {
		// Search working memories
		gs.workingMu.RLock()
		for _, sessionData := range gs.workingData {
			for id, stored := range sessionData.Index {
				score := search.CosineSimilarity(vector, stored)
				allMatches = append(allMatches, &ConsolidatedVectorMatch{
					MemoryID: id,
					Score:    score,
				})
			}
		}
		gs.workingMu.RUnlock()
	}

	if level != memory.MemoryLevelWorking {
		// Search persistent memories
		gs.mu.RLock()
		for id, m := range gs.data.Memories {
			if level != "" && m.Level != level {
				continue
			}
			stored := gs.data.Index[id]
			score := search.CosineSimilarity(vector, stored)
			allMatches = append(allMatches, &ConsolidatedVectorMatch{
				MemoryID: id,
				Score:    score,
			})
		}
		gs.mu.RUnlock()
	}

	// Sort by score descending
	sort.Slice(allMatches, func(i, j int) bool {
		return allMatches[i].Score > allMatches[j].Score
	})

	if len(allMatches) > topK {
		allMatches = allMatches[:topK]
	}

	return allMatches, nil
}

// Close closes the storage and persists any pending changes
func (gs *GobConsolidatedStorage) Close() error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if err := gs.persist(); err != nil {
		return err
	}

	gs.workingMu.Lock()
	defer gs.workingMu.Unlock()

	for sessionID := range gs.workingData {
		if err := gs.persistWorking(sessionID); err != nil {
			return err
		}
	}

	return nil
}

// Helper methods

func (gs *GobConsolidatedStorage) persist() error {
	filePath := filepath.Join(gs.basePath, "consolidated.gob")

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

func (gs *GobConsolidatedStorage) load() error {
	filePath := filepath.Join(gs.basePath, "consolidated.gob")

	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("storage file not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	var data ConsolidatedStorageData
	if err := gob.NewDecoder(file).Decode(&data); err != nil {
		return fmt.Errorf("failed to decode storage data: %w", err)
	}

	gs.data = &data
	if gs.data.Memories == nil {
		gs.data.Memories = make(map[string]*memory.ConsolidatedMemory)
	}
	if gs.data.Index == nil {
		gs.data.Index = make(map[string][]float64)
	}

	// Load working sessions
	return gs.loadWorkingSessions()
}

func (gs *GobConsolidatedStorage) loadWorkingSessions() error {
	workingPath := filepath.Join(gs.basePath, "working")

	dir, err := os.Open(workingPath)
	if err != nil {
		return nil // No working directory is OK
	}
	defer func() { _ = dir.Close() }()

	files, err := dir.Readdirnames(-1)
	if err != nil {
		return fmt.Errorf("failed to read working directory: %w", err)
	}

	for _, file := range files {
		if filepath.Ext(file) != ".gob" {
			continue
		}

		sessionID := file[:len(file)-4] // Remove .gob extension
		if err := gs.loadWorkingSession(sessionID); err != nil {
			continue // Skip corrupted files
		}
	}

	return nil
}

func (gs *GobConsolidatedStorage) loadWorkingSession(sessionID string) error {
	filePath := filepath.Join(gs.basePath, "working", sessionID+".gob")

	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("session file not found: %w", err)
	}
	defer func() { _ = file.Close() }()

	var data ConsolidatedStorageData
	if err := gob.NewDecoder(file).Decode(&data); err != nil {
		return fmt.Errorf("failed to decode session data: %w", err)
	}

	if data.Memories == nil {
		data.Memories = make(map[string]*memory.ConsolidatedMemory)
	}
	if data.Index == nil {
		data.Index = make(map[string][]float64)
	}

	gs.workingData[sessionID] = &data
	return nil
}

func (gs *GobConsolidatedStorage) persistWorking(sessionID string) error {
	sessionData, exists := gs.workingData[sessionID]
	if !exists {
		return nil
	}

	filePath := filepath.Join(gs.basePath, "working", sessionID+".gob")

	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create session file: %w", err)
	}
	defer func() { _ = file.Close() }()

	if err := gob.NewEncoder(file).Encode(sessionData); err != nil {
		return fmt.Errorf("failed to encode session data: %w", err)
	}
	return nil
}

// MemoryCount returns the total number of consolidated memories
func (gs *GobConsolidatedStorage) MemoryCount() int {
	gs.mu.RLock()
	persistentCount := len(gs.data.Memories)
	gs.mu.RUnlock()

	gs.workingMu.RLock()
	workingCount := 0
	for _, sessionData := range gs.workingData {
		workingCount += len(sessionData.Memories)
	}
	gs.workingMu.RUnlock()

	return persistentCount + workingCount
}

// CountByLevel returns the count of memories for each level
func (gs *GobConsolidatedStorage) CountByLevel() map[memory.MemoryLevel]int {
	counts := make(map[memory.MemoryLevel]int)

	gs.mu.RLock()
	for _, m := range gs.data.Memories {
		counts[m.Level]++
	}
	gs.mu.RUnlock()

	gs.workingMu.RLock()
	for _, sessionData := range gs.workingData {
		counts[memory.MemoryLevelWorking] += len(sessionData.Memories)
	}
	gs.workingMu.RUnlock()

	return counts
}
