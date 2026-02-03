package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

func TestGobStorage_SaveAndGet(t *testing.T) {
	basePath := filepath.Join(t.TempDir(), "memories.gob")
	store, err := NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now()

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Title:     "Test title",
		Content:   "Test content",
		Embedding: []float64{0.1, 0.2, 0.3},
		Context: memory.MemoryContext{
			SessionID: "session123",
			Source:    "manual",
			Timestamp: now,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	err = store.Save(ctx, mem)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	retrieved, err := store.Get(ctx, mem.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
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

func TestGobStorage_WorkingMemory(t *testing.T) {
	basePath := filepath.Join(t.TempDir(), "memories.gob")
	store, err := NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	sessionID := "test-session"
	now := time.Now()

	for i := 0; i < 3; i++ {
		mem := &memory.Memory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelWorking,
			Title:     "Working title",
			Content:   "Working content",
			Embedding: []float64{float64(i), 0.2, 0.3},
			Context: memory.MemoryContext{
				SessionID: sessionID,
				Source:    "manual",
				Timestamp: now,
			},
			CreatedAt: now,
			UpdatedAt: now,
		}
		err := store.Save(ctx, mem)
		if err != nil {
			t.Fatalf("Save() error = %v", err)
		}
	}

	memories, err := store.List(ctx, memory.ListOptions{FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking}})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(memories) != 3 {
		t.Errorf("List() count = %d, want 3", len(memories))
	}

	transferred, err := store.TransferWorkingToEpisodic(ctx, sessionID)
	if err != nil {
		t.Fatalf("TransferWorkingToEpisodic() error = %v", err)
	}
	if transferred != 3 {
		t.Errorf("TransferWorkingToEpisodic() = %d, want 3", transferred)
	}

	workingAfter, err := store.List(ctx, memory.ListOptions{FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking}})
	if err != nil {
		t.Fatalf("List() after transfer error = %v", err)
	}
	if len(workingAfter) != 0 {
		t.Errorf("Working memories after transfer = %d, want 0", len(workingAfter))
	}
}

func TestGobStorage_SearchAllLayers(t *testing.T) {
	basePath := filepath.Join(t.TempDir(), "memories.gob")
	store, err := NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	memories := []*memory.Memory{
		{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelSemantic,
			Title:     "Semantic",
			Content:   "Semantic content",
			Embedding: []float64{0.1, 0.0, 0.0},
			Context:   memory.MemoryContext{Source: "manual", Timestamp: time.Now()},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelEpisodic,
			Title:     "Episodic",
			Content:   "Episodic content",
			Embedding: []float64{0.0, 0.1, 0.0},
			Context:   memory.MemoryContext{Source: "manual", Timestamp: time.Now()},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
	}

	for _, mem := range memories {
		if err := store.Save(ctx, mem); err != nil {
			t.Fatalf("Save() error = %v", err)
		}
	}

	results, err := store.SearchAllLayers(ctx, []float64{0.1, 0.0, 0.0}, memory.SearchOptions{TopK: 5, MinScore: 0})
	if err != nil {
		t.Fatalf("SearchAllLayers() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected search results")
	}
}

func TestGobStorage_Persistence(t *testing.T) {
	basePath := filepath.Join(t.TempDir(), "memories.gob")
	ctx := context.Background()

	store1, err := NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Title:     "Persisted",
		Content:   "Test content",
		Embedding: []float64{0.1, 0.2, 0.3},
		Context:   memory.MemoryContext{Source: "manual", Timestamp: time.Now()},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_ = store1.Save(ctx, mem)
	_ = store1.Close()

	store2, err := NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}
	defer func() { _ = store2.Close() }()

	retrieved, err := store2.Get(ctx, mem.ID)
	if err != nil {
		t.Fatalf("Get() after reopen error = %v", err)
	}
	if retrieved.ID != mem.ID {
		t.Errorf("ID after reopen = %q, want %q", retrieved.ID, mem.ID)
	}
}
