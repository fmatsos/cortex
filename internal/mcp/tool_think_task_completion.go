package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type thinkTaskCompletionArgs struct {
	TaskDescription  string   `json:"task_description"`
	Outcome          string   `json:"outcome"`
	SessionID        string   `json:"session_id"`
	RelatedMemoryIDs []string `json:"related_memory_ids"`
}

func (s *Server) handleThinkTaskCompletion(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a thinkTaskCompletionArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid task completion arguments: %v", err)), nil
	}

	if a.TaskDescription == "" {
		return toolError("task_description is required"), nil
	}
	if a.Outcome == "" {
		return toolError("outcome is required"), nil
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.TaskCompletion)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.TaskCompletion
	}

	type relatedMemory struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Level   string `json:"level"`
		Preview string `json:"preview"`
	}

	var relatedMemories []relatedMemory
	for _, memID := range a.RelatedMemoryIDs {
		if m, err := s.service.Get(ctx, memID); err == nil {
			preview := m.Content
			if len(preview) > 200 {
				preview = preview[:200] + "..."
			}
			relatedMemories = append(relatedMemories, relatedMemory{
				ID:      m.ID,
				Title:   m.Title,
				Level:   string(m.Level),
				Preview: preview,
			})
		}
	}

	payload := struct {
		TaskDescription string          `json:"task_description"`
		Outcome         string          `json:"outcome"`
		SessionID       string          `json:"session_id,omitempty"`
		RelatedMemories []relatedMemory `json:"related_memories,omitempty"`
	}{
		TaskDescription: a.TaskDescription,
		Outcome:         a.Outcome,
		SessionID:       a.SessionID,
		RelatedMemories: relatedMemories,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal payload: %v", err)), nil
	}

	finalPrompt := fmt.Sprintf("%s\n\nTask data:\n%s", prompt, string(jsonBytes))
	return toolResult(finalPrompt), nil
}
