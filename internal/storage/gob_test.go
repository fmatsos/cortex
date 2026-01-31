package storage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

func TestGobStorage_NewGobStorage(t *testing.T) {
	tmpDir := t.TempDir()

	storage, err := NewGobStorage(tmpDir)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}

	if storage == nil {
		t.Fatal("NewGobStorage() returned nil storage")
	}

	// Verify directories were created
	memoriesDir := tmpDir + "/memories"
	if _, err := os.Stat(memoriesDir); err != nil {
		t.Errorf("Memories directory not created: %v", err)
	}
}

func TestGobStorage_SaveAndGet(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	m := &memory.Memory{
		ID:        "test-id",
		Title:     "Test Memory",
		Content:   "Test content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Tags:      []string{"test"},
		Embedding: []float64{0.1, 0.2, 0.3},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Obsolete:  false,
	}

	// Save memory
	err := storage.Save(context.Background(), m)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	// Get memory
	retrieved, err := storage.Get(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if retrieved.Title != m.Title {
		t.Errorf("Title = %v, want %v", retrieved.Title, m.Title)
	}

	if retrieved.Content != m.Content {
		t.Errorf("Content = %v, want %v", retrieved.Content, m.Content)
	}
}

func TestGobStorage_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	m := &memory.Memory{
		ID:        "test-id",
		Title:     "Test Memory",
		Content:   "Test content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_ = storage.Save(context.Background(), m)

	// Delete memory
	err := storage.Delete(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify it's deleted
	_, err = storage.Get(context.Background(), m.ID)
	if err == nil {
		t.Error("Get() should return error for deleted memory")
	}
}

func TestGobStorage_List(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	// Create multiple memories
	for i := 0; i < 3; i++ {
		var idStr string
		switch i {
		case 1:
			idStr = "test-1"
		case 2:
			idStr = "test-2"
		default:
			idStr = "test"
		}
		m := &memory.Memory{
			ID:        idStr,
			Title:     "Test Memory",
			Content:   "Test content",
			Types:     []memory.MemoryType{memory.MemoryTypeSolution},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		_ = storage.Save(context.Background(), m)
	}

	// List all
	memories, err := storage.List(context.Background(), memory.ListOptions{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(memories) != 3 {
		t.Errorf("List() returned %d memories, want 3", len(memories))
	}
}

func TestGobStorage_SearchByVector(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	// Create memories with embeddings
	embedding1 := []float64{1, 0, 0}
	embedding2 := []float64{0.9, 0.1, 0}
	embedding3 := []float64{0, 1, 0}

	m1 := &memory.Memory{
		ID:        "m1",
		Title:     "Memory 1",
		Content:   "Content 1",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Embedding: embedding1,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	m2 := &memory.Memory{
		ID:        "m2",
		Title:     "Memory 2",
		Content:   "Content 2",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Embedding: embedding2,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	m3 := &memory.Memory{
		ID:        "m3",
		Title:     "Memory 3",
		Content:   "Content 3",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Embedding: embedding3,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_ = storage.Save(context.Background(), m1)
	_ = storage.Save(context.Background(), m2)
	_ = storage.Save(context.Background(), m3)

	// Search with query similar to embedding1
	queryEmbedding := []float64{0.95, 0.05, 0}
	matches, err := storage.SearchByVector(context.Background(), queryEmbedding, 10)
	if err != nil {
		t.Fatalf("SearchByVector() error = %v", err)
	}

	if len(matches) != 3 {
		t.Errorf("SearchByVector() returned %d matches, want 3", len(matches))
	}

	// First match should be most similar
	if matches[0].MemoryID != "m1" && matches[0].MemoryID != "m2" {
		t.Errorf("First match ID = %v, want m1 or m2", matches[0].MemoryID)
	}

	// Scores should be in descending order
	for i := 1; i < len(matches); i++ {
		if matches[i].Score > matches[i-1].Score {
			t.Errorf("Scores not in descending order: %v > %v", matches[i].Score, matches[i-1].Score)
		}
	}
}

func TestGobStorage_Update(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	m := &memory.Memory{
		ID:        "test-id",
		Title:     "Original Title",
		Content:   "Content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_ = storage.Save(context.Background(), m)

	// Update
	m.Title = "Updated Title"
	err := storage.Update(context.Background(), m)
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	// Retrieve and verify
	retrieved, _ := storage.Get(context.Background(), m.ID)
	if retrieved.Title != "Updated Title" {
		t.Errorf("Title = %v, want Updated Title", retrieved.Title)
	}
}

func TestGobStorage_List_FilterByType(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	// Create memories with different types
	m1 := &memory.Memory{
		ID:        "m1",
		Title:     "Solution",
		Content:   "Content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	m2 := &memory.Memory{
		ID:        "m2",
		Title:     "Issue",
		Content:   "Content",
		Types:     []memory.MemoryType{memory.MemoryTypeIssue},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_ = storage.Save(context.Background(), m1)
	_ = storage.Save(context.Background(), m2)

	// List only solutions
	opts := memory.ListOptions{
		FilterTypes: []memory.MemoryType{memory.MemoryTypeSolution},
	}
	memories, _ := storage.List(context.Background(), opts)

	if len(memories) != 1 {
		t.Errorf("List() with filter returned %d memories, want 1", len(memories))
	}

	if memories[0].ID != "m1" {
		t.Errorf("Filtered memory ID = %v, want m1", memories[0].ID)
	}
}

func TestGobStorage_Close(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	err := storage.Close()
	if err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestGobStorage_IndexPersistence(t *testing.T) {
	tmpDir := t.TempDir()

	// Create storage and save a memory
	storage1, _ := NewGobStorage(tmpDir)
	m := &memory.Memory{
		ID:        "test-id",
		Title:     "Test",
		Content:   "Content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Embedding: []float64{0.1, 0.2, 0.3},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_ = storage1.Save(context.Background(), m)
	_ = storage1.Close()

	// Create new storage instance and verify index is loaded
	storage2, _ := NewGobStorage(tmpDir)
	matches, _ := storage2.SearchByVector(context.Background(), []float64{0.1, 0.2, 0.3}, 10)

	if len(matches) != 1 {
		t.Errorf("Index persistence failed: expected 1 match, got %d", len(matches))
	}
}
