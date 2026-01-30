package memory

import (
	"context"
	"fmt"
	"testing"
)

// MockStorage implements the Storage interface for testing
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
		if len(opts.FilterTypes) > 0 && !containsType(mem.Types, opts.FilterTypes) {
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

func (m *MockStorage) SearchByVector(ctx context.Context, vector []float64, topK int) ([]*VectorMatch, error) {
	// Simple mock: return first topK memories
	var matches []*VectorMatch
	count := 0
	for id := range m.memories {
		if count >= topK {
			break
		}
		matches = append(matches, &VectorMatch{
			MemoryID: id,
			Score:    0.8 + float64(count)*0.05,
		})
		count++
	}
	return matches, nil
}

func (m *MockStorage) Close() error {
	return nil
}

// MockEmbedder implements the Embedder interface for testing
type MockEmbedder struct {
	dimension int
}

func NewMockEmbedder() *MockEmbedder {
	return &MockEmbedder{
		dimension: 384, // nomic-embed-text dimension
	}
}

func (m *MockEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
	// Return a mock embedding
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
		Title:   "Test Memory",
		Content: "Test content",
		Types:   []MemoryType{MemoryTypeSolution},
		Tags:    []string{"test", "golang"},
		Metadata: map[string]string{"key": "value"},
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

	// Verify memory is stored
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
				Content: "Test content",
				Types:   []MemoryType{MemoryTypeSolution},
			},
		},
		{
			name: "missing types",
			input: CreateInput{
				Title:   "Test",
				Content: "Test content",
				Types:   []MemoryType{},
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

	// Create some memories
	for i := 0; i < 3; i++ {
		input := CreateInput{
			Title:   fmt.Sprintf("Memory %d", i),
			Content: fmt.Sprintf("Content %d", i),
			Types:   []MemoryType{MemoryTypeSolution},
		}
		service.Create(context.Background(), input)
	}

	// List all memories
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
		Content: "Test content",
		Types:   []MemoryType{MemoryTypeSolution},
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Get the memory
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
		Content: "Test content",
		Types:   []MemoryType{MemoryTypeSolution},
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Delete the memory
	err = service.Delete(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify it's deleted
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
		Content: "Test content",
		Types:   []MemoryType{MemoryTypeSolution},
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Mark as obsolete
	err = service.MarkObsolete(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("MarkObsolete() error = %v", err)
	}

	// Verify it's marked obsolete
	memory, err := service.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if !memory.Obsolete {
		t.Error("Memory should be marked obsolete")
	}

	// Check that UpdatedAt is newer
	if memory.UpdatedAt.Equal(created.CreatedAt) {
		t.Error("UpdatedAt should be newer than CreatedAt")
	}
}

func TestMemoryService_Search(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	// Create a memory
	input := CreateInput{
		Title:   "Test Memory",
		Content: "Test content",
		Types:   []MemoryType{MemoryTypeSolution},
	}

	created, err := service.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Search for it
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

	// Verify result
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

func TestMemoryService_Search_WithTypeFilter(t *testing.T) {
	storage := NewMockStorage()
	embedder := NewMockEmbedder()
	service := NewMemoryService(storage, embedder)

	// Create memories with different types
	inputs := []CreateInput{
		{
			Title:   "Solution Memory",
			Content: "Test content",
			Types:   []MemoryType{MemoryTypeSolution},
		},
		{
			Title:   "Issue Memory",
			Content: "Test content",
			Types:   []MemoryType{MemoryTypeIssue},
		},
	}

	for _, input := range inputs {
		service.Create(context.Background(), input)
	}

	// Search for issues only
	results, err := service.Search(context.Background(), "test", SearchOptions{
		TopK:        10,
		MinScore:    0.5,
		FilterTypes: []MemoryType{MemoryTypeIssue},
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}

	for _, result := range results {
		if !containsType(result.Memory.Types, []MemoryType{MemoryTypeIssue}) {
			t.Error("Filtered search should only return memories with specified types")
		}
	}
}
