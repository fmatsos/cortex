package storage

import (
	"context"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// ConsolidatedStorage interface defines operations for multi-level memory storage
type ConsolidatedStorage interface {
	// SaveConsolidated saves a consolidated memory
	SaveConsolidated(ctx context.Context, m *memory.ConsolidatedMemory) error

	// GetConsolidated retrieves a consolidated memory by ID
	GetConsolidated(ctx context.Context, id string) (*memory.ConsolidatedMemory, error)

	// ListByLevel lists memories by their level
	ListByLevel(ctx context.Context, level memory.MemoryLevel) ([]*memory.ConsolidatedMemory, error)

	// ListWorkingBySession lists working memories for a specific session
	ListWorkingBySession(ctx context.Context, sessionID string) ([]*memory.ConsolidatedMemory, error)

	// DeleteWorkingBySession deletes all working memories for a session
	DeleteWorkingBySession(ctx context.Context, sessionID string) error

	// DeleteConsolidated deletes a consolidated memory by ID
	DeleteConsolidated(ctx context.Context, id string) error

	// FindSimilar finds memories similar to the given embedding
	FindSimilar(ctx context.Context, embedding []float64, level memory.MemoryLevel, threshold float64) ([]*memory.ConsolidatedMemory, error)

	// Merge merges source memories into a target memory
	Merge(ctx context.Context, targetID string, sourceIDs []string, newContent string, newEmbedding []float64) error

	// ArchiveOlderThan archives memories older than the given time
	ArchiveOlderThan(ctx context.Context, level memory.MemoryLevel, before time.Time) (int, error)

	// SearchConsolidatedByVector searches consolidated memories by vector similarity
	SearchConsolidatedByVector(ctx context.Context, vector []float64, level memory.MemoryLevel, topK int) ([]*ConsolidatedVectorMatch, error)
}

// ConsolidatedVectorMatch represents a consolidated memory matched by vector search
type ConsolidatedVectorMatch struct {
	MemoryID string
	Score    float64
}

// ListConsolidatedOptions contains options for listing consolidated memories
type ListConsolidatedOptions struct {
	Level     memory.MemoryLevel
	SessionID string // only for working level
	Before    time.Time
	After     time.Time
}
