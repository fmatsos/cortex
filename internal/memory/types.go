package memory

import (
	"fmt"
	"strings"
	"time"
)

// MemoryLevel represents the three-tier memory system
//
// Valid levels:
// - working: session-scoped, temporary
// - episodic: time-bound events and decisions
// - semantic: long-term knowledge
type MemoryLevel string

const (
	MemoryLevelWorking  MemoryLevel = "working"
	MemoryLevelEpisodic MemoryLevel = "episodic"
	MemoryLevelSemantic MemoryLevel = "semantic"
)

// ValidMemoryLevels lists all valid memory levels.
var ValidMemoryLevels = []MemoryLevel{
	MemoryLevelWorking,
	MemoryLevelEpisodic,
	MemoryLevelSemantic,
}

// IsValidLevel checks if a string is a valid memory level.
func IsValidLevel(s string) bool {
	switch MemoryLevel(s) {
	case MemoryLevelWorking, MemoryLevelEpisodic, MemoryLevelSemantic:
		return true
	default:
		return false
	}
}

// MemoryContext holds contextual information about a memory.
type MemoryContext struct {
	TaskID          string    `json:"task_id,omitempty"`
	SessionID       string    `json:"session_id,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
	Author          string    `json:"author,omitempty"`
	Tags            []string  `json:"tags,omitempty"`
	Source          string    `json:"source,omitempty"` // manual, auto, llm
	RelatedMemories []string  `json:"related_memories,omitempty"`
}

// ValidSources lists valid consolidation sources.
var ValidSources = []string{"manual", "auto", "llm"}

// IsValidSource checks if a source is valid.
func IsValidSource(s string) bool {
	for _, valid := range ValidSources {
		if valid == s {
			return true
		}
	}
	return false
}

// Memory represents a memory entry in the three-layer system.
type Memory struct {
	ID         string        `json:"id"`
	Level      MemoryLevel   `json:"level"`
	Title      string        `json:"title"`
	Content    string        `json:"content"`
	Tags       []string      `json:"tags,omitempty"`
	Embedding  []float64     `json:"-"`
	Context    MemoryContext `json:"context"`
	CreatedAt  time.Time     `json:"created_at"`
	UpdatedAt  time.Time     `json:"updated_at"`
	MergedFrom []string      `json:"merged_from,omitempty"`
	Obsolete   bool          `json:"obsolete"`
}

// Validate validates the memory fields.
func (m *Memory) Validate() error {
	if m.Title == "" || len(m.Title) < 3 {
		return fmt.Errorf("title must be at least 3 characters")
	}
	if m.Content == "" || len(m.Content) < 10 {
		return fmt.Errorf("content must be at least 10 characters")
	}
	if !IsValidLevel(string(m.Level)) {
		return fmt.Errorf("invalid level: %s", m.Level)
	}
	if m.Level == MemoryLevelWorking && m.Context.SessionID == "" {
		return fmt.Errorf("session_id required for working memory")
	}
	return nil
}

// TitleOrDerived returns the memory's title if set; otherwise it derives a title
// from the first line of content for backward compatibility with older memories
// that were stored without an explicit title.
func (m *Memory) TitleOrDerived() string {
	if m.Title != "" {
		return m.Title
	}
	content := strings.TrimSpace(m.Content)
	if content == "" {
		return "Memory"
	}
	line := strings.SplitN(content, "\n", 2)[0]
	line = strings.TrimSpace(line)
	if len(line) < 3 {
		return "Memory"
	}
	const max = 60
	lineRunes := []rune(line)
	if len(lineRunes) > max {
		return strings.TrimSpace(string(lineRunes[:max])) + "..."
	}
	return line
}

// ConsolidateInput represents input for consolidating a memory.
type ConsolidateInput struct {
	Synthesis string        `json:"synthesis"`
	Level     MemoryLevel   `json:"level"`
	Context   MemoryContext `json:"context"`
	Force     bool          `json:"force"` // bypass duplicate check
}

// Validate checks if ConsolidateInput is valid.
func (ci ConsolidateInput) Validate() error {
	if ci.Synthesis == "" {
		return &ValidationError{Field: "synthesis", Message: "synthesis is required"}
	}

	if !IsValidLevel(string(ci.Level)) {
		return &ValidationError{Field: "level", Message: "invalid level: must be working|episodic|semantic"}
	}

	if ci.Level == MemoryLevelWorking && ci.Context.SessionID == "" {
		return &ValidationError{Field: "context.session_id", Message: "session_id is required"}
	}

	if ci.Context.Source != "" && !IsValidSource(ci.Context.Source) {
		return &ValidationError{Field: "context.source", Message: "invalid source: must be manual|auto|llm"}
	}

	return nil
}

// ConsolidateResult represents the result of a consolidation operation.
type ConsolidateResult struct {
	Action     string `json:"action"` // "created" | "merged" | "skipped"
	MemoryID   string `json:"memory_id,omitempty"`
	MergedWith string `json:"merged_with,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

// ValidationError represents a field validation error.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}
