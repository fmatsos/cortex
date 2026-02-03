package memory

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// MockStorage implements the Storage interface for testing.
type MockStorage struct {
	memories map[string]*Memory
}

func NewMockStorage() *MockStorage {
	return &MockStorage{
		memories: make(map[string]*Memory),
	}
}

func (m *MockStorage) Save(ctx context.Context, memory *Memory) error {
	m.memories[memory.ID] = memory
	return nil
}

func (m *MockStorage) Get(ctx context.Context, id string) (*Memory, error) {
	mem, ok := m.memories[id]
	if !ok {
		return nil, fmt.Errorf("memory not found")
	}
	return mem, nil
}

func (m *MockStorage) List(ctx context.Context, opts ListOptions) ([]*Memory, error) {
	var result []*Memory
	for _, mem := range m.memories {
		if !opts.IncludeObsolete && mem.Obsolete {
			continue
		}
		if len(opts.FilterLevels) > 0 && !containsLevel(opts.FilterLevels, mem.Level) {
			continue
		}
		result = append(result, mem)
	}
	return result, nil
}

func (m *MockStorage) Delete(ctx context.Context, id string) error {
	delete(m.memories, id)
	return nil
}

func (m *MockStorage) Update(ctx context.Context, memory *Memory) error {
	m.memories[memory.ID] = memory
	return nil
}

func (m *MockStorage) SearchAllLayers(ctx context.Context, vector []float64, opts SearchOptions) ([]*SearchResult, error) {
	var results []*SearchResult
	for _, mem := range m.memories {
		if !opts.IncludeObsolete && mem.Obsolete {
			continue
		}
		if len(opts.FilterLevels) > 0 && !containsLevel(opts.FilterLevels, mem.Level) {
			continue
		}
		if opts.SessionID != "" && mem.Level == MemoryLevelWorking && mem.Context.SessionID != opts.SessionID {
			continue
		}
		results = append(results, &SearchResult{Memory: mem, Score: 0.9})
	}
	return results, nil
}

func (m *MockStorage) TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error) {
	count := 0
	for _, mem := range m.memories {
		if mem.Level == MemoryLevelWorking && mem.Context.SessionID == sessionID {
			mem.Level = MemoryLevelEpisodic
			mem.UpdatedAt = time.Now()
			count++
		}
	}
	return count, nil
}

func (m *MockStorage) Close() error {
	return nil
}

// MockEmbedder implements the Embedder interface for testing.
type MockEmbedder struct {
	dimension int
}

func NewMockEmbedder() *MockEmbedder {
	return &MockEmbedder{
		dimension: 384,
	}
}

func (m *MockEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
	embedding := make([]float64, m.dimension)
	for i := 0; i < m.dimension; i++ {
		embedding[i] = 0.1
	}
	return embedding, nil
}

func (m *MockEmbedder) EmbedBatch(ctx context.Context, texts []string) ([][]float64, error) {
	var embeddings [][]float64
	for range texts {
		embedding := make([]float64, m.dimension)
		for i := 0; i < m.dimension; i++ {
			embedding[i] = 0.1
		}
		embeddings = append(embeddings, embedding)
	}
	return embeddings, nil
}

func (m *MockEmbedder) Dimension() int {
	return m.dimension
}

// Tests
func TestMemoryService_Create(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	input := CreateInput{
		Title:     "Test Memory",
		Content:   "Test content that is long enough",
		Level:     MemoryLevelEpisodic,
		Tags:      []string{"test", "golang"},
		SessionID: "session-1",
		Source:    "manual",
	}

	memory, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if memory.Title != input.Title {
		t.Errorf("Title = %v, want %v", memory.Title, input.Title)
	}

	if len(memory.ID) == 0 {
		t.Error("ID should be generated")
	}

	if len(memory.Embedding) != embedder.Dimension() {
		t.Errorf("Embedding length = %v, want %v", len(memory.Embedding), embedder.Dimension())
	}

	if memory.Obsolete {
		t.Error("New memory should not be obsolete")
	}

	retrieved, err := storage.Get(context.Background(), memory.ID)
	if err != nil {
		t.Errorf("Failed to retrieve stored memory: %v", err)
	}

	if retrieved.ID != memory.ID {
		t.Errorf("Retrieved memory ID = %v, want %v", retrieved.ID, memory.ID)
	}
}

func TestMemoryService_Create_InvalidInput(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	tests := []struct {
		name  string
		input CreateInput
	}{
		{
			name: "missing title",
			input: CreateInput{
				Title:   "",
				Content: "Test content sample",
				Level:   MemoryLevelEpisodic,
			},
		},
		{
			name: "missing level",
			input: CreateInput{
				Title:   "Test",
				Content: "Test content sample",
				Level:   MemoryLevel(""),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.Create(context.Background(), tt.input)
			if err == nil {
				t.Error("Create() should return error for invalid input")
			}
		})
	}
}

func TestMemoryService_List(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	for i := 0; i < 3; i++ {
		input := CreateInput{
			Title:   fmt.Sprintf("Memory %d", i),
			Content: fmt.Sprintf("Content number %d", i),
			Level:   MemoryLevelEpisodic,
		}
		_, _ = service.Create(context.Background(), input)
	}

	memories, err := service.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(memories) != 3 {
		t.Errorf("Expected 3 memories, got %d", len(memories))
	}
}

func TestMemoryService_Get(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	input := CreateInput{
		Title:   "Test Memory",
		Content: "Test content sample",
		Level:   MemoryLevelEpisodic,
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	retrieved, err := service.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if retrieved.ID != created.ID {
		t.Errorf("ID = %v, want %v", retrieved.ID, created.ID)
	}
}

func TestMemoryService_Delete(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	input := CreateInput{
		Title:   "Test Memory",
		Content: "Test content sample",
		Level:   MemoryLevelEpisodic,
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	err = service.Delete(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	_, err = service.Get(context.Background(), created.ID)
	if err == nil {
		t.Error("Get() should return error for deleted memory")
	}
}

func TestMemoryService_MarkObsolete(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	input := CreateInput{
		Title:   "Test Memory",
		Content: "Test content sample",
		Level:   MemoryLevelEpisodic,
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	err = service.MarkObsolete(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("MarkObsolete() error = %v", err)
	}

	memory, err := service.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if !memory.Obsolete {
		t.Error("Memory should be marked obsolete")
	}

	if memory.UpdatedAt.Equal(created.CreatedAt) {
		t.Error("UpdatedAt should be newer than CreatedAt")
	}
}

func TestMemoryService_Search(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	input := CreateInput{
		Title:   "Test Memory",
		Content: "Test content sample",
		Level:   MemoryLevelEpisodic,
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	results, err := service.Search(context.Background(), "test query", SearchOptions{
		TopK:     10,
		MinScore: 0.5,
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}

	if len(results) == 0 {
		t.Fatal("Search should return results")
	}

	found := false
	for _, result := range results {
		if result.Memory.ID == created.ID {
			found = true
			break
		}
	}

	if !found {
		t.Error("Created memory should be in search results")
	}
}

func TestMemoryService_Search_WithLevelFilter(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	inputs := []CreateInput{
		{
			Title:   "Episodic Memory",
			Content: "Test content sample",
			Level:   MemoryLevelEpisodic,
		},
		{
			Title:   "Semantic Memory",
			Content: "Test content sample",
			Level:   MemoryLevelSemantic,
		},
	}

	for _, input := range inputs {
		_, _ = service.Create(context.Background(), input)
	}

	results, err := service.Search(context.Background(), "test", SearchOptions{
		TopK:         10,
		MinScore:     0.5,
		FilterLevels: []MemoryLevel{MemoryLevelSemantic},
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}

	for _, result := range results {
		if result.Memory.Level != MemoryLevelSemantic {
			t.Error("Filtered search should only return semantic memories")
		}
	}
}

func containsLevel(levels []MemoryLevel, level MemoryLevel) bool {
	for _, l := range levels {
		if l == level {
			return true
		}
	}
	return false
}
