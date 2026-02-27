package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type thinkMemoryMaintenanceArgs struct {
	FocusLevel string   `json:"focus_level"`
	FocusTags  []string `json:"focus_tags"`
}

func (s *Server) handleThinkMemoryMaintenance(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a thinkMemoryMaintenanceArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid memory maintenance arguments: %v", err)), nil
	}

	if a.FocusLevel != "" && !memory.IsValidLevel(a.FocusLevel) {
		return toolError(fmt.Sprintf("invalid focus_level: %s", a.FocusLevel)), nil
	}

	opts := memory.ListOptions{IncludeObsolete: true}
	if a.FocusLevel != "" {
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.FocusLevel)}
	}

	memories, err := s.service.List(ctx, opts)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to list memories: %v", err)), nil
	}

	if len(a.FocusTags) > 0 {
		tagSet := make(map[string]bool)
		for _, t := range a.FocusTags {
			tagSet[t] = true
		}
		var filtered []*memory.Memory
		for _, m := range memories {
			for _, t := range m.Tags {
				if tagSet[t] {
					filtered = append(filtered, m)
					break
				}
			}
		}
		memories = filtered
	}

	var workingCount, episodicCount, semanticCount, obsoleteCount int

	type memoryEntry struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Level     string   `json:"level"`
		Tags      []string `json:"tags,omitempty"`
		CreatedAt string   `json:"created_at"`
		Obsolete  bool     `json:"obsolete,omitempty"`
		Preview   string   `json:"preview"`
	}

	entries := make([]memoryEntry, 0, len(memories))
	for _, m := range memories {
		switch m.Level {
		case memory.MemoryLevelWorking:
			workingCount++
		case memory.MemoryLevelEpisodic:
			episodicCount++
		case memory.MemoryLevelSemantic:
			semanticCount++
		}
		if m.Obsolete {
			obsoleteCount++
		}

		preview := m.Content
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}

		entries = append(entries, memoryEntry{
			ID:        m.ID,
			Title:     m.Title,
			Level:     string(m.Level),
			Tags:      m.Tags,
			CreatedAt: m.CreatedAt.Format(time.RFC3339),
			Obsolete:  m.Obsolete,
			Preview:   preview,
		})
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.MemoryMaintenance)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.MemoryMaintenance
	}

	stats := struct {
		Total    int `json:"total"`
		Working  int `json:"working"`
		Episodic int `json:"episodic"`
		Semantic int `json:"semantic"`
		Obsolete int `json:"obsolete"`
	}{
		Total:    len(memories),
		Working:  workingCount,
		Episodic: episodicCount,
		Semantic: semanticCount,
		Obsolete: obsoleteCount,
	}

	payload := struct {
		Stats      interface{}   `json:"stats"`
		FocusLevel string        `json:"focus_level,omitempty"`
		FocusTags  []string      `json:"focus_tags,omitempty"`
		Memories   []memoryEntry `json:"memories"`
	}{
		Stats:      stats,
		FocusLevel: a.FocusLevel,
		FocusTags:  a.FocusTags,
		Memories:   entries,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal payload: %v", err)), nil
	}

	finalPrompt := fmt.Sprintf("%s\n\nMemory store data:\n%s", prompt, string(jsonBytes))
	return toolResult(finalPrompt), nil
}
