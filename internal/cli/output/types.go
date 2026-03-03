// Package output provides typed output structures for CLI commands.
package output

import (
	"time"
)

// ListItem represents a single memory in list output.
type ListItem struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Level     string    `json:"level"`
	Tags      []string  `json:"tags,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	Obsolete  bool      `json:"obsolete"`
}

// SearchItem represents a single search result.
type SearchItem struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Level string   `json:"level"`
	Score float64  `json:"score"`
	Tags  []string `json:"tags,omitempty"`
}
