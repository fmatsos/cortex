package json

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// ImportResult represents the result of importing a file
type ImportResult struct {
	Path   string
	Memory *memory.Memory
	Error  error
}

// Importer imports memories from JSON files
type Importer struct{}

// NewImporter creates a new Importer
func NewImporter() *Importer {
	return &Importer{}
}

// ImportFile parses a JSON file and returns a Memory
func (i *Importer) ImportFile(path string) (*memory.Memory, error) {
	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return i.ImportBytes(content)
}

// ImportBytes parses JSON bytes and returns a Memory
func (i *Importer) ImportBytes(data []byte) (*memory.Memory, error) {
	var mj MemoryJSON
	if err := json.Unmarshal(data, &mj); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return mj.ToMemory()
}

// ImportFiles imports multiple files and returns results for each
// Continues importing even if some files fail
func (i *Importer) ImportFiles(paths []string) []ImportResult {
	results := make([]ImportResult, len(paths))

	for idx, path := range paths {
		m, err := i.ImportFile(path)
		results[idx] = ImportResult{
			Path:   path,
			Memory: m,
			Error:  err,
		}
	}

	return results
}

// ImportBatch imports a batch export JSON file
func (i *Importer) ImportBatch(path string) ([]*memory.Memory, error) {
	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return i.ImportBatchBytes(content)
}

// ImportBatchBytes imports batch JSON bytes
func (i *Importer) ImportBatchBytes(data []byte) ([]*memory.Memory, error) {
	var batch BatchExportJSON
	if err := json.Unmarshal(data, &batch); err != nil {
		// Try as a plain array
		var memories []MemoryJSON
		if err2 := json.Unmarshal(data, &memories); err2 != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
		return i.convertMemories(memories)
	}

	return i.convertMemories(batch.Memories)
}

func (i *Importer) convertMemories(mjs []MemoryJSON) ([]*memory.Memory, error) {
	memories := make([]*memory.Memory, 0, len(mjs))
	for idx, mj := range mjs {
		m, err := mj.ToMemory()
		if err != nil {
			return nil, fmt.Errorf("memory at index %d: %w", idx, err)
		}
		memories = append(memories, m)
	}
	return memories, nil
}

// ValidateFile validates a file without importing it (dry-run)
func (i *Importer) ValidateFile(path string) error {
	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	return i.ValidateBytes(content)
}

// ValidateBytes validates JSON bytes without creating a Memory
func (i *Importer) ValidateBytes(data []byte) error {
	var mj MemoryJSON
	if err := json.Unmarshal(data, &mj); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	// Validate required fields
	if mj.Title == "" {
		return fmt.Errorf("title is required")
	}
	if mj.Level == "" {
		return fmt.Errorf("level is required")
	}
	if !memory.IsValidLevel(mj.Level) {
		return fmt.Errorf("invalid level: %s (must be working|episodic|semantic)", mj.Level)
	}
	if memory.MemoryLevel(mj.Level) == memory.MemoryLevelWorking && mj.Context.SessionID == "" {
		return fmt.Errorf("session_id is required for working level")
	}

	return nil
}

// ValidateFiles validates multiple files without importing them
func (i *Importer) ValidateFiles(paths []string) []ImportResult {
	results := make([]ImportResult, len(paths))

	for idx, path := range paths {
		err := i.ValidateFile(path)
		results[idx] = ImportResult{
			Path:  path,
			Error: err,
		}
	}

	return results
}

// ExpandGlob expands a glob pattern to file paths
func ExpandGlob(pattern string) ([]string, error) {
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid glob pattern: %w", err)
	}

	// Filter to only .json files
	var jsonFiles []string
	for _, match := range matches {
		if filepath.Ext(match) == ".json" {
			jsonFiles = append(jsonFiles, match)
		}
	}

	return jsonFiles, nil
}
