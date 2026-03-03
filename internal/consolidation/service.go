// Package consolidation provides memory consolidation services
package consolidation

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/google/uuid"
)

// Service handles memory consolidation operations
type Service struct {
	storage  storage.Storage
	embedder memory.Embedder
	config   *config.ConsolidationConfig
}

// NewService creates a new consolidation service
func NewService(store storage.Storage, embedder memory.Embedder, cfg *config.ConsolidationConfig) *Service {
	return &Service{
		storage:  store,
		embedder: embedder,
		config:   cfg,
	}
}

// Consolidate processes input and creates or merges a memory
func (s *Service) Consolidate(ctx context.Context, input memory.ConsolidateInput) (*memory.ConsolidateResult, error) {
	// Validate input
	if err := input.Validate(); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	// Set default source if not provided
	if input.Context.Source == "" {
		input.Context.Source = "manual"
	}

	// Set timestamp if not provided
	if input.Context.Timestamp.IsZero() {
		input.Context.Timestamp = time.Now()
	}

	// Generate embedding for the synthesis
	embedding, err := s.embedder.Embed(ctx, input.Synthesis)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	// If force is set, skip duplicate check
	if !input.Force {
		searchOpts := memory.SearchOptions{
			TopK:         1,
			MinScore:     s.config.SimilarityThreshold,
			FilterLevels: []memory.MemoryLevel{input.Level},
		}
		if input.Level == memory.MemoryLevelWorking {
			searchOpts.SessionID = input.Context.SessionID
		}
		results, err := s.storage.SearchAllLayers(ctx, embedding, searchOpts)
		if err != nil {
			return nil, fmt.Errorf("failed to find similar memories: %w", err)
		}
		if len(results) > 0 {
			return s.mergeWithExisting(ctx, results[0].Memory, input, embedding)
		}
	}

	// Create new memory
	return s.createNew(ctx, input, embedding)
}

func (s *Service) createNew(ctx context.Context, input memory.ConsolidateInput, embedding []float64) (*memory.ConsolidateResult, error) {
	now := time.Now()
	mem := &memory.Memory{
		ID:        uuid.New().String(),
		Level:     input.Level,
		Title:     deriveTitle(input.Synthesis),
		Content:   input.Synthesis,
		Tags:      input.Context.Tags,
		Embedding: embedding,
		Context:   input.Context,
		CreatedAt: now,
		UpdatedAt: now,
		Obsolete:  false,
	}

	if err := mem.Validate(); err != nil {
		return nil, fmt.Errorf("invalid memory: %w", err)
	}

	if err := s.storage.Save(ctx, mem); err != nil {
		return nil, fmt.Errorf("failed to save memory: %w", err)
	}

	return &memory.ConsolidateResult{
		Action:   "created",
		MemoryID: mem.ID,
		Reason:   "new memory created",
	}, nil
}

func (s *Service) mergeWithExisting(ctx context.Context, existing *memory.Memory, input memory.ConsolidateInput, newEmbedding []float64) (*memory.ConsolidateResult, error) {
	// Merge content - append new synthesis to existing
	mergedContent := existing.Content + "\n\n---\n\n" + input.Synthesis

	// Generate new embedding for merged content
	mergedEmbedding, err := s.embedder.Embed(ctx, mergedContent)
	if err != nil {
		// Fall back to using the new embedding
		mergedEmbedding = newEmbedding
	}

	// Update existing memory
	existing.Content = mergedContent
	existing.Embedding = mergedEmbedding
	existing.UpdatedAt = time.Now()

	if len(input.Context.Tags) > 0 {
		existing.Tags = mergeTags(existing.Tags, input.Context.Tags)
		existing.Context.Tags = mergeTags(existing.Context.Tags, input.Context.Tags)
	}

	if len(input.Context.RelatedMemories) > 0 {
		existing.Context.RelatedMemories = mergeTags(existing.Context.RelatedMemories, input.Context.RelatedMemories)
	}

	if err := s.storage.Update(ctx, existing); err != nil {
		return nil, fmt.Errorf("failed to update memory: %w", err)
	}

	return &memory.ConsolidateResult{
		Action:     "merged",
		MemoryID:   existing.ID,
		MergedWith: existing.ID,
		Reason:     fmt.Sprintf("merged with existing memory (similarity >= %.2f)", s.config.SimilarityThreshold),
	}, nil
}

// TransferWorkingToEpisodic transfers working memories to episodic level
func (s *Service) TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error) {
	return s.storage.TransferWorkingToEpisodic(ctx, sessionID)
}

// PromoteToSemantic promotes an episodic memory to semantic level
func (s *Service) PromoteToSemantic(ctx context.Context, memoryID string, newContent string) (*memory.ConsolidateResult, error) {
	existing, err := s.storage.Get(ctx, memoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to get memory: %w", err)
	}

	if existing.Level != memory.MemoryLevelEpisodic {
		return nil, fmt.Errorf("can only promote episodic memories to semantic")
	}

	content := newContent
	if content == "" {
		content = existing.Content
	}

	embedding, err := s.embedder.Embed(ctx, content)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	semantic := &memory.Memory{
		ID:         uuid.New().String(),
		Level:      memory.MemoryLevelSemantic,
		Title:      existing.Title,
		Content:    content,
		Tags:       existing.Tags,
		Embedding:  embedding,
		Context:    existing.Context,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		MergedFrom: []string{memoryID},
		Obsolete:   false,
	}
	semantic.Context.Source = "manual"

	if err := s.storage.Save(ctx, semantic); err != nil {
		return nil, fmt.Errorf("failed to save semantic memory: %w", err)
	}

	return &memory.ConsolidateResult{
		Action:     "created",
		MemoryID:   semantic.ID,
		MergedWith: memoryID,
		Reason:     "promoted from episodic to semantic",
	}, nil
}

// Get retrieves a memory by ID
func (s *Service) Get(ctx context.Context, id string) (*memory.Memory, error) {
	return s.storage.Get(ctx, id)
}

// List lists memories by level
func (s *Service) List(ctx context.Context, level memory.MemoryLevel) ([]*memory.Memory, error) {
	opts := memory.ListOptions{FilterLevels: []memory.MemoryLevel{level}}
	return s.storage.List(ctx, opts)
}

// Delete deletes a memory
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.storage.Delete(ctx, id)
}

// Search searches for similar memories
func (s *Service) Search(ctx context.Context, query string, level memory.MemoryLevel, topK int, minScore float64) ([]*memory.Memory, []float64, error) {
	embedding, err := s.embedder.Embed(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to embed query: %w", err)
	}

	results, err := s.storage.SearchAllLayers(ctx, embedding, memory.SearchOptions{
		TopK:         topK,
		MinScore:     minScore,
		FilterLevels: []memory.MemoryLevel{level},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to search: %w", err)
	}

	memories := make([]*memory.Memory, 0, len(results))
	scores := make([]float64, 0, len(results))
	for _, result := range results {
		memories = append(memories, result.Memory)
		scores = append(scores, result.Score)
	}

	return memories, scores, nil
}

func deriveTitle(content string) string {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return "Memory"
	}
	line := strings.SplitN(trimmed, "\n", 2)[0]
	line = strings.TrimSpace(line)
	if len(line) < 3 {
		return "Memory"
	}
	const max = 60
	if len(line) > max {
		return strings.TrimSpace(line[:max]) + "..."
	}
	return line
}

// Helper functions

func mergeTags(existing, new []string) []string {
	tagSet := make(map[string]bool)
	for _, t := range existing {
		tagSet[t] = true
	}
	for _, t := range new {
		tagSet[t] = true
	}

	result := make([]string, 0, len(tagSet))
	for t := range tagSet {
		result = append(result, t)
	}
	return result
}
