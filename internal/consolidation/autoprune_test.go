package consolidation

import (
	"context"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/google/uuid"
)

func setupTestAutopruneService(t *testing.T) (*AutopruneService, *storage.GobConsolidatedStorage, *mockEmbedder) {
	t.Helper()

	tempDir := t.TempDir()
	store, err := storage.NewGobConsolidatedStorage(tempDir)
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

func createTestMemory(t *testing.T, store *storage.GobConsolidatedStorage, embedder *mockEmbedder, level memory.MemoryLevel, content string, createdAt time.Time) *memory.ConsolidatedMemory {
	t.Helper()

	ctx := context.Background()
	embedding, _ := embedder.Embed(ctx, content)

	mem := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     level,
		Content:   content,
		Embedding: embedding,
		Context: memory.ConsolidationContext{
			SessionID: "test-session",
			Source:    "manual",
		},
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}

	err := store.SaveConsolidated(ctx, mem)
	if err != nil {
		t.Fatalf("failed to save test memory: %v", err)
	}

	return mem
}

func TestAutopruneService_Run_DryRun(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	// Create some test memories
	now := time.Now()
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "test content 1", now)
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "test content 2", now.Add(-100*24*time.Hour)) // old

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

	// In dry run, no changes should be made
	if result.EpisodicArchived != 1 {
		t.Errorf("EpisodicArchived = %d, want 1 (in dry run)", result.EpisodicArchived)
	}

	// Verify details contain dry-run prefix
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

	// Verify memory still exists
	memories, _ := store.ListByLevel(ctx, memory.MemoryLevelEpisodic)
	if len(memories) != 2 {
		t.Errorf("Memory count = %d, want 2 (dry run should not delete)", len(memories))
	}
}

func TestAutopruneService_ArchiveEpisodic(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	now := time.Now()
	// Create old memory
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "old content", now.Add(-100*24*time.Hour))
	// Create recent memory
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

	// Verify only recent memory remains
	memories, _ := store.ListByLevel(ctx, memory.MemoryLevelEpisodic)
	if len(memories) != 1 {
		t.Errorf("Memory count = %d, want 1", len(memories))
	}
}

func TestAutopruneService_RunAll(t *testing.T) {
	svc, store, embedder := setupTestAutopruneService(t)
	defer func() { _ = store.Close() }()

	now := time.Now()
	// Create various memories
	createTestMemory(t, store, embedder, memory.MemoryLevelEpisodic, "episodic content", now)
	createTestMemory(t, store, embedder, memory.MemoryLevelSemantic, "semantic content", now)

	ctx := context.Background()
	// No specific options = run all
	opts := AutopruneOptions{
		DryRun: true,
	}

	result, err := svc.Run(ctx, opts)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	// Should complete without error
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
			expected: 0.707, // sqrt(2)/2
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
		{-1.0, 0.0, 0.001}, // negative returns 0
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
