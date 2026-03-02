//go:build lancedb

package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

func newTestLanceDB(t *testing.T) *LanceDBStorage {
	t.Helper()
	store, err := NewLanceDBStorage(filepath.Join(t.TempDir(), "lancedb"))
	if err != nil {
		t.Fatalf("NewLanceDBStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// unitVec returns a dim-dimensional unit vector with a 1.0 at index seed%dim.
func unitVec(dim, seed int) []float64 {
	v := make([]float64, dim)
	v[seed%dim] = 1.0
	return v
}

func TestLanceDBStorage_SaveAndGet(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()
	now := time.Now()

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Title:     "Test title",
		Content:   "Test content for lancedb",
		Embedding: []float64{0.1, 0.2, 0.3},
		Context: memory.MemoryContext{
			SessionID: "session123",
			Source:    "manual",
			Timestamp: now,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := store.Save(ctx, mem); err != nil {
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

func TestLanceDBStorage_WorkingMemory(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()
	sessionID := "test-session"
	now := time.Now()

	for i := 0; i < 3; i++ {
		mem := &memory.Memory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelWorking,
			Title:     "Working title",
			Content:   "Working content for lancedb",
			Embedding: unitVec(4, i),
			Context: memory.MemoryContext{
				SessionID: sessionID,
				Source:    "manual",
				Timestamp: now,
			},
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := store.Save(ctx, mem); err != nil {
			t.Fatalf("Save() error = %v", err)
		}
	}

	memories, err := store.List(ctx, memory.ListOptions{
		FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking},
	})
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

	workingAfter, err := store.List(ctx, memory.ListOptions{
		FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking},
	})
	if err != nil {
		t.Fatalf("List() after transfer error = %v", err)
	}
	if len(workingAfter) != 0 {
		t.Errorf("Working after transfer = %d, want 0", len(workingAfter))
	}
}

func TestLanceDBStorage_SearchAllLayers(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()

	memories := []*memory.Memory{
		{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelSemantic,
			Title:     "Semantic",
			Content:   "Semantic content lancedb",
			Embedding: unitVec(4, 0), // [1,0,0,0]
			Context:   memory.MemoryContext{Source: "manual", Timestamp: time.Now()},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelEpisodic,
			Title:     "Episodic",
			Content:   "Episodic content lancedb",
			Embedding: unitVec(4, 1), // [0,1,0,0]
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

	// Query closest to first memory ([1,0,0,0]).
	results, err := store.SearchAllLayers(ctx, unitVec(4, 0), memory.SearchOptions{
		TopK:     5,
		MinScore: 0,
	})
	if err != nil {
		t.Fatalf("SearchAllLayers() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected search results")
	}
	if results[0].Memory.Level != memory.MemoryLevelSemantic {
		t.Errorf("top result level = %q, want semantic", results[0].Memory.Level)
	}
}

func TestLanceDBStorage_FilterLevels(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()
	now := time.Now()

	for _, level := range []memory.MemoryLevel{memory.MemoryLevelEpisodic, memory.MemoryLevelSemantic} {
		m := &memory.Memory{
			ID:        uuid.New().String(),
			Level:     level,
			Title:     "Title " + string(level),
			Content:   "Content for " + string(level),
			Embedding: unitVec(4, 0),
			Context:   memory.MemoryContext{Source: "manual", Timestamp: now},
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := store.Save(ctx, m); err != nil {
			t.Fatalf("Save(%s) error = %v", level, err)
		}
	}

	results, err := store.SearchAllLayers(ctx, unitVec(4, 0), memory.SearchOptions{
		TopK:         10,
		MinScore:     0,
		FilterLevels: []memory.MemoryLevel{memory.MemoryLevelSemantic},
	})
	if err != nil {
		t.Fatalf("SearchAllLayers() error = %v", err)
	}
	for _, r := range results {
		if r.Memory.Level != memory.MemoryLevelSemantic {
			t.Errorf("got level %q in filtered search, want semantic", r.Memory.Level)
		}
	}
}

func TestLanceDBStorage_Update(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()
	now := time.Now()

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Title:     "Original",
		Content:   "Original content lancedb",
		Embedding: unitVec(4, 0),
		Context:   memory.MemoryContext{Source: "manual", Timestamp: now},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(ctx, mem); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	mem.Title = "Updated"
	mem.Content = "Updated content lancedb"
	if err := store.Update(ctx, mem); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	retrieved, err := store.Get(ctx, mem.ID)
	if err != nil {
		t.Fatalf("Get() after Update() error = %v", err)
	}
	if retrieved.Title != "Updated" {
		t.Errorf("Title = %q, want Updated", retrieved.Title)
	}
}

func TestLanceDBStorage_Delete(t *testing.T) {
	store := newTestLanceDB(t)
	ctx := context.Background()
	now := time.Now()

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     memory.MemoryLevelEpisodic,
		Title:     "To Delete",
		Content:   "Content to be deleted lancedb",
		Embedding: unitVec(4, 0),
		Context:   memory.MemoryContext{Source: "manual", Timestamp: now},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(ctx, mem); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if err := store.Delete(ctx, mem.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Get(ctx, mem.ID); err == nil {
		t.Error("Get() after Delete() should return error, got nil")
	}
}
