package storage

import (
	"context"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// Storage defines the interface for memory persistence.
type Storage interface {
	Save(ctx context.Context, m *memory.Memory) error
	Get(ctx context.Context, id string) (*memory.Memory, error)
	List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error)
	Delete(ctx context.Context, id string) error
	Update(ctx context.Context, m *memory.Memory) error
	SearchAllLayers(ctx context.Context, vector []float64, opts memory.SearchOptions) ([]*memory.SearchResult, error)
	TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error)
	Close() error
}
