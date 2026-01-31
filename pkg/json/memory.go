// Package json provides native JSON import/export functionality for memories.
// JSON is the default format for memory handoffs in Cortex, providing better
// structure and easier parsing for LLMs compared to Markdown.
package json

import (
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/google/uuid"
)

// MemoryJSON represents a memory in JSON format for handoffs
type MemoryJSON struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Content   string            `json:"content"`
	Types     []string          `json:"types"`
	Tags      []string          `json:"tags,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
	Obsolete  bool              `json:"obsolete,omitempty"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// SearchResultJSON represents a search result in JSON format
type SearchResultJSON struct {
	Memory MemoryJSON `json:"memory"`
	Score  float64    `json:"score"`
}

// SynthesisJSON represents a synthesis document in JSON format
type SynthesisJSON struct {
	Type           string             `json:"type"` // Always "synthesis"
	Intent         string             `json:"intent"`
	GeneratedAt    time.Time          `json:"generated_at"`
	SourceMemories []SourceMemoryJSON `json:"source_memories"`
	Summary        string             `json:"summary,omitempty"`
}

// SourceMemoryJSON represents a memory reference in synthesis
type SourceMemoryJSON struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Score   float64 `json:"score"`
	Preview string  `json:"preview,omitempty"`
}

// BatchExportJSON represents a batch export result
type BatchExportJSON struct {
	ExportedAt time.Time    `json:"exported_at"`
	Count      int          `json:"count"`
	Memories   []MemoryJSON `json:"memories"`
}

// ToMemoryJSON converts a Memory to MemoryJSON
func ToMemoryJSON(m *memory.Memory) MemoryJSON {
	types := make([]string, len(m.Types))
	for i, t := range m.Types {
		types[i] = string(t)
	}

	return MemoryJSON{
		ID:        m.ID,
		Title:     m.Title,
		Content:   m.Content,
		Types:     types,
		Tags:      m.Tags,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
		Obsolete:  m.Obsolete,
		Metadata:  m.Metadata,
	}
}

// ToSearchResultJSON converts a SearchResult to SearchResultJSON
func ToSearchResultJSON(r *memory.SearchResult) SearchResultJSON {
	return SearchResultJSON{
		Memory: ToMemoryJSON(r.Memory),
		Score:  r.Score,
	}
}

// ToMemory converts a MemoryJSON back to a Memory struct
func (mj *MemoryJSON) ToMemory() (*memory.Memory, error) {
	// Validate required fields
	if mj.Title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if len(mj.Types) == 0 {
		return nil, fmt.Errorf("at least one type is required")
	}

	// Validate types
	types := make([]memory.MemoryType, len(mj.Types))
	for i, t := range mj.Types {
		if !memory.IsValidType(t) {
			return nil, fmt.Errorf("invalid type: %s (must be solution|issue|analysis|rule|any)", t)
		}
		types[i] = memory.MemoryType(t)
	}

	m := &memory.Memory{
		ID:       mj.ID,
		Title:    mj.Title,
		Content:  mj.Content,
		Types:    types,
		Tags:     mj.Tags,
		Obsolete: mj.Obsolete,
		Metadata: mj.Metadata,
	}

	// Generate ID if not provided
	if m.ID == "" {
		m.ID = uuid.New().String()
	}

	// Set timestamps
	if mj.CreatedAt.IsZero() {
		m.CreatedAt = time.Now().UTC()
	} else {
		m.CreatedAt = mj.CreatedAt
	}

	if mj.UpdatedAt.IsZero() {
		m.UpdatedAt = time.Now().UTC()
	} else {
		m.UpdatedAt = mj.UpdatedAt
	}

	return m, nil
}

// ValidTypes for validation
var ValidTypes = []string{"solution", "issue", "analysis", "rule", "any"}
