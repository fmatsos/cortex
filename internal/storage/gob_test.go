package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// Test helpers

func createTestMemory(id, title string) *memory.Memory {
	return &memory.Memory{
		ID:        id,
		Title:     title,
		Content:   "Test content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Tags:      []string{"test"},
		Embedding: []float64{0.1, 0.2, 0.3},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Obsolete:  false,
	}
}

// Tests for Single Mode (default)

func TestGobStorage_NewGobStorage_SingleMode(t *testing.T) {
	tmpDir := t.TempDir()

	storage, err := NewGobStorage(tmpDir)
	if err != nil {
		t.Fatalf("NewGobStorage() error = %v", err)
	}

	if storage == nil {
		t.Fatal("NewGobStorage() returned nil storage")
	}

	if storage.Mode() != ModeSingle {
		t.Errorf("Mode() = %v, want %v", storage.Mode(), ModeSingle)
	}

	expectedPath := filepath.Join(tmpDir, "cortex.gob")
	if storage.FilePath() != expectedPath {
		t.Errorf("FilePath() = %v, want %v", storage.FilePath(), expectedPath)
	}
}

func TestGobStorage_SingleMode_SaveAndGet(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	m := createTestMemory("test-id", "Test Memory")

	err := storage.Save(context.Background(), m)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if _, err := os.Stat(storage.FilePath()); err != nil {
		t.Errorf("Storage file not created: %v", err)
	}

	retrieved, err := storage.Get(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if retrieved.Title != m.Title {
		t.Errorf("Title = %v, want %v", retrieved.Title, m.Title)
	}
}

func TestGobStorage_SingleMode_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	m := createTestMemory("test-id", "Test Memory")
	_ = storage.Save(context.Background(), m)

	err := storage.Delete(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	_, err = storage.Get(context.Background(), m.ID)
	if err == nil {
		t.Error("Get() should return error for deleted memory")
	}

	if storage.MemoryCount() != 0 {
		t.Errorf("MemoryCount() = %d, want 0", storage.MemoryCount())
	}
}

func TestGobStorage_SingleMode_SingleFile(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorage(tmpDir)

	for i := 0; i < 5; i++ {
		m := createTestMemory("mem-"+string(rune('a'+i)), "Memory")
		_ = storage.Save(context.Background(), m)
	}
	_ = storage.Close()

	entries, _ := os.ReadDir(tmpDir)
	if len(entries) != 1 {
		t.Errorf("Expected 1 file, got %d", len(entries))
	}

	if entries[0].Name() != "cortex.gob" {
		t.Errorf("Expected cortex.gob, got %s", entries[0].Name())
	}
}

func TestGobStorage_SingleMode_Persistence(t *testing.T) {
	tmpDir := t.TempDir()

	storage1, _ := NewGobStorage(tmpDir)
	m := createTestMemory("test-id", "Test")
	_ = storage1.Save(context.Background(), m)
	_ = storage1.Close()

	storage2, _ := NewGobStorage(tmpDir)

	retrieved, err := storage2.Get(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Memory persistence failed: %v", err)
	}
	if retrieved.Title != m.Title {
		t.Errorf("Persisted Title = %v, want %v", retrieved.Title, m.Title)
	}

	matches, _ := storage2.SearchByVector(context.Background(), []float64{0.1, 0.2, 0.3}, 10)
	if len(matches) != 1 {
		t.Errorf("Index persistence failed: expected 1 match, got %d", len(matches))
	}
}

// Tests for Multi Mode

func TestGobStorage_NewGobStorage_MultiMode(t *testing.T) {
	tmpDir := t.TempDir()

	storage, err := NewGobStorageWithMode(tmpDir, ModeMulti)
	if err != nil {
		t.Fatalf("NewGobStorageWithMode() error = %v", err)
	}

	if storage.Mode() != ModeMulti {
		t.Errorf("Mode() = %v, want %v", storage.Mode(), ModeMulti)
	}

	memoriesDir := filepath.Join(tmpDir, "memories")
	if _, err := os.Stat(memoriesDir); err != nil {
		t.Errorf("Memories directory not created: %v", err)
	}

	expectedPath := filepath.Join(tmpDir, "memories")
	if storage.FilePath() != expectedPath {
		t.Errorf("FilePath() = %v, want %v", storage.FilePath(), expectedPath)
	}
}

func TestGobStorage_MultiMode_SaveAndGet(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorageWithMode(tmpDir, ModeMulti)

	m := createTestMemory("test-id", "Test Memory")

	err := storage.Save(context.Background(), m)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	// Verify individual file was created
	memFile := filepath.Join(tmpDir, "memories", m.ID+".gob")
	if _, err := os.Stat(memFile); err != nil {
		t.Errorf("Memory file not created: %v", err)
	}

	retrieved, err := storage.Get(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if retrieved.Title != m.Title {
		t.Errorf("Title = %v, want %v", retrieved.Title, m.Title)
	}
}

func TestGobStorage_MultiMode_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorageWithMode(tmpDir, ModeMulti)

	m := createTestMemory("test-id", "Test Memory")
	_ = storage.Save(context.Background(), m)

	err := storage.Delete(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify file was deleted
	memFile := filepath.Join(tmpDir, "memories", m.ID+".gob")
	if _, err := os.Stat(memFile); err == nil {
		t.Error("Memory file should be deleted")
	}

	_, err = storage.Get(context.Background(), m.ID)
	if err == nil {
		t.Error("Get() should return error for deleted memory")
	}
}

func TestGobStorage_MultiMode_MultipleFiles(t *testing.T) {
	tmpDir := t.TempDir()
	storage, _ := NewGobStorageWithMode(tmpDir, ModeMulti)

	for i := 0; i < 5; i++ {
		m := createTestMemory("mem-"+string(rune('a'+i)), "Memory")
		_ = storage.Save(context.Background(), m)
	}
	_ = storage.Close()

	// Verify multiple files in memories directory
	memoriesDir := filepath.Join(tmpDir, "memories")
	entries, _ := os.ReadDir(memoriesDir)
	if len(entries) != 5 {
		t.Errorf("Expected 5 memory files, got %d", len(entries))
	}

	// Verify index file exists
	indexFile := filepath.Join(tmpDir, "index.gob")
	if _, err := os.Stat(indexFile); err != nil {
		t.Errorf("Index file not created: %v", err)
	}
}

func TestGobStorage_MultiMode_Persistence(t *testing.T) {
	tmpDir := t.TempDir()

	storage1, _ := NewGobStorageWithMode(tmpDir, ModeMulti)
	m := createTestMemory("test-id", "Test")
	_ = storage1.Save(context.Background(), m)
	_ = storage1.Close()

	storage2, _ := NewGobStorageWithMode(tmpDir, ModeMulti)

	retrieved, err := storage2.Get(context.Background(), m.ID)
	if err != nil {
		t.Fatalf("Memory persistence failed: %v", err)
	}
	if retrieved.Title != m.Title {
		t.Errorf("Persisted Title = %v, want %v", retrieved.Title, m.Title)
	}

	matches, _ := storage2.SearchByVector(context.Background(), []float64{0.1, 0.2, 0.3}, 10)
	if len(matches) != 1 {
		t.Errorf("Index persistence failed: expected 1 match, got %d", len(matches))
	}
}

// Common tests (run for both modes)

func TestGobStorage_DeleteNonExistent(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			err := storage.Delete(context.Background(), "non-existent-id")
			if err == nil {
				t.Error("Delete() should return error for non-existent memory")
			}
		})
	}
}

func TestGobStorage_List(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			for i := 0; i < 3; i++ {
				m := createTestMemory("test-"+string(rune('0'+i)), "Test Memory")
				_ = storage.Save(context.Background(), m)
			}

			memories, err := storage.List(context.Background(), memory.ListOptions{})
			if err != nil {
				t.Fatalf("List() error = %v", err)
			}

			if len(memories) != 3 {
				t.Errorf("List() returned %d memories, want 3", len(memories))
			}

			if storage.MemoryCount() != 3 {
				t.Errorf("MemoryCount() = %d, want 3", storage.MemoryCount())
			}
		})
	}
}

func TestGobStorage_SearchByVector(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			m1 := &memory.Memory{
				ID:        "m1",
				Title:     "Memory 1",
				Content:   "Content 1",
				Types:     []memory.MemoryType{memory.MemoryTypeSolution},
				Embedding: []float64{1, 0, 0},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			m2 := &memory.Memory{
				ID:        "m2",
				Title:     "Memory 2",
				Content:   "Content 2",
				Types:     []memory.MemoryType{memory.MemoryTypeSolution},
				Embedding: []float64{0.9, 0.1, 0},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			m3 := &memory.Memory{
				ID:        "m3",
				Title:     "Memory 3",
				Content:   "Content 3",
				Types:     []memory.MemoryType{memory.MemoryTypeSolution},
				Embedding: []float64{0, 1, 0},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}

			_ = storage.Save(context.Background(), m1)
			_ = storage.Save(context.Background(), m2)
			_ = storage.Save(context.Background(), m3)

			queryEmbedding := []float64{0.95, 0.05, 0}
			matches, err := storage.SearchByVector(context.Background(), queryEmbedding, 10)
			if err != nil {
				t.Fatalf("SearchByVector() error = %v", err)
			}

			if len(matches) != 3 {
				t.Errorf("SearchByVector() returned %d matches, want 3", len(matches))
			}

			if matches[0].MemoryID != "m1" && matches[0].MemoryID != "m2" {
				t.Errorf("First match ID = %v, want m1 or m2", matches[0].MemoryID)
			}

			for i := 1; i < len(matches); i++ {
				if matches[i].Score > matches[i-1].Score {
					t.Errorf("Scores not in descending order: %v > %v", matches[i].Score, matches[i-1].Score)
				}
			}
		})
	}
}

func TestGobStorage_Update(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			m := createTestMemory("test-id", "Original Title")
			_ = storage.Save(context.Background(), m)

			m.Title = "Updated Title"
			err := storage.Update(context.Background(), m)
			if err != nil {
				t.Fatalf("Update() error = %v", err)
			}

			retrieved, _ := storage.Get(context.Background(), m.ID)
			if retrieved.Title != "Updated Title" {
				t.Errorf("Title = %v, want Updated Title", retrieved.Title)
			}
		})
	}
}

func TestGobStorage_List_FilterByType(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

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
		})
	}
}

func TestGobStorage_List_FilterObsolete(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			m1 := &memory.Memory{
				ID:        "m1",
				Title:     "Active",
				Content:   "Content",
				Types:     []memory.MemoryType{memory.MemoryTypeSolution},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
				Obsolete:  false,
			}
			m2 := &memory.Memory{
				ID:        "m2",
				Title:     "Obsolete",
				Content:   "Content",
				Types:     []memory.MemoryType{memory.MemoryTypeSolution},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
				Obsolete:  true,
			}

			_ = storage.Save(context.Background(), m1)
			_ = storage.Save(context.Background(), m2)

			memories, _ := storage.List(context.Background(), memory.ListOptions{})
			if len(memories) != 1 {
				t.Errorf("List() without obsolete returned %d memories, want 1", len(memories))
			}

			memories, _ = storage.List(context.Background(), memory.ListOptions{IncludeObsolete: true})
			if len(memories) != 2 {
				t.Errorf("List() with obsolete returned %d memories, want 2", len(memories))
			}
		})
	}
}

func TestGobStorage_Close(t *testing.T) {
	modes := []StorageMode{ModeSingle, ModeMulti}

	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			tmpDir := t.TempDir()
			storage, _ := NewGobStorageWithMode(tmpDir, mode)

			err := storage.Close()
			if err != nil {
				t.Fatalf("Close() error = %v", err)
			}
		})
	}
}
