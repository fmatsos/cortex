package embeddings

import (
	"context"
)

// Embedder interface for generating embeddings
type Embedder interface {
	// Embed generates an embedding for a single text
	Embed(ctx context.Context, text string) ([]float64, error)

	// EmbedBatch generates embeddings for multiple texts
	EmbedBatch(ctx context.Context, texts []string) ([][]float64, error)

	// Dimension returns the embedding dimension
	Dimension() int
}
