package storage

import (
	"context"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// Storage interface defines all storage operations
type Storage interface {
	Save(ctx context.Context, m *memory.Memory) error
	Get(ctx context.Context, id string) (*memory.Memory, error)
	List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error)
	Delete(ctx context.Context, id string) error
	Update(ctx context.Context, m *memory.Memory) error
	SearchByVector(ctx context.Context, vector []float64, topK int) ([]*memory.VectorMatch, error)
	Close() error
}
