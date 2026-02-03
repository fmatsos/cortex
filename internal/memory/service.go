package memory

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Embedder generates vector embeddings for text.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float64, error)
	EmbedBatch(ctx context.Context, texts []string) ([][]float64, error)
	Dimension() int
}

// Storage interface for memory persistence.
type Storage interface {
	Save(ctx context.Context, m *Memory) error
	Get(ctx context.Context, id string) (*Memory, error)
	List(ctx context.Context, opts ListOptions) ([]*Memory, error)
	Delete(ctx context.Context, id string) error
	Update(ctx context.Context, m *Memory) error
	SearchAllLayers(ctx context.Context, vector []float64, opts SearchOptions) ([]*SearchResult, error)
	TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error)
	Close() error
}

// SearchOptions configures search behavior.
type SearchOptions struct {
	TopK            int
	MinScore        float64
	FilterLevels    []MemoryLevel
	IncludeObsolete bool
	SessionID       string
}

// SearchResult contains a memory and its similarity score.
type SearchResult struct {
	Memory *Memory
	Score  float64
}

// ListOptions configures list behavior.
type ListOptions struct {
	FilterLevels    []MemoryLevel
	IncludeObsolete bool
	Limit           int
	SortBy          string
	Reverse         bool
}

// CreateInput for creating new memories.
type CreateInput struct {
	Title     string
	Content   string
	Level     MemoryLevel
	Tags      []string
	SessionID string
	Source    string
	TaskID    string
	Author    string
}

// MemoryService provides memory operations.
type MemoryService struct {
	storage  Storage
	embedder Embedder
}

// NewMemoryService creates a new memory service.
func NewMemoryService(storage Storage, embedder Embedder) *MemoryService {
	return &MemoryService{storage: storage, embedder: embedder}
}

// Create creates a new memory.
func (s *MemoryService) Create(ctx context.Context, input CreateInput) (*Memory, error) {
	now := time.Now()
	m := &Memory{
		ID:      uuid.New().String(),
		Level:   input.Level,
		Title:   input.Title,
		Content: input.Content,
		Tags:    input.Tags,
		Context: MemoryContext{
			TaskID:    input.TaskID,
			SessionID: input.SessionID,
			Timestamp: now,
			Author:    input.Author,
			Tags:      input.Tags,
			Source:    input.Source,
		},
		CreatedAt: now,
		UpdatedAt: now,
		Obsolete:  false,
	}

	if err := m.Validate(); err != nil {
		return nil, err
	}

	text := fmt.Sprintf("Title: %s\n\nContent: %s", m.Title, m.Content)
	if len(m.Tags) > 0 {
		text += fmt.Sprintf("\n\nTags: %v", m.Tags)
	}
	embedding, err := s.embedder.Embed(ctx, text)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}
	m.Embedding = embedding

	if err := s.storage.Save(ctx, m); err != nil {
		return nil, fmt.Errorf("failed to save: %w", err)
	}
	return m, nil
}

// Search searches memories across all layers.
func (s *MemoryService) Search(ctx context.Context, query string, opts SearchOptions) ([]*SearchResult, error) {
	embedding, err := s.embedder.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to embed query: %w", err)
	}
	return s.storage.SearchAllLayers(ctx, embedding, opts)
}

// List lists memories with filtering.
func (s *MemoryService) List(ctx context.Context, opts ListOptions) ([]*Memory, error) {
	return s.storage.List(ctx, opts)
}

// Get retrieves a memory by ID.
func (s *MemoryService) Get(ctx context.Context, id string) (*Memory, error) {
	return s.storage.Get(ctx, id)
}

// Delete permanently deletes a memory.
func (s *MemoryService) Delete(ctx context.Context, id string) error {
	return s.storage.Delete(ctx, id)
}

// MarkObsolete soft-deletes a memory.
func (s *MemoryService) MarkObsolete(ctx context.Context, id string) error {
	m, err := s.storage.Get(ctx, id)
	if err != nil {
		return err
	}
	m.Obsolete = true
	m.UpdatedAt = time.Now()
	return s.storage.Update(ctx, m)
}

// TransferWorking transfers working memories to episodic.
func (s *MemoryService) TransferWorking(ctx context.Context, sessionID string) (int, error) {
	return s.storage.TransferWorkingToEpisodic(ctx, sessionID)
}
