package storage

import (
	"path/filepath"
	"testing"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

func TestNewStorage_Gob(t *testing.T) {
	cfg := &config.StorageConfig{
		Backend: "gob",
		Path:    t.TempDir(),
	}
	store, err := NewStorage(cfg)
	if err != nil {
		t.Fatalf("NewStorage(gob) error = %v", err)
	}
	defer func() { _ = store.Close() }()
	if store == nil {
		t.Fatal("NewStorage returned nil")
	}
}

func TestNewStorage_GobDefault(t *testing.T) {
	// Empty backend should default to gob
	dir := t.TempDir()
	cfg := &config.StorageConfig{
		Backend: "",
		Path:    filepath.Join(dir, "data"),
	}
	store, err := NewStorage(cfg)
	if err != nil {
		t.Fatalf("NewStorage(empty backend) error = %v", err)
	}
	defer func() { _ = store.Close() }()
	if store == nil {
		t.Fatal("NewStorage returned nil")
	}
}

func TestNewStorage_UnknownBackend(t *testing.T) {
	cfg := &config.StorageConfig{
		Backend: "unknown",
		Path:    t.TempDir(),
	}
	_, err := NewStorage(cfg)
	if err == nil {
		t.Fatal("NewStorage with unknown backend should return error")
	}
}
