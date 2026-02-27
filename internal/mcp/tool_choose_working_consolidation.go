package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type workingMemoryCandidate struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"created_at,omitempty"`
	SessionID string   `json:"session_id,omitempty"`
}

type chooseWorkingConsolidationArgs struct {
	WorkingMemories []workingMemoryCandidate `json:"working_memories"`
	SelectionGoal   string                   `json:"selection_goal"`
}

func (s *Server) handleChooseWorkingConsolidation(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a chooseWorkingConsolidationArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid choose working consolidation arguments: %v", err)), nil
	}

	if len(a.WorkingMemories) == 0 {
		return toolError("working_memories is required"), nil
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.ChooseWorkingConsolidation)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.ChooseWorkingConsolidation
	}

	payload := struct {
		SelectionGoal   string                   `json:"selection_goal,omitempty"`
		WorkingMemories []workingMemoryCandidate `json:"working_memories"`
	}{
		SelectionGoal:   a.SelectionGoal,
		WorkingMemories: a.WorkingMemories,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	finalPrompt := fmt.Sprintf("%s\n\nWorking memories to review:\n%s", prompt, string(jsonBytes))
	return toolResult(finalPrompt), nil
}
