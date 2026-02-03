package memory

import "time"

// MemoryLevel represents the hierarchical level of a memory
type MemoryLevel string

// Valid memory levels
const (
	// MemoryLevelWorking is for temporary session-scoped memories
	MemoryLevelWorking MemoryLevel = "working"
	// MemoryLevelEpisodic is for historical events and decisions
	MemoryLevelEpisodic MemoryLevel = "episodic"
	// MemoryLevelSemantic is for general knowledge and conventions
	MemoryLevelSemantic MemoryLevel = "semantic"
)

// ValidMemoryLevels lists all valid memory levels
var ValidMemoryLevels = []MemoryLevel{
	MemoryLevelWorking,
	MemoryLevelEpisodic,
	MemoryLevelSemantic,
}

// IsValidLevel checks if a memory level is valid
func IsValidLevel(l string) bool {
	for _, valid := range ValidMemoryLevels {
		if string(valid) == l {
			return true
		}
	}
	return false
}

// ConsolidationContext provides context for memory consolidation
type ConsolidationContext struct {
	TaskID          string    `json:"task_id,omitempty"`
	SessionID       string    `json:"session_id"`
	Timestamp       time.Time `json:"timestamp"`
	Author          string    `json:"author,omitempty"`
	Tags            []string  `json:"tags,omitempty"`
	Source          string    `json:"source"` // "manual" | "auto" | "llm"
	RelatedMemories []string  `json:"related_memories,omitempty"`
}

// ValidSources lists valid consolidation sources
var ValidSources = []string{"manual", "auto", "llm"}

// IsValidSource checks if a source is valid
func IsValidSource(s string) bool {
	for _, valid := range ValidSources {
		if valid == s {
			return true
		}
	}
	return false
}

// ConsolidatedMemory represents a memory created through consolidation
type ConsolidatedMemory struct {
	ID         string               `json:"id"`
	Level      MemoryLevel          `json:"level"`
	Content    string               `json:"content"`
	Embedding  []float64            `json:"-"`
	Context    ConsolidationContext `json:"context"`
	CreatedAt  time.Time            `json:"created_at"`
	UpdatedAt  time.Time            `json:"updated_at"`
	MergedFrom []string             `json:"merged_from,omitempty"` // IDs of merged memories
}

// ConsolidateInput represents input for consolidating a memory
type ConsolidateInput struct {
	Synthesis string               `json:"synthesis"`
	Level     MemoryLevel          `json:"level"`
	Context   ConsolidationContext `json:"context"`
	Force     bool                 `json:"force"` // bypass duplicate check
}

// Validate checks if ConsolidateInput is valid
func (ci ConsolidateInput) Validate() error {
	if ci.Synthesis == "" {
		return &ValidationError{Field: "synthesis", Message: "synthesis is required"}
	}

	if !IsValidLevel(string(ci.Level)) {
		return &ValidationError{Field: "level", Message: "invalid level: must be working|episodic|semantic"}
	}

	if ci.Context.SessionID == "" {
		return &ValidationError{Field: "context.session_id", Message: "session_id is required"}
	}

	if ci.Context.Source != "" && !IsValidSource(ci.Context.Source) {
		return &ValidationError{Field: "context.source", Message: "invalid source: must be manual|auto|llm"}
	}

	return nil
}

// ConsolidateResult represents the result of a consolidation operation
type ConsolidateResult struct {
	Action     string `json:"action"` // "created" | "merged" | "skipped"
	MemoryID   string `json:"memory_id,omitempty"`
	MergedWith string `json:"merged_with,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

// ValidationError represents a field validation error
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}
