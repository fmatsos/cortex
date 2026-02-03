package storage

import (
	"context"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

func TestGobConsolidatedStorage_SaveAndGet(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	mem := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Content:   "Test content",
		Embedding: []float64{0.1, 0.2, 0.3},
		Context: memory.ConsolidationContext{
			SessionID: "session123",
			Source:    "manual",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Save
	err = store.SaveConsolidated(ctx, mem)
	if err != nil {
		t.Fatalf("SaveConsolidated() error = %v", err)
	}

	// Get
	retrieved, err := store.GetConsolidated(ctx, mem.ID)
	if err != nil {
		t.Fatalf("GetConsolidated() error = %v", err)
	}

	if retrieved.ID != mem.ID {
		t.Errorf("ID = %q, want %q", retrieved.ID, mem.ID)
	}
	if retrieved.Content != mem.Content {
		t.Errorf("Content = %q, want %q", retrieved.Content, mem.Content)
	}
	if retrieved.Level != mem.Level {
		t.Errorf("Level = %q, want %q", retrieved.Level, mem.Level)
	}
}

func TestGobConsolidatedStorage_WorkingMemory(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	sessionID := "test-session"
	now := time.Now()

	// Create working memories
	for i := 0; i < 3; i++ {
		mem := &memory.ConsolidatedMemory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelWorking,
			Content:   "Working content",
			Embedding: []float64{float64(i), 0.2, 0.3},
			Context: memory.ConsolidationContext{
				SessionID: sessionID,
				Source:    "manual",
			},
			CreatedAt: now,
			UpdatedAt: now,
		}
		err := store.SaveConsolidated(ctx, mem)
		if err != nil {
			t.Fatalf("SaveConsolidated() error = %v", err)
		}
	}

	// List by session
	memories, err := store.ListWorkingBySession(ctx, sessionID)
	if err != nil {
		t.Fatalf("ListWorkingBySession() error = %v", err)
	}

	if len(memories) != 3 {
		t.Errorf("ListWorkingBySession() count = %d, want 3", len(memories))
	}

	// Delete by session
	err = store.DeleteWorkingBySession(ctx, sessionID)
	if err != nil {
		t.Fatalf("DeleteWorkingBySession() error = %v", err)
	}

	// Verify deletion
	memories, _ = store.ListWorkingBySession(ctx, sessionID)
	if len(memories) != 0 {
		t.Errorf("After deletion, count = %d, want 0", len(memories))
	}
}

func TestGobConsolidatedStorage_ListByLevel(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	// Create memories at different levels
	levels := map[memory.MemoryLevel]int{
		memory.MemoryLevelEpisodic: 2,
		memory.MemoryLevelSemantic: 3,
	}

	for level, count := range levels {
		for i := 0; i < count; i++ {
			mem := &memory.ConsolidatedMemory{
				ID:        uuid.New().String(),
				Level:     level,
				Content:   "Test content",
				Embedding: []float64{0.1, 0.2},
				Context: memory.ConsolidationContext{
					SessionID: "session",
					Source:    "manual",
				},
				CreatedAt: now,
				UpdatedAt: now,
			}
			_ = store.SaveConsolidated(ctx, mem)
		}
	}

	// List episodic
	episodic, err := store.ListByLevel(ctx, memory.MemoryLevelEpisodic)
	if err != nil {
		t.Fatalf("ListByLevel(episodic) error = %v", err)
	}
	if len(episodic) != 2 {
		t.Errorf("Episodic count = %d, want 2", len(episodic))
	}

	// List semantic
	semantic, err := store.ListByLevel(ctx, memory.MemoryLevelSemantic)
	if err != nil {
		t.Fatalf("ListByLevel(semantic) error = %v", err)
	}
	if len(semantic) != 3 {
		t.Errorf("Semantic count = %d, want 3", len(semantic))
	}
}

func TestGobConsolidatedStorage_Delete(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	mem := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelSemantic,
		Content:   "To delete",
		Embedding: []float64{0.1},
		Context: memory.ConsolidationContext{
			SessionID: "session",
			Source:    "manual",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	_ = store.SaveConsolidated(ctx, mem)

	// Delete
	err = store.DeleteConsolidated(ctx, mem.ID)
	if err != nil {
		t.Fatalf("DeleteConsolidated() error = %v", err)
	}

	// Verify deletion
	_, err = store.GetConsolidated(ctx, mem.ID)
	if err == nil {
		t.Error("GetConsolidated() should return error for deleted memory")
	}
}

func TestGobConsolidatedStorage_SearchByVector(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	// Create memories with different embeddings
	embeddings := [][]float64{
		{1.0, 0.0, 0.0},
		{0.9, 0.1, 0.0},
		{0.0, 1.0, 0.0},
	}

	for i, emb := range embeddings {
		mem := &memory.ConsolidatedMemory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelSemantic,
			Content:   "Test content",
			Embedding: emb,
			Context: memory.ConsolidationContext{
				SessionID: "session",
				Source:    "manual",
			},
			CreatedAt: now.Add(time.Duration(i) * time.Hour),
			UpdatedAt: now,
		}
		_ = store.SaveConsolidated(ctx, mem)
	}

	// Search
	query := []float64{1.0, 0.0, 0.0}
	matches, err := store.SearchConsolidatedByVector(ctx, query, memory.MemoryLevelSemantic, 2)
	if err != nil {
		t.Fatalf("SearchConsolidatedByVector() error = %v", err)
	}

	if len(matches) != 2 {
		t.Errorf("Match count = %d, want 2", len(matches))
	}

	// First match should be most similar
	if len(matches) > 0 && matches[0].Score < 0.9 {
		t.Errorf("First match score = %f, want >= 0.9", matches[0].Score)
	}
}

func TestGobConsolidatedStorage_ArchiveOlderThan(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	// Create old and new memories
	old := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Content:   "Old content",
		Embedding: []float64{0.1},
		Context: memory.ConsolidationContext{
			SessionID: "session",
			Source:    "manual",
		},
		CreatedAt: now.Add(-100 * 24 * time.Hour),
		UpdatedAt: now,
	}
	_ = store.SaveConsolidated(ctx, old)

	new := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Content:   "New content",
		Embedding: []float64{0.2},
		Context: memory.ConsolidationContext{
			SessionID: "session",
			Source:    "manual",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	_ = store.SaveConsolidated(ctx, new)

	// Archive
	cutoff := now.Add(-90 * 24 * time.Hour)
	archived, err := store.ArchiveOlderThan(ctx, memory.MemoryLevelEpisodic, cutoff)
	if err != nil {
		t.Fatalf("ArchiveOlderThan() error = %v", err)
	}

	if archived != 1 {
		t.Errorf("Archived = %d, want 1", archived)
	}

	// Verify only new memory remains
	memories, _ := store.ListByLevel(ctx, memory.MemoryLevelEpisodic)
	if len(memories) != 1 {
		t.Errorf("Remaining count = %d, want 1", len(memories))
	}
}

func TestGobConsolidatedStorage_MemoryCount(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	// Initial count should be 0
	if count := store.MemoryCount(); count != 0 {
		t.Errorf("Initial count = %d, want 0", count)
	}

	// Add memories
	for i := 0; i < 5; i++ {
		mem := &memory.ConsolidatedMemory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelSemantic,
			Content:   "Test",
			Embedding: []float64{0.1},
			Context: memory.ConsolidationContext{
				SessionID: "session",
				Source:    "manual",
			},
			CreatedAt: now,
			UpdatedAt: now,
		}
		_ = store.SaveConsolidated(ctx, mem)
	}

	if count := store.MemoryCount(); count != 5 {
		t.Errorf("Count after adding = %d, want 5", count)
	}
}

func TestGobConsolidatedStorage_CountByLevel(t *testing.T) {
	tempDir := t.TempDir()
	store, err := NewGobConsolidatedStorage(tempDir)
	if err != nil {
		t.Fatalf("NewGobConsolidatedStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	// Add memories at different levels
	levels := map[memory.MemoryLevel]int{
		memory.MemoryLevelEpisodic: 2,
		memory.MemoryLevelSemantic: 3,
	}

	for level, count := range levels {
		for i := 0; i < count; i++ {
			mem := &memory.ConsolidatedMemory{
				ID:        uuid.New().String(),
				Level:     level,
				Content:   "Test",
				Embedding: []float64{0.1},
				Context: memory.ConsolidationContext{
					SessionID: "session",
					Source:    "manual",
				},
				CreatedAt: now,
				UpdatedAt: now,
			}
			_ = store.SaveConsolidated(ctx, mem)
		}
	}

	counts := store.CountByLevel()

	if counts[memory.MemoryLevelEpisodic] != 2 {
		t.Errorf("Episodic count = %d, want 2", counts[memory.MemoryLevelEpisodic])
	}
	if counts[memory.MemoryLevelSemantic] != 3 {
		t.Errorf("Semantic count = %d, want 3", counts[memory.MemoryLevelSemantic])
	}
}

func TestGobConsolidatedStorage_Persistence(t *testing.T) {
	tempDir := t.TempDir()

	// Create and save
	store1, _ := NewGobConsolidatedStorage(tempDir)
	ctx := context.Background()
	now := time.Now()

	mem := &memory.ConsolidatedMemory{
		ID:        "persist-test-id",
		Level:     memory.MemoryLevelSemantic,
		Content:   "Persist test",
		Embedding: []float64{0.1, 0.2},
		Context: memory.ConsolidationContext{
			SessionID: "session",
			Source:    "manual",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	_ = store1.SaveConsolidated(ctx, mem)
	_ = store1.Close()

	// Reopen and verify
	store2, _ := NewGobConsolidatedStorage(tempDir)
	defer func() { _ = store2.Close() }()

	retrieved, err := store2.GetConsolidated(ctx, mem.ID)
	if err != nil {
		t.Fatalf("GetConsolidated() after reopen error = %v", err)
	}

	if retrieved.Content != mem.Content {
		t.Errorf("Content after reopen = %q, want %q", retrieved.Content, mem.Content)
	}
}
