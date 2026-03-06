package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type createArgs struct {
	Title          string   `json:"title"`
	Content        string   `json:"content"`
	Level          string   `json:"level"`
	Tags           []string `json:"tags"`
	SessionID      string   `json:"session_id"`
	Source         string   `json:"source"`
	TaskID         string   `json:"task_id"`
	Author         string   `json:"author"`
	GitBranch      string   `json:"git_branch"`
	AgentName      string   `json:"agent_name"`
	AgentSessionID string   `json:"agent_session_id"`
	UserPrompt     string   `json:"user_prompt"`
}

func (s *Server) handleCreate(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a createArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid create arguments: %v", err)), nil
	}

	if a.Title == "" || a.Content == "" || a.Level == "" {
		return toolError("title, content, and level are required"), nil
	}
	if !memory.IsValidLevel(a.Level) {
		return toolError(fmt.Sprintf("invalid level: %s", a.Level)), nil
	}
	if memory.MemoryLevel(a.Level) == memory.MemoryLevelWorking && a.SessionID == "" {
		return toolError("session_id is required for working level"), nil
	}

	input := memory.CreateInput{
		Title:          a.Title,
		Content:        a.Content,
		Level:          memory.MemoryLevel(a.Level),
		Tags:           a.Tags,
		SessionID:      a.SessionID,
		Source:         a.Source,
		TaskID:         a.TaskID,
		Author:         a.Author,
		GitBranch:      a.GitBranch,
		AgentName:      a.AgentName,
		AgentSessionID: a.AgentSessionID,
		UserPrompt:     a.UserPrompt,
	}

	mem, err := s.service.Create(ctx, input)
	if err != nil {
		return toolError(fmt.Sprintf("Create failed: %v", err)), nil
	}

	response := struct {
		Success bool               `json:"success"`
		Memory  pkgjson.MemoryJSON `json:"memory"`
	}{
		Success: true,
		Memory:  pkgjson.ToMemoryJSON(mem),
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
