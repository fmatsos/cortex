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

type reviewSessionArgs struct {
	SessionID   string `json:"session_id"`
	TaskSummary string `json:"task_summary"`
}

func (s *Server) handleReviewSession(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a reviewSessionArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid review session arguments: %v", err)), nil
	}

	if a.SessionID == "" {
		return toolError("session_id is required"), nil
	}

	memories, err := s.service.List(ctx, memory.ListOptions{
		FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking},
	})
	if err != nil {
		return toolError(fmt.Sprintf("Failed to list working memories: %v", err)), nil
	}

	var sessionMemories []*memory.Memory
	for _, m := range memories {
		if m.Context.SessionID == a.SessionID {
			sessionMemories = append(sessionMemories, m)
		}
	}

	if len(sessionMemories) == 0 {
		return toolResult(fmt.Sprintf("No working memories found for session %q. Nothing to review.", a.SessionID)), nil
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.ReviewSession)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.ReviewSession
	}

	type memoryEntry struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Content   string   `json:"content"`
		Tags      []string `json:"tags,omitempty"`
		CreatedAt string   `json:"created_at"`
	}

	entries := make([]memoryEntry, 0, len(sessionMemories))
	for _, m := range sessionMemories {
		entries = append(entries, memoryEntry{
			ID:        m.ID,
			Title:     m.Title,
			Content:   m.Content,
			Tags:      m.Tags,
			CreatedAt: m.CreatedAt.Format(time.RFC3339),
		})
	}

	payload := struct {
		SessionID       string        `json:"session_id"`
		TaskSummary     string        `json:"task_summary,omitempty"`
		MemoryCount     int           `json:"memory_count"`
		WorkingMemories []memoryEntry `json:"working_memories"`
	}{
		SessionID:       a.SessionID,
		TaskSummary:     a.TaskSummary,
		MemoryCount:     len(entries),
		WorkingMemories: entries,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal payload: %v", err)), nil
	}

	finalPrompt := fmt.Sprintf("%s\n\nSession data:\n%s", prompt, string(jsonBytes))
	return toolResult(finalPrompt), nil
}
