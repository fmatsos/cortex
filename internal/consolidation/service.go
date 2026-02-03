// Package consolidation provides memory consolidation services
package consolidation

import (
	"context"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/google/uuid"
)

// Embedder interface for generating embeddings
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float64, error)
}

// Service handles memory consolidation operations
type Service struct {
	storage  storage.ConsolidatedStorage
	embedder Embedder
	config   *config.ConsolidationConfig
}

// NewService creates a new consolidation service
func NewService(store storage.ConsolidatedStorage, embedder Embedder, cfg *config.ConsolidationConfig) *Service {
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
		// Search for similar memories
		similar, err := s.storage.FindSimilar(ctx, embedding, input.Level, s.config.SimilarityThreshold)
		if err != nil {
			return nil, fmt.Errorf("failed to find similar memories: %w", err)
		}

		// If similar memory found, merge
		if len(similar) > 0 {
			mostSimilar := similar[0]
			return s.mergeWithExisting(ctx, mostSimilar, input, embedding)
		}
	}

	// Create new memory
	return s.createNew(ctx, input, embedding)
}

func (s *Service) createNew(ctx context.Context, input memory.ConsolidateInput, embedding []float64) (*memory.ConsolidateResult, error) {
	now := time.Now()
	mem := &memory.ConsolidatedMemory{
		ID:        uuid.New().String(),
		Level:     input.Level,
		Content:   input.Synthesis,
		Embedding: embedding,
		Context:   input.Context,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := s.storage.SaveConsolidated(ctx, mem); err != nil {
		return nil, fmt.Errorf("failed to save memory: %w", err)
	}

	return &memory.ConsolidateResult{
		Action:   "created",
		MemoryID: mem.ID,
		Reason:   "new memory created",
	}, nil
}

func (s *Service) mergeWithExisting(ctx context.Context, existing *memory.ConsolidatedMemory, input memory.ConsolidateInput, newEmbedding []float64) (*memory.ConsolidateResult, error) {
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

	// Add context tags
	if len(input.Context.Tags) > 0 {
		existing.Context.Tags = mergeTags(existing.Context.Tags, input.Context.Tags)
	}

	// Add related memories
	if len(input.Context.RelatedMemories) > 0 {
		existing.Context.RelatedMemories = mergeSlices(existing.Context.RelatedMemories, input.Context.RelatedMemories)
	}

	if err := s.storage.SaveConsolidated(ctx, existing); err != nil {
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
	// Get all working memories for the session
	workingMemories, err := s.storage.ListWorkingBySession(ctx, sessionID)
	if err != nil {
		return 0, fmt.Errorf("failed to list working memories: %w", err)
	}

	if len(workingMemories) == 0 {
		return 0, nil
	}

	transferred := 0
	for _, wm := range workingMemories {
		// Create episodic memory from working
		episodic := &memory.ConsolidatedMemory{
			ID:        uuid.New().String(),
			Level:     memory.MemoryLevelEpisodic,
			Content:   wm.Content,
			Embedding: wm.Embedding,
			Context:   wm.Context,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		episodic.Context.Source = "auto"

		if err := s.storage.SaveConsolidated(ctx, episodic); err != nil {
			continue // Skip failed transfers
		}
		transferred++
	}

	// Delete working memories for this session
	if err := s.storage.DeleteWorkingBySession(ctx, sessionID); err != nil {
		return transferred, fmt.Errorf("transferred %d memories but failed to clean working: %w", transferred, err)
	}

	return transferred, nil
}

// PromoteToSemantic promotes an episodic memory to semantic level
func (s *Service) PromoteToSemantic(ctx context.Context, memoryID string, newContent string) (*memory.ConsolidateResult, error) {
	// Get the episodic memory
	existing, err := s.storage.GetConsolidated(ctx, memoryID)
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

	// Generate new embedding
	embedding, err := s.embedder.Embed(ctx, content)
	if err != nil {
		return nil, fmt.Errorf("failed to generate embedding: %w", err)
	}

	// Create semantic memory
	semantic := &memory.ConsolidatedMemory{
		ID:         uuid.New().String(),
		Level:      memory.MemoryLevelSemantic,
		Content:    content,
		Embedding:  embedding,
		Context:    existing.Context,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		MergedFrom: []string{memoryID},
	}
	semantic.Context.Source = "manual"

	if err := s.storage.SaveConsolidated(ctx, semantic); err != nil {
		return nil, fmt.Errorf("failed to save semantic memory: %w", err)
	}

	return &memory.ConsolidateResult{
		Action:     "created",
		MemoryID:   semantic.ID,
		MergedWith: memoryID,
		Reason:     "promoted from episodic to semantic",
	}, nil
}

// Get retrieves a consolidated memory by ID
func (s *Service) Get(ctx context.Context, id string) (*memory.ConsolidatedMemory, error) {
	return s.storage.GetConsolidated(ctx, id)
}

// List lists consolidated memories by level
func (s *Service) List(ctx context.Context, level memory.MemoryLevel) ([]*memory.ConsolidatedMemory, error) {
	return s.storage.ListByLevel(ctx, level)
}

// Delete deletes a consolidated memory
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.storage.DeleteConsolidated(ctx, id)
}

// Search searches for similar memories
func (s *Service) Search(ctx context.Context, query string, level memory.MemoryLevel, topK int, minScore float64) ([]*memory.ConsolidatedMemory, []float64, error) {
	embedding, err := s.embedder.Embed(ctx, query)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to embed query: %w", err)
	}

	matches, err := s.storage.SearchConsolidatedByVector(ctx, embedding, level, topK)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to search: %w", err)
	}

	var memories []*memory.ConsolidatedMemory
	var scores []float64
	for _, match := range matches {
		if match.Score < minScore {
			continue
		}
		mem, err := s.storage.GetConsolidated(ctx, match.MemoryID)
		if err != nil {
			continue
		}
		memories = append(memories, mem)
		scores = append(scores, match.Score)
	}

	return memories, scores, nil
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

func mergeSlices(existing, new []string) []string {
	set := make(map[string]bool)
	for _, s := range existing {
		set[s] = true
	}
	for _, s := range new {
		set[s] = true
	}

	result := make([]string, 0, len(set))
	for s := range set {
		result = append(result, s)
	}
	return result
}
