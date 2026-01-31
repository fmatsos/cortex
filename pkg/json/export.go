package json

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// Exporter exports memories to JSON files
type Exporter struct {
	outputDir string
	indent    bool
}

// NewExporter creates a new Exporter
func NewExporter(outputDir string) *Exporter {
	return &Exporter{
		outputDir: outputDir,
		indent:    true,
	}
}

// SetIndent controls whether JSON output is indented
func (e *Exporter) SetIndent(indent bool) {
	e.indent = indent
}

// ExportMemory exports a single memory to a JSON file
// Returns the path of the exported file
func (e *Exporter) ExportMemory(m *memory.Memory) (string, error) {
	if m == nil {
		return "", fmt.Errorf("memory is nil")
	}

	// Ensure output directory exists
	if err := os.MkdirAll(e.outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	mj := ToMemoryJSON(m)

	// Marshal to JSON
	var data []byte
	var err error
	if e.indent {
		data, err = json.MarshalIndent(mj, "", "  ")
	} else {
		data, err = json.Marshal(mj)
	}
	if err != nil {
		return "", fmt.Errorf("failed to marshal memory: %w", err)
	}

	// Write to file
	filename := fmt.Sprintf("%s.json", m.ID)
	filepath := filepath.Join(e.outputDir, filename)

	if err := os.WriteFile(filepath, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return filepath, nil
}

// ExportAll exports all memories to separate JSON files
// Returns the paths of all exported files
func (e *Exporter) ExportAll(memories []*memory.Memory) ([]string, error) {
	if len(memories) == 0 {
		return nil, nil
	}

	var paths []string
	for _, m := range memories {
		path, err := e.ExportMemory(m)
		if err != nil {
			return paths, fmt.Errorf("failed to export memory %s: %w", m.ID, err)
		}
		paths = append(paths, path)
	}

	return paths, nil
}

// ExportAllToBatch exports all memories to a single JSON file as an array
func (e *Exporter) ExportAllToBatch(memories []*memory.Memory) (string, error) {
	// Ensure output directory exists
	if err := os.MkdirAll(e.outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	batch := BatchExportJSON{
		ExportedAt: time.Now().UTC(),
		Count:      len(memories),
		Memories:   make([]MemoryJSON, len(memories)),
	}

	for i, m := range memories {
		batch.Memories[i] = ToMemoryJSON(m)
	}

	// Marshal to JSON
	var data []byte
	var err error
	if e.indent {
		data, err = json.MarshalIndent(batch, "", "  ")
	} else {
		data, err = json.Marshal(batch)
	}
	if err != nil {
		return "", fmt.Errorf("failed to marshal batch: %w", err)
	}

	// Write to file
	filepath := filepath.Join(e.outputDir, "memories.json")

	if err := os.WriteFile(filepath, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return filepath, nil
}

// ExportSynthesis generates a synthesis document from search results as JSON
func (e *Exporter) ExportSynthesis(intent string, results []*memory.SearchResult) (string, error) {
	if len(results) == 0 {
		return "", fmt.Errorf("no results to synthesize")
	}

	// Ensure output directory exists
	if err := os.MkdirAll(e.outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	// Build source memories list
	sources := make([]SourceMemoryJSON, len(results))
	for i, r := range results {
		sources[i] = SourceMemoryJSON{
			ID:      r.Memory.ID,
			Title:   r.Memory.Title,
			Score:   r.Score,
			Preview: getContentPreview(r.Memory.Content, 500),
		}
	}

	synthesis := SynthesisJSON{
		Type:           "synthesis",
		Intent:         intent,
		GeneratedAt:    time.Now().UTC(),
		SourceMemories: sources,
		Summary:        fmt.Sprintf("Synthesis of %d memories related to \"%s\"", len(results), intent),
	}

	// Marshal to JSON
	var data []byte
	var err error
	if e.indent {
		data, err = json.MarshalIndent(synthesis, "", "  ")
	} else {
		data, err = json.Marshal(synthesis)
	}
	if err != nil {
		return "", fmt.Errorf("failed to marshal synthesis: %w", err)
	}

	// Write to file
	filename := fmt.Sprintf("synthesis-%s.json", sanitizeFilename(intent))
	filepath := filepath.Join(e.outputDir, filename)

	if err := os.WriteFile(filepath, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write synthesis file: %w", err)
	}

	return filepath, nil
}

// MarshalMemory returns a memory as JSON bytes (for MCP responses)
func MarshalMemory(m *memory.Memory, indent bool) ([]byte, error) {
	mj := ToMemoryJSON(m)
	if indent {
		return json.MarshalIndent(mj, "", "  ")
	}
	return json.Marshal(mj)
}

// MarshalSearchResults returns search results as JSON bytes (for MCP responses)
func MarshalSearchResults(results []*memory.SearchResult, indent bool) ([]byte, error) {
	srs := make([]SearchResultJSON, len(results))
	for i, r := range results {
		srs[i] = ToSearchResultJSON(r)
	}

	response := struct {
		Count   int                `json:"count"`
		Results []SearchResultJSON `json:"results"`
	}{
		Count:   len(results),
		Results: srs,
	}

	if indent {
		return json.MarshalIndent(response, "", "  ")
	}
	return json.Marshal(response)
}

// MarshalMemories returns a list of memories as JSON bytes (for MCP responses)
func MarshalMemories(memories []*memory.Memory, indent bool) ([]byte, error) {
	mjs := make([]MemoryJSON, len(memories))
	for i, m := range memories {
		mjs[i] = ToMemoryJSON(m)
	}

	response := struct {
		Count    int          `json:"count"`
		Memories []MemoryJSON `json:"memories"`
	}{
		Count:    len(memories),
		Memories: mjs,
	}

	if indent {
		return json.MarshalIndent(response, "", "  ")
	}
	return json.Marshal(response)
}

// getContentPreview returns a preview of the content
func getContentPreview(content string, maxLen int) string {
	if len(content) <= maxLen {
		return content
	}
	return content[:maxLen] + "..."
}

// sanitizeFilename removes or replaces characters that are invalid in filenames
func sanitizeFilename(s string) string {
	result := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			// Skip invalid characters
		case ' ':
			result = append(result, '-')
		default:
			if c >= 'A' && c <= 'Z' {
				result = append(result, c+32) // lowercase
			} else {
				result = append(result, c)
			}
		}
	}
	if len(result) > 50 {
		result = result[:50]
	}
	return string(result)
}
