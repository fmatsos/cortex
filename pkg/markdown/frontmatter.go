// Package markdown provides import/export functionality for memories in Markdown format
package markdown

import (
	"time"
)

// Frontmatter represents the YAML frontmatter in a memory Markdown file
type Frontmatter struct {
	ID        string    `yaml:"id,omitempty"`         // Optional on import (generated if missing)
	Title     string    `yaml:"title"`                // Required
	Level     string    `yaml:"level"`                // Required: working|episodic|semantic
	Tags      []string  `yaml:"tags,omitempty"`       // Optional
	SessionID string    `yaml:"session_id,omitempty"` // Required for working level
	CreatedAt time.Time `yaml:"created_at,omitempty"` // Optional on import
	UpdatedAt time.Time `yaml:"updated_at,omitempty"` // Optional on import
	Obsolete  bool      `yaml:"obsolete,omitempty"`   // Default false
}

// SynthesisFrontmatter represents the frontmatter for synthesis exports
type SynthesisFrontmatter struct {
	Type           string         `yaml:"type"`            // Always "synthesis"
	Intent         string         `yaml:"intent"`          // Search query/intent
	GeneratedAt    time.Time      `yaml:"generated_at"`    // Generation timestamp
	SourceMemories []SourceMemory `yaml:"source_memories"` // Referenced memories
}

// SourceMemory represents a memory reference in synthesis
type SourceMemory struct {
	ID    string  `yaml:"id"`
	Title string  `yaml:"title"`
	Score float64 `yaml:"score"`
}

// ValidLevels for validation
var ValidLevels = []string{"working", "episodic", "semantic"}

// RequiredFields lists fields that must be present on import
var RequiredFields = []string{"title", "level"}
