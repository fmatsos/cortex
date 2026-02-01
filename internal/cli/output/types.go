// Package output provides typed output structures for CLI commands.
package output

import (
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// CreateOutput represents the output of the create command.
type CreateOutput struct {
	ID      string              `json:"id"`
	Title   string              `json:"title"`
	Types   []memory.MemoryType `json:"types"`
	Created time.Time           `json:"created"`
}

// ListItem represents a single memory in list output.
type ListItem struct {
	ID        string              `json:"id"`
	Title     string              `json:"title"`
	Types     []memory.MemoryType `json:"types"`
	CreatedAt time.Time           `json:"created"`
	Obsolete  bool                `json:"obsolete"`
}

// SearchItem represents a single search result.
type SearchItem struct {
	ID    string              `json:"id"`
	Title string              `json:"title"`
	Types []memory.MemoryType `json:"types"`
	Score float64             `json:"score"`
}

// SearchResultForTemplate represents a search result for template rendering.
type SearchResultForTemplate struct {
	Memory *memory.Memory
	Score  float64
}

// ImportFileResult represents the result of importing a single file.
type ImportFileResult struct {
	Path   string `json:"path"`
	Status string `json:"status"` // "imported", "failed", "skipped"
	ID     string `json:"id,omitempty"`
	Title  string `json:"title,omitempty"`
	Error  string `json:"error,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// ImportOutput represents the output of the import command.
type ImportOutput struct {
	Imported int                `json:"imported"`
	Failed   int                `json:"failed"`
	Skipped  int                `json:"skipped"`
	Files    []ImportFileResult `json:"files"`
}

// ExportSingleOutput represents the output of exporting a single memory.
type ExportSingleOutput struct {
	Path    string `json:"path"`
	ID      string `json:"id"`
	Title   string `json:"title"`
	Success bool   `json:"success"`
}

// ExportBatchOutput represents the output of batch export.
type ExportBatchOutput struct {
	Count int      `json:"count"`
	Paths []string `json:"paths"`
}

// ExportSourceMemory represents a source memory in synthesis export.
type ExportSourceMemory struct {
	ID    string  `json:"id"`
	Title string  `json:"title"`
	Score float64 `json:"score"`
}

// ExportSynthesisOutput represents the output of synthesis export.
type ExportSynthesisOutput struct {
	Path    string               `json:"path"`
	Intent  string               `json:"intent"`
	Count   int                  `json:"count"`
	Sources []ExportSourceMemory `json:"sources"`
}

// StatsOutput represents the output of the stats command.
type StatsOutput struct {
	TotalMemories   int            `json:"total_memories"`
	MemoriesByType  map[string]int `json:"memories_by_type"`
	TotalChunks     int            `json:"total_chunks"`
	DatabaseCreated *time.Time     `json:"database_created,omitempty"`
	LastRecordDate  *time.Time     `json:"last_record_date,omitempty"`
	ObsoleteCount   int            `json:"obsolete_count"`
	ActiveCount     int            `json:"active_count"`
	StorageMode     string         `json:"storage_mode"`
	StoragePath     string         `json:"storage_path"`
	ConfigFile      string         `json:"config_file,omitempty"`
	// Extra fields for template rendering
	StorageModified string `json:"-"`
}

// ConfigOutput represents the output of the config command (for template).
type ConfigOutput struct {
	Storage struct {
		Backend string `json:"backend"`
		Path    string `json:"path"`
	} `json:"storage"`
	Embeddings struct {
		Provider string        `json:"provider"`
		Model    string        `json:"model"`
		Endpoint string        `json:"endpoint"`
		Timeout  time.Duration `json:"timeout"`
	} `json:"embeddings"`
	Search struct {
		TopK            int     `json:"top_k"`
		MinScore        float64 `json:"min_score"`
		IncludeObsolete bool    `json:"include_obsolete"`
	} `json:"search"`
	Output struct {
		Format string `json:"format"`
		Colors bool   `json:"colors"`
	} `json:"output"`
	ConfigFile string `json:"-"`
}

// ValidationResult represents a file validation result for import dry-run.
type ValidationResult struct {
	Path  string `json:"path"`
	Valid bool   `json:"valid"`
	Error string `json:"error,omitempty"`
}
