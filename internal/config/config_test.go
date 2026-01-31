package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	// Storage defaults
	if cfg.Storage.Backend != "gob" {
		t.Errorf("Storage.Backend = %q, want %q", cfg.Storage.Backend, "gob")
	}

	// Embeddings defaults
	if cfg.Embeddings.Provider != "ollama" {
		t.Errorf("Embeddings.Provider = %q, want %q", cfg.Embeddings.Provider, "ollama")
	}
	if cfg.Embeddings.Model != "nomic-embed-text" {
		t.Errorf("Embeddings.Model = %q, want %q", cfg.Embeddings.Model, "nomic-embed-text")
	}
	if cfg.Embeddings.Endpoint != "http://localhost:11434" {
		t.Errorf("Embeddings.Endpoint = %q, want %q", cfg.Embeddings.Endpoint, "http://localhost:11434")
	}
	if cfg.Embeddings.Timeout != 30*time.Second {
		t.Errorf("Embeddings.Timeout = %v, want %v", cfg.Embeddings.Timeout, 30*time.Second)
	}

	// Search defaults
	if cfg.Search.TopK != 5 {
		t.Errorf("Search.TopK = %d, want %d", cfg.Search.TopK, 5)
	}
	if cfg.Search.MinScore != 0.5 {
		t.Errorf("Search.MinScore = %f, want %f", cfg.Search.MinScore, 0.5)
	}
	if cfg.Search.IncludeObsolete != false {
		t.Errorf("Search.IncludeObsolete = %v, want %v", cfg.Search.IncludeObsolete, false)
	}

	// Output defaults
	if cfg.Output.Format != "text" {
		t.Errorf("Output.Format = %q, want %q", cfg.Output.Format, "text")
	}
	if cfg.Output.Colors != true {
		t.Errorf("Output.Colors = %v, want %v", cfg.Output.Colors, true)
	}
}

func TestManagerLoadDefaults(t *testing.T) {
	manager := NewManager()

	cfg, err := manager.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Storage.Backend != "gob" {
		t.Errorf("Storage.Backend = %q, want %q", cfg.Storage.Backend, "gob")
	}
	if cfg.Embeddings.Model != "nomic-embed-text" {
		t.Errorf("Embeddings.Model = %q, want %q", cfg.Embeddings.Model, "nomic-embed-text")
	}
}

func TestManagerLoadFromFile(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-config-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test config file
	configContent := `
storage:
  backend: sqlite
  path: /custom/path

embeddings:
  provider: ollama
  model: custom-model
  endpoint: http://custom:8080
  timeout: 60s

search:
  top_k: 10
  min_score: 0.7
  include_obsolete: true

output:
  format: json
  colors: false
`
	configFile := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(configFile, []byte(configContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	// Load config
	manager := NewManager()
	manager.SetConfigFile(configFile)

	cfg, err := manager.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Verify loaded values
	if cfg.Storage.Backend != "sqlite" {
		t.Errorf("Storage.Backend = %q, want %q", cfg.Storage.Backend, "sqlite")
	}
	if cfg.Storage.Path != "/custom/path" {
		t.Errorf("Storage.Path = %q, want %q", cfg.Storage.Path, "/custom/path")
	}
	if cfg.Embeddings.Model != "custom-model" {
		t.Errorf("Embeddings.Model = %q, want %q", cfg.Embeddings.Model, "custom-model")
	}
	if cfg.Embeddings.Endpoint != "http://custom:8080" {
		t.Errorf("Embeddings.Endpoint = %q, want %q", cfg.Embeddings.Endpoint, "http://custom:8080")
	}
	if cfg.Embeddings.Timeout != 60*time.Second {
		t.Errorf("Embeddings.Timeout = %v, want %v", cfg.Embeddings.Timeout, 60*time.Second)
	}
	if cfg.Search.TopK != 10 {
		t.Errorf("Search.TopK = %d, want %d", cfg.Search.TopK, 10)
	}
	if cfg.Search.MinScore != 0.7 {
		t.Errorf("Search.MinScore = %f, want %f", cfg.Search.MinScore, 0.7)
	}
	if cfg.Search.IncludeObsolete != true {
		t.Errorf("Search.IncludeObsolete = %v, want %v", cfg.Search.IncludeObsolete, true)
	}
	if cfg.Output.Format != "json" {
		t.Errorf("Output.Format = %q, want %q", cfg.Output.Format, "json")
	}
	if cfg.Output.Colors != false {
		t.Errorf("Output.Colors = %v, want %v", cfg.Output.Colors, false)
	}
}

func TestManagerEnvironmentOverrides(t *testing.T) {
	// Set environment variables
	os.Setenv("CORTEX_STORAGE_BACKEND", "sqlite")
	os.Setenv("CORTEX_EMBEDDINGS_MODEL", "env-model")
	os.Setenv("CORTEX_SEARCH_TOP_K", "20")
	defer func() {
		os.Unsetenv("CORTEX_STORAGE_BACKEND")
		os.Unsetenv("CORTEX_EMBEDDINGS_MODEL")
		os.Unsetenv("CORTEX_SEARCH_TOP_K")
	}()

	manager := NewManager()
	cfg, err := manager.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Storage.Backend != "sqlite" {
		t.Errorf("Storage.Backend = %q, want %q (from env)", cfg.Storage.Backend, "sqlite")
	}
	if cfg.Embeddings.Model != "env-model" {
		t.Errorf("Embeddings.Model = %q, want %q (from env)", cfg.Embeddings.Model, "env-model")
	}
	if cfg.Search.TopK != 20 {
		t.Errorf("Search.TopK = %d, want %d (from env)", cfg.Search.TopK, 20)
	}
}

func TestManagerSet(t *testing.T) {
	manager := NewManager()
	_, err := manager.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	// Set values
	manager.Set("storage.backend", "sqlite")
	manager.Set("search.top_k", 15)

	if manager.GetString("storage.backend") != "sqlite" {
		t.Errorf("GetString(storage.backend) = %q, want %q", manager.GetString("storage.backend"), "sqlite")
	}
	if manager.GetInt("search.top_k") != 15 {
		t.Errorf("GetInt(search.top_k) = %d, want %d", manager.GetInt("search.top_k"), 15)
	}
}

func TestManagerAllSettings(t *testing.T) {
	manager := NewManager()
	_, err := manager.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	settings := manager.AllSettings()

	if _, ok := settings["storage"]; !ok {
		t.Error("AllSettings() missing 'storage' key")
	}
	if _, ok := settings["embeddings"]; !ok {
		t.Error("AllSettings() missing 'embeddings' key")
	}
	if _, ok := settings["search"]; !ok {
		t.Error("AllSettings() missing 'search' key")
	}
	if _, ok := settings["output"]; !ok {
		t.Error("AllSettings() missing 'output' key")
	}
}

func TestGlobal(t *testing.T) {
	// Reset global config
	globalConfig = nil

	cfg := Global()
	if cfg == nil {
		t.Error("Global() returned nil")
	}

	// Should return default config
	if cfg.Storage.Backend != "gob" {
		t.Errorf("Global().Storage.Backend = %q, want default %q", cfg.Storage.Backend, "gob")
	}
}

func TestWriteDefaultConfig(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-writeconfig-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Override XDG_CONFIG_HOME to use temp dir
	oldXDG := os.Getenv("XDG_CONFIG_HOME")
	os.Setenv("XDG_CONFIG_HOME", tmpDir)
	defer os.Setenv("XDG_CONFIG_HOME", oldXDG)

	// Write default config
	err = WriteDefaultConfig()
	if err != nil {
		t.Fatalf("WriteDefaultConfig() error = %v", err)
	}

	// Verify file exists
	configFile := filepath.Join(tmpDir, "cortex-ai", "config.yaml")
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		t.Errorf("config file not created at %s", configFile)
	}

	// Verify content
	content, err := os.ReadFile(configFile)
	if err != nil {
		t.Fatalf("failed to read config file: %v", err)
	}

	contentStr := string(content)
	if len(contentStr) == 0 {
		t.Error("config file is empty")
	}

	// Should not overwrite existing file
	err = WriteDefaultConfig()
	if err != nil {
		t.Fatalf("WriteDefaultConfig() should not error on existing file: %v", err)
	}
}
