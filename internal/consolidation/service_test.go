package consolidation

import (
	"context"
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
	// Return cached or generate simple embedding
	if emb, ok := m.embeddings[text]; ok {
		return emb, nil
	}
	// Generate a simple deterministic embedding based on text length
	emb := make([]float64, m.dimension)
	for i := range emb {
		emb[i] = float64(len(text)+i) / float64(m.dimension*100)
	}
	m.embeddings[text] = emb
	return emb, nil
}

func (m *mockEmbedder) EmbedBatch(ctx context.Context, texts []string) ([][]float64, error) {
	result := make([][]float64, len(texts))
	for i, text := range texts {
		emb, err := m.Embed(ctx, text)
		if err != nil {
			return nil, err
		}
		result[i] = emb
	}
	return result, nil
}

func (m *mockEmbedder) Dimension() int {
	return m.dimension
}

func setupTestService(t *testing.T) (*Service, *storage.GobConsolidatedStorage) {
	t.Helper()

	tempDir := t.TempDir()
	store, err := storage.NewGobConsolidatedStorage(tempDir)
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
		Context: memory.ConsolidationContext{
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

	// Verify memory was saved
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

	// Create first memory
	input1 := memory.ConsolidateInput{
		Synthesis: "First synthesis",
		Level:     memory.MemoryLevelEpisodic,
		Context: memory.ConsolidationContext{
			SessionID: "session1",
			Source:    "manual",
		},
	}
	result1, _ := svc.Consolidate(ctx, input1)

	// Create second memory with force (should create new, not merge)
	input2 := memory.ConsolidateInput{
		Synthesis: "First synthesis", // same content
		Level:     memory.MemoryLevelEpisodic,
		Context: memory.ConsolidationContext{
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

	// Create memories at different levels
	levels := []memory.MemoryLevel{
		memory.MemoryLevelWorking,
		memory.MemoryLevelEpisodic,
		memory.MemoryLevelSemantic,
	}

	for i, level := range levels {
		input := memory.ConsolidateInput{
			Synthesis: "Test content " + string(level),
			Level:     level,
			Context: memory.ConsolidationContext{
				SessionID: "session",
				Source:    "manual",
			},
			Force: true, // force to avoid merging
		}
		_, err := svc.Consolidate(ctx, input)
		if err != nil {
			t.Fatalf("Consolidate() #%d error = %v", i, err)
		}
	}

	// List episodic memories
	episodic, err := svc.List(ctx, memory.MemoryLevelEpisodic)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(episodic) != 1 {
		t.Errorf("Episodic count = %d, want 1", len(episodic))
	}
}

func TestService_TransferWorkingToEpisodic(t *testing.T) {
	svc, store := setupTestService(t)
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	sessionID := "test-session-transfer"

	// Create working memories
	for i := 0; i < 3; i++ {
		input := memory.ConsolidateInput{
			Synthesis: "Working content",
			Level:     memory.MemoryLevelWorking,
			Context: memory.ConsolidationContext{
				SessionID: sessionID,
				Source:    "manual",
			},
			Force: true,
		}
		_, err := svc.Consolidate(ctx, input)
		if err != nil {
			t.Fatalf("Consolidate() error = %v", err)
		}
	}

	// Verify working memories exist
	working, _ := store.ListWorkingBySession(ctx, sessionID)
	if len(working) != 3 {
		t.Fatalf("Working count = %d, want 3", len(working))
	}

	// Transfer
	transferred, err := svc.TransferWorkingToEpisodic(ctx, sessionID)
	if err != nil {
		t.Fatalf("TransferWorkingToEpisodic() error = %v", err)
	}

	if transferred != 3 {
		t.Errorf("Transferred = %d, want 3", transferred)
	}

	// Verify working memories are deleted
	working, _ = store.ListWorkingBySession(ctx, sessionID)
	if len(working) != 0 {
		t.Errorf("Working count after transfer = %d, want 0", len(working))
	}

	// Verify episodic memories were created
	episodic, _ := svc.List(ctx, memory.MemoryLevelEpisodic)
	if len(episodic) < 3 {
		t.Errorf("Episodic count = %d, want >= 3", len(episodic))
	}
}

func TestService_Delete(t *testing.T) {
	svc, store := setupTestService(t)
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	input := memory.ConsolidateInput{
		Synthesis: "To be deleted",
		Level:     memory.MemoryLevelSemantic,
		Context: memory.ConsolidationContext{
			SessionID: "session",
			Source:    "manual",
		},
	}

	result, _ := svc.Consolidate(ctx, input)

	// Delete
	err := svc.Delete(ctx, result.MemoryID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify deletion
	_, err = svc.Get(ctx, result.MemoryID)
	if err == nil {
		t.Error("Get() should return error for deleted memory")
	}
}

func TestMergeTags(t *testing.T) {
	tests := []struct {
		existing []string
		new      []string
		want     int // expected unique count
	}{
		{[]string{"a", "b"}, []string{"c", "d"}, 4},
		{[]string{"a", "b"}, []string{"b", "c"}, 3},
		{[]string{}, []string{"a"}, 1},
		{[]string{"a"}, []string{}, 1},
	}

	for _, tt := range tests {
		result := mergeTags(tt.existing, tt.new)
		if len(result) != tt.want {
			t.Errorf("mergeTags(%v, %v) = %d items, want %d", tt.existing, tt.new, len(result), tt.want)
		}
	}
}
