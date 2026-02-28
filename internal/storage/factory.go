package storage

import (
	"fmt"
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

// defaultZvecDimension is the fallback embedding dimension for zvec when none is configured.
// nomic-embed-text (the default Cortex embedder) produces 768-dimensional vectors.
const defaultZvecDimension = 768

// NewStorage creates a Storage backend based on the provided configuration.
// Supported backends: "gob" (default), "zvec".
func NewStorage(cfg *config.StorageConfig) (Storage, error) {
	switch cfg.Backend {
	case "gob", "":
		path := filepath.Join(cfg.Path, "memories.gob")
		return NewGobStorage(path)
	case "zvec":
		dim := cfg.ZvecDimension
		if dim <= 0 {
			dim = defaultZvecDimension
		}
		return NewZvecStorage(cfg.Path, cfg.ZvecPort, dim)
	default:
		return nil, fmt.Errorf("unknown storage backend %q (valid: gob, zvec)", cfg.Backend)
	}
}
