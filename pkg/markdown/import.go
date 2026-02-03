package markdown

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

// ImportResult represents the result of importing a file
type ImportResult struct {
	Path   string
	Memory *memory.Memory
	Error  error
}

// Importer imports memories from Markdown files
type Importer struct{}

// NewImporter creates a new Importer
func NewImporter() *Importer {
	return &Importer{}
}

// ImportFile parses a Markdown file and returns a Memory
func (i *Importer) ImportFile(path string) (*memory.Memory, error) {
	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	// Parse frontmatter
	result, err := ParseFrontmatter(content)
	if err != nil {
		return nil, fmt.Errorf("failed to parse frontmatter: %w", err)
	}

	// Validate for import
	if err := ValidateForImport(result); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Build memory
	m := &memory.Memory{
		ID:      result.Frontmatter.ID,
		Title:   result.Frontmatter.Title,
		Content: result.Body,
		Level:   memory.MemoryLevel(result.Frontmatter.Level),
		Tags:    result.Frontmatter.Tags,
		Context: memory.MemoryContext{
			SessionID: result.Frontmatter.SessionID,
			Tags:      result.Frontmatter.Tags,
			Source:    "manual",
		},
		Obsolete: result.Frontmatter.Obsolete,
	}

	// Generate ID if not provided
	if m.ID == "" {
		m.ID = uuid.New().String()
	}

	// Set timestamps
	if result.Frontmatter.CreatedAt.IsZero() {
		m.CreatedAt = time.Now().UTC()
	} else {
		m.CreatedAt = result.Frontmatter.CreatedAt
	}

	if result.Frontmatter.UpdatedAt.IsZero() {
		m.UpdatedAt = time.Now().UTC()
	} else {
		m.UpdatedAt = result.Frontmatter.UpdatedAt
	}

	if result.Frontmatter.CreatedAt.IsZero() {
		m.Context.Timestamp = m.CreatedAt
	} else {
		m.Context.Timestamp = result.Frontmatter.CreatedAt
	}

	return m, nil
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

// ValidateFile validates a file without importing it (dry-run)
func (i *Importer) ValidateFile(path string) error {
	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	// Parse frontmatter
	result, err := ParseFrontmatter(content)
	if err != nil {
		return fmt.Errorf("failed to parse frontmatter: %w", err)
	}

	// Validate for import
	if err := ValidateForImport(result); err != nil {
		return err
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

	// Filter to only .md files
	var mdFiles []string
	for _, match := range matches {
		if filepath.Ext(match) == ".md" {
			mdFiles = append(mdFiles, match)
		}
	}

	return mdFiles, nil
}
