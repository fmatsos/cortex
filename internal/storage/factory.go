package storage

import (
	"fmt"
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

// New creates a Storage backend based on the provided configuration.
// Supported backends: "gob" (default, no CGO), "lancedb" (requires -tags lancedb and native libs).
func New(cfg config.StorageConfig) (Storage, error) {
	switch cfg.Backend {
	case "gob", "":
		return NewGobStorage(filepath.Join(cfg.Path, "memories.gob"))
	case "lancedb":
		return newLanceDBStorageOrError(filepath.Join(cfg.Path, "lancedb"))
	default:
		return nil, fmt.Errorf("unknown storage backend %q (supported: gob, lancedb)", cfg.Backend)
	}
}
