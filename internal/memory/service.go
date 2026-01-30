package memory

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Embedder interface for generating embeddings
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float64, error)
	EmbedBatch(ctx context.Context, texts []string) ([][]float64, error)
	Dimension() int
}

// Storage interface for persisting memories
type Storage interface {
	Save(ctx context.Context, memory *Memory) error
	Get(ctx context.Context, id string) (*Memory, error)
	List(ctx context.Context, opts ListOptions) ([]*Memory, error)
	Delete(ctx context.Context, id string) error
	Update(ctx context.Context, memory *Memory) error
	SearchByVector(ctx context.Context, vector []float64, topK int) ([]*VectorMatch, error)
	Close() error
}

// VectorMatch represents a memory matched by vector search
type VectorMatch struct {
	MemoryID string
	Score    float64
}

// Service interface defines all memory operations
type Service interface {
	Create(ctx context.Context, input CreateInput) (*Memory, error)
	Search(ctx context.Context, query string, opts SearchOptions) ([]*SearchResult, error)
	List(ctx context.Context, opts ListOptions) ([]*Memory, error)
	Get(ctx context.Context, id string) (*Memory, error)
	Delete(ctx context.Context, id string) error
	MarkObsolete(ctx context.Context, id string) error
}

// MemoryService implements the Service interface
type MemoryService struct {
	storage  Storage
	embedder Embedder
}

// NewMemoryService creates a new memory service
func NewMemoryService(storage Storage, embedder Embedder) *MemoryService {
	return &MemoryService{
		storage:  storage,
		embedder: embedder,
	}
}

// Create creates a new memory
func (s *MemoryService) Create(ctx context.Context, input CreateInput) (*Memory, error) {
	if err := input.Validate(); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	// Generate embedding
	text := prepareForEmbedding(&Memory{
		Title:   input.Title,
		Content: input.Content,
		Tags:    input.Tags,
	})

	embedding, err := s.embedder.Embed(ctx, text)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	now := time.Now()
	memory := &Memory{
		ID:        uuid.New().String(),
		Title:     input.Title,
		Content:   input.Content,
		Types:     input.Types,
		Tags:      input.Tags,
		Embedding: embedding,
		Metadata:  input.Metadata,
		CreatedAt: now,
		UpdatedAt: now,
		Obsolete:  false,
	}

	if err := s.storage.Save(ctx, memory); err != nil {
		return nil, fmt.Errorf("failed to save memory: %w", err)
	}

	return memory, nil
}

// Search searches for memories by semantic similarity
func (s *MemoryService) Search(ctx context.Context, query string, opts SearchOptions) ([]*SearchResult, error) {
	// Generate embedding for query
	embedding, err := s.embedder.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to generate query embedding: %w", err)
	}

	// Search for similar vectors
	matches, err := s.storage.SearchByVector(ctx, embedding, opts.TopK)
	if err != nil {
		return nil, fmt.Errorf("failed to search vectors: %w", err)
	}

	// Convert matches to search results
	var results []*SearchResult
	for _, match := range matches {
		if match.Score < opts.MinScore {
			continue
		}

		memory, err := s.storage.Get(ctx, match.MemoryID)
		if err != nil {
			continue
		}

		if !opts.IncludeObsolete && memory.Obsolete {
			continue
		}

		if len(opts.FilterTypes) > 0 {
			if !containsType(memory.Types, opts.FilterTypes) {
				continue
			}
		}

		results = append(results, &SearchResult{
			Memory: memory,
			Score:  match.Score,
		})
	}

	return results, nil
}

// List lists all memories
func (s *MemoryService) List(ctx context.Context, opts ListOptions) ([]*Memory, error) {
	memories, err := s.storage.List(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list memories: %w", err)
	}

	return memories, nil
}

// Get retrieves a specific memory
func (s *MemoryService) Get(ctx context.Context, id string) (*Memory, error) {
	memory, err := s.storage.Get(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get memory: %w", err)
	}

	return memory, nil
}

// Delete deletes a memory
func (s *MemoryService) Delete(ctx context.Context, id string) error {
	if err := s.storage.Delete(ctx, id); err != nil {
		return fmt.Errorf("failed to delete memory: %w", err)
	}

	return nil
}

// MarkObsolete marks a memory as obsolete
func (s *MemoryService) MarkObsolete(ctx context.Context, id string) error {
	memory, err := s.storage.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get memory: %w", err)
	}

	memory.Obsolete = true
	memory.UpdatedAt = time.Now()

	if err := s.storage.Update(ctx, memory); err != nil {
		return fmt.Errorf("failed to update memory: %w", err)
	}

	return nil
}

// Helper functions

// prepareForEmbedding prepares memory content for embedding
func prepareForEmbedding(m *Memory) string {
	text := fmt.Sprintf("Title: %s\n\nContent: %s", m.Title, m.Content)
	if len(m.Tags) > 0 {
		text += fmt.Sprintf("\n\nTags: %s", join(m.Tags, ", "))
	}
	return text
}

// containsType checks if memory types contain any of the filter types
func containsType(memoryTypes []MemoryType, filterTypes []MemoryType) bool {
	for _, mt := range memoryTypes {
		for _, ft := range filterTypes {
			if mt == ft {
				return true
			}
		}
	}
	return false
}

// join joins strings with separator
func join(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
