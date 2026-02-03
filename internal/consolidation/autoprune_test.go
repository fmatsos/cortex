package consolidation

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/google/uuid"
)

func setupTestAutopruneService(t *testing.T) (*AutopruneService, *storage.GobStorage, *mockEmbedder) {
	t.Helper()

	basePath := filepath.Join(t.TempDir(), "memories.gob")
	store, err := storage.NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("failed to create storage: %v", err)
	}

	embedder := newMockEmbedder()
	cfg := &config.AutopruneConfig{
		DuplicatesThreshold:    0.92,
		EpisodicRetentionDays:  90,
		SemanticMergeThreshold: 0.88,
	}

	svc := NewAutopruneService(store, embedder, cfg)
	return svc, store, embedder
}

func createTestMemory(t *testing.T, store *storage.GobStorage, embedder *mockEmbedder, level memory.MemoryLevel, content string, createdAt time.Time) *memory.Memory {
	t.Helper()

	ctx := context.Background()
	embedding, _ := embedder.Embed(ctx, content)

	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     level,
		Title:     "Test",
		Content:   content,
		Embedding: embedding,
		Context: memory.MemoryContext{
			SessionID: "test-session",
			Source:    "manual",
			Timestamp: createdAt,
		},
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}

	err := store.Save(ctx, mem)
	if err != nil {
		t.Fatalf("failed to save test memory: %v", err)
	}

	return mem
}

func TestAutopruneService_Run_DryRun(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	now := time.Now()
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "test content 1", now)
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "test content 2", now.Add(-100*24*time.Hour))

	ctx := context.Background()
	opts := AutopruneOptions{
		DryRun:          true,
		ArchiveEpisodic: true,
		OlderThan:       90 * 24 * time.Hour,
	}

	result, err := svc.Run(ctx, opts)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	if result.EpisodicArchived != 1 {
		t.Errorf("EpisodicArchived = %d, want 1 (in dry run)", result.EpisodicArchived)
	}

	hasDetails := false
	for _, detail := range result.Details {
		if len(detail) > 9 && detail[:9] == "[dry-run]" {
			hasDetails = true
			break
		}
	}
	if result.EpisodicArchived > 0 && !hasDetails {
		t.Error("Dry run should include [dry-run] prefix in details")
	}

	memories, _ := store.List(ctx, memory.ListOptions{FilterLevels: []memory.MemoryLevel{memory.MemoryLevelEpisodic}})
	if len(memories) != 2 {
		t.Errorf("Memory count = %d, want 2 (dry run should not delete)", len(memories))
	}
}

func TestAutopruneService_ArchiveEpisodic(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	now := time.Now()
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "old content", now.Add(-100*24*time.Hour))
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "recent content", now)

	ctx := context.Background()
	opts := AutopruneOptions{
		ArchiveEpisodic: true,
		OlderThan:       90 * 24 * time.Hour,
		DryRun:          false,
	}

	result, err := svc.Run(ctx, opts)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	if result.EpisodicArchived != 1 {
		t.Errorf("EpisodicArchived = %d, want 1", result.EpisodicArchived)
	}

	memories, _ := store.List(ctx, memory.ListOptions{FilterLevels: []memory.MemoryLevel{memory.MemoryLevelEpisodic}})
	if len(memories) != 1 {
		t.Errorf("Memory count = %d, want 1", len(memories))
	}
}

func TestAutopruneService_RunAll(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	now := time.Now()
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "episodic content", now)
	createTestMemory(t, store, embedder, memory.MemoryLevelSemantic, "semantic content", now)

	ctx := context.Background()
	opts := AutopruneOptions{
		DryRun: true,
	}

	result, err := svc.Run(ctx, opts)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	if result == nil {
		t.Error("Result should not be nil")
	}
}

func TestCosineSimilarity(t *testing.T) {
	tests := []struct {
		name     string
		a        []float64
		b        []float64
		expected float64
		delta    float64
	}{
		{
			name:     "identical vectors",
			a:        []float64{1, 0, 0},
			b:        []float64{1, 0, 0},
			expected: 1.0,
			delta:    0.001,
		},
		{
			name:     "orthogonal vectors",
			a:        []float64{1, 0, 0},
			b:        []float64{0, 1, 0},
			expected: 0.0,
			delta:    0.001,
		},
		{
			name:     "similar vectors",
			a:        []float64{1, 1, 0},
			b:        []float64{1, 0, 0},
			expected: 0.707,
			delta:    0.01,
		},
		{
			name:     "empty vectors",
			a:        []float64{},
			b:        []float64{},
			expected: 0.0,
			delta:    0.001,
		},
		{
			name:     "different length",
			a:        []float64{1, 2},
			b:        []float64{1, 2, 3},
			expected: 0.0,
			delta:    0.001,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := cosineSimilarity(tt.a, tt.b)
			diff := result - tt.expected
			if diff < 0 {
				diff = -diff
			}
			if diff > tt.delta {
				t.Errorf("cosineSimilarity(%v, %v) = %f, want %f (delta %f)", tt.a, tt.b, result, tt.expected, tt.delta)
			}
		})
	}
}

func TestSqrt(t *testing.T) {
	tests := []struct {
		input    float64
		expected float64
		delta    float64
	}{
		{4.0, 2.0, 0.001},
		{9.0, 3.0, 0.001},
		{2.0, 1.414, 0.01},
		{0.0, 0.0, 0.001},
		{-1.0, 0.0, 0.001},
	}

	for _, tt := range tests {
		result := sqrt(tt.input)
		diff := result - tt.expected
		if diff < 0 {
			diff = -diff
		}
		if diff > tt.delta {
			t.Errorf("sqrt(%f) = %f, want %f", tt.input, result, tt.expected)
		}
	}
}
