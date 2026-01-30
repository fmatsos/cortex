package storage

import (
	"context"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// VectorMatch represents a memory matched by vector search
type VectorMatch struct {
	MemoryID string
	Score    float64
}

// Storage interface defines all storage operations
type Storage interface {
	Save(ctx context.Context, m *memory.Memory) error
	Get(ctx context.Context, id string) (*memory.Memory, error)
	List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error)
	Delete(ctx context.Context, id string) error
	Update(ctx context.Context, m *memory.Memory) error
	SearchByVector(ctx context.Context, vector []float64, topK int) ([]*VectorMatch, error)
	Close() error
}
