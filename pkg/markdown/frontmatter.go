// Package markdown provides import/export functionality for memories in Markdown format
package markdown

import (
	"time"
)

// Frontmatter represents the YAML frontmatter in a memory Markdown file
type Frontmatter struct {
	ID        string            `yaml:"id,omitempty"`         // Optional on import (generated if missing)
	Title     string            `yaml:"title"`                // Required
	Types     []string          `yaml:"type"`                 // Required: solution|issue|analysis|rule|any
	Tags      []string          `yaml:"tags,omitempty"`       // Optional
	CreatedAt time.Time         `yaml:"created_at,omitempty"` // Optional on import
	UpdatedAt time.Time         `yaml:"updated_at,omitempty"` // Optional on import
	Obsolete  bool              `yaml:"obsolete,omitempty"`   // Default false
	Metadata  map[string]string `yaml:"metadata,omitempty"`   // Optional custom metadata
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

// ValidTypes for validation
var ValidTypes = []string{"solution", "issue", "analysis", "rule", "any"}

// RequiredFields lists fields that must be present on import
var RequiredFields = []string{"title", "type"}
