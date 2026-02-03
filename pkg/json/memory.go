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
	ID         string               `json:"id"`
	Title      string               `json:"title"`
	Content    string               `json:"content"`
	Level      string               `json:"level"`
	Tags       []string             `json:"tags,omitempty"`
	Context    memory.MemoryContext `json:"context"`
	CreatedAt  time.Time            `json:"created_at"`
	UpdatedAt  time.Time            `json:"updated_at"`
	MergedFrom []string             `json:"merged_from,omitempty"`
	Obsolete   bool                 `json:"obsolete,omitempty"`
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
	return MemoryJSON{
		ID:         m.ID,
		Title:      m.Title,
		Content:    m.Content,
		Level:      string(m.Level),
		Tags:       m.Tags,
		Context:    m.Context,
		CreatedAt:  m.CreatedAt,
		UpdatedAt:  m.UpdatedAt,
		MergedFrom: m.MergedFrom,
		Obsolete:   m.Obsolete,
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
	if mj.Level == "" {
		return nil, fmt.Errorf("level is required")
	}
	if !memory.IsValidLevel(mj.Level) {
		return nil, fmt.Errorf("invalid level: %s (must be working|episodic|semantic)", mj.Level)
	}

	m := &memory.Memory{
		ID:         mj.ID,
		Title:      mj.Title,
		Content:    mj.Content,
		Level:      memory.MemoryLevel(mj.Level),
		Tags:       mj.Tags,
		Context:    mj.Context,
		MergedFrom: mj.MergedFrom,
		Obsolete:   mj.Obsolete,
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

	if m.Context.Timestamp.IsZero() {
		m.Context.Timestamp = m.CreatedAt
	}

	return m, nil
}

// ValidLevels for validation
var ValidLevels = []string{"working", "episodic", "semantic"}
