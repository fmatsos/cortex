package consolidation

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
)

// mockEmbedder is a simple mock for testing

type mockEmbedder struct {
	embeddings map[string][]float64
	dimension  int
}

func newMockEmbedder() *mockEmbedder {
	return &mockEmbedder{
		embeddings: make(map[string][]float64),
		dimension:  384,
	}
}

func (m *mockEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
	if emb, ok := m.embeddings[text]; ok {
		return emb, nil
	}
	emb := make([]float64, m.dimension)
	for i := range emb {
		emb[i] = float64(len(text)+i) / float64(m.dimension*100)
	}
	m.embeddings[text] = emb
	return emb, nil
}

func setupTestService(t *testing.T) (*Service, *storage.GobStorage) {
	t.Helper()

	basePath := filepath.Join(t.TempDir(), "memories.gob")
	store, err := storage.NewGobStorage(basePath)
	if err != nil {
		t.Fatalf("failed to create storage: %v", err)
	}

	embedder := newMockEmbedder()
	cfg := &config.ConsolidationConfig{
		SimilarityThreshold:      0.85,
		PromptTemplate:           "default",
		AutoTransferOnSessionEnd: true,
	}

	svc := NewService(store, embedder, cfg)
	return svc, store
}

func TestService_Consolidate_CreateNew(t *testing.T) {
	svc, store := setupTestService(t)
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	input := memory.ConsolidateInput{
		Synthesis: "Test synthesis content",
		Level:     memory.MemoryLevelWorking,
		Context: memory.MemoryContext{
			SessionID: "test-session",
			Timestamp: time.Now(),
			Source:    "manual",
			Tags:      []string{"test"},
		},
		Force: false,
	}

	result, err := svc.Consolidate(ctx, input)
	if err != nil {
		t.Fatalf("Consolidate() error = %v", err)
	}

	if result.Action != "created" {
		t.Errorf("Action = %q, want %q", result.Action, "created")
	}

	if result.MemoryID == "" {
		t.Error("MemoryID should not be empty")
	}

	mem, err := svc.Get(ctx, result.MemoryID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if mem.Content != input.Synthesis {
		t.Errorf("Content = %q, want %q", mem.Content, input.Synthesis)
	}

	if mem.Level != input.Level {
		t.Errorf("Level = %q, want %q", mem.Level, input.Level)
	}
}

func TestService_Consolidate_Force(t *testing.T) {
	svc, store := setupTestService(t)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	input1 := memory.ConsolidateInput{
		Synthesis: "First synthesis",
		Level:     memory.MemoryLevelEpisodic,
		Context: memory.MemoryContext{
			SessionID: "session1",
			Source:    "manual",
		},
	}
	result1, _ := svc.Consolidate(ctx, input1)

	input2 := memory.ConsolidateInput{
		Synthesis: "First synthesis",
		Level:     memory.MemoryLevelEpisodic,
		Context: memory.MemoryContext{
			SessionID: "session1",
			Source:    "manual",
		},
		Force: true,
	}
	result2, err := svc.Consolidate(ctx, input2)
	if err != nil {
		t.Fatalf("Consolidate() error = %v", err)
	}

	if result2.Action != "created" {
		t.Errorf("Action = %q, want %q (force should create new)", result2.Action, "created")
	}

	if result2.MemoryID == result1.MemoryID {
		t.Error("Force should create a new memory with different ID")
	}
}

func TestService_List(t *testing.T) {
	svc, store := setupTestService(t)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	levels := []memory.MemoryLevel{
		memory.MemoryLevelWorking,
		memory.MemoryLevelEpisodic,
		memory.MemoryLevelSemantic,
	}

	for i, level := range levels {
		input := memory.ConsolidateInput{
			Synthesis: "Test content " + string(level),
			Level:     level,
			Context: memory.MemoryContext{
				SessionID: "session",
				Source:    "manual",
			},
			Force: true,
		}
		_, err := svc.Consolidate(ctx, input)
		if err != nil {
			t.Fatalf("Consolidate() #%d error = %v", i, err)
		}
	}

	episodic, err := svc.List(ctx, memory.MemoryLevelEpisodic)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(episodic) != 1 {
		t.Errorf("Episodic count = %d, want 1", len(episodic))
	}
}
