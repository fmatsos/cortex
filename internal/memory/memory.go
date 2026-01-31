package memory

import (
	"fmt"
	"strings"
	"time"
)

// MemoryType represents the type of a memory
type MemoryType string

// Valid memory types
const (
	MemoryTypeSolution MemoryType = "solution" // A fix or workaround
	MemoryTypeIssue    MemoryType = "issue"    // A problem, bug, or challenge
	MemoryTypeAnalysis MemoryType = "analysis" // Investigation, root cause analysis
	MemoryTypeRule     MemoryType = "rule"     // Convention, standard, guideline
	MemoryTypeAny      MemoryType = "any"      // Generic memory
)

// ValidMemoryTypes lists all valid memory types
var ValidMemoryTypes = []MemoryType{
	MemoryTypeSolution,
	MemoryTypeIssue,
	MemoryTypeAnalysis,
	MemoryTypeRule,
	MemoryTypeAny,
}

// IsValidType checks if a memory type is valid
func IsValidType(t string) bool {
	for _, valid := range ValidMemoryTypes {
		if string(valid) == t {
			return true
		}
	}
	return false
}

// Memory represents a single memory entry with embeddings
type Memory struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`   // Required
	Content   string            `json:"content"` // Required
	Types     []MemoryType      `json:"types"`   // Required, can be combined
	Tags      []string          `json:"tags,omitempty"`
	Embedding []float64         `json:"-"` // Vector embedding
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
	Metadata  map[string]string `json:"metadata,omitempty"`
	Obsolete  bool              `json:"obsolete"`
}

// CreateInput represents the input for creating a memory
type CreateInput struct {
	Title    string
	Content  string
	Types    []MemoryType
	Tags     []string
	Metadata map[string]string
}

// Validate checks if CreateInput is valid
func (ci CreateInput) Validate() error {
	if strings.TrimSpace(ci.Title) == "" {
		return fmt.Errorf("title is required")
	}

	if strings.TrimSpace(ci.Content) == "" {
		return fmt.Errorf("content is required")
	}

	if len(ci.Types) == 0 {
		return fmt.Errorf("at least one type is required")
	}

	for _, t := range ci.Types {
		if !IsValidType(string(t)) {
			return fmt.Errorf("invalid type: %s (must be solution|issue|analysis|rule|any)", t)
		}
	}

	return nil
}

// SearchResult represents a memory found through search
type SearchResult struct {
	Memory *Memory
	Score  float64 // Similarity score (0-1)
}

// SearchOptions contains options for searching memories
type SearchOptions struct {
	TopK            int          // Number of results to return
	MinScore        float64      // Minimum similarity score
	IncludeObsolete bool         // Include obsolete memories
	FilterTypes     []MemoryType // Filter by memory types (empty = no filter)
}

// ListOptions contains options for listing memories
type ListOptions struct {
	IncludeObsolete bool         // Include obsolete memories
	FilterTypes     []MemoryType // Filter by memory types (empty = no filter)
	SortBy          string       // Sort by: "created", "updated", "title"
}
