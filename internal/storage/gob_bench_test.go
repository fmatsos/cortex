package storage

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

// BenchmarkGobStorageSave benchmarks memory save operations
func BenchmarkGobStorageSave(b *testing.B) {
	tmpDir, err := os.MkdirTemp("", "cortex-bench-save")
	if err != nil {
		b.Fatalf("failed to create temp dir: %v", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	storage, err := NewGobStorage(tmpDir)
	if err != nil {
		b.Fatalf("failed to create storage: %v", err)
	}
	defer func() { _ = storage.Close() }()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mem := &memory.Memory{
			ID:        uuid.New().String(),
			Title:     fmt.Sprintf("Benchmark Memory %d", i),
			Content:   "Benchmark content for testing save performance",
			Types:     []memory.MemoryType{memory.MemoryTypeSolution},
			Tags:      []string{"benchmark", "test"},
			Embedding: make([]float64, 384),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := storage.Save(ctx, mem); err != nil {
			b.Fatalf("save failed: %v", err)
		}
	}
}

// BenchmarkGobStorageGet benchmarks memory retrieval
func BenchmarkGobStorageGet(b *testing.B) {
	tmpDir, err := os.MkdirTemp("", "cortex-bench-get")
	if err != nil {
		b.Fatalf("failed to create temp dir: %v", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	storage, err := NewGobStorage(tmpDir)
	if err != nil {
		b.Fatalf("failed to create storage: %v", err)
	}
	defer func() { _ = storage.Close() }()

	ctx := context.Background()

	// Create a memory to retrieve
	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Title:     "Benchmark Memory",
		Content:   "Benchmark content",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution},
		Embedding: make([]float64, 384),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := storage.Save(ctx, mem); err != nil {
		b.Fatalf("save failed: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := storage.Get(ctx, mem.ID); err != nil {
			b.Fatalf("get failed: %v", err)
		}
	}
}

// BenchmarkGobStorageSearchByVector benchmarks vector search
func BenchmarkGobStorageSearchByVector(b *testing.B) {
	sizes := []int{10, 100, 500}

	for _, size := range sizes {
		b.Run(fmt.Sprintf("%d_memories", size), func(b *testing.B) {
			tmpDir, err := os.MkdirTemp("", "cortex-bench-search")
			if err != nil {
				b.Fatalf("failed to create temp dir: %v", err)
			}
			defer func() { _ = os.RemoveAll(tmpDir) }()

			storage, err := NewGobStorage(tmpDir)
			if err != nil {
				b.Fatalf("failed to create storage: %v", err)
			}
			defer func() { _ = storage.Close() }()

			ctx := context.Background()

			// Create memories
			for i := 0; i < size; i++ {
				embedding := make([]float64, 384)
				for j := range embedding {
					embedding[j] = float64(i+j) / float64(size+384)
				}

				mem := &memory.Memory{
					ID:        uuid.New().String(),
					Title:     fmt.Sprintf("Memory %d", i),
					Content:   "Test content",
					Types:     []memory.MemoryType{memory.MemoryTypeSolution},
					Embedding: embedding,
					CreatedAt: time.Now(),
					UpdatedAt: time.Now(),
				}
				if err := storage.Save(ctx, mem); err != nil {
					b.Fatalf("save failed: %v", err)
				}
			}

			query := make([]float64, 384)
			for i := range query {
				query[i] = float64(i) / 384.0
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := storage.SearchByVector(ctx, query, 5); err != nil {
					b.Fatalf("search failed: %v", err)
				}
			}
		})
	}
}
