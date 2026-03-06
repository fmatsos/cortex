package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type consolidateArgs struct {
	Synthesis   string                `json:"synthesis"`
	MemoryLevel string                `json:"memory_level"`
	Context     consolidateContextArg `json:"context"`
	Force       bool                  `json:"force"`
}

type consolidateContextArg struct {
	TaskID          string   `json:"task_id"`
	SessionID       string   `json:"session_id"`
	Timestamp       string   `json:"timestamp"`
	Author          string   `json:"author"`
	Tags            []string `json:"tags"`
	Source          string   `json:"source"`
	RelatedMemories []string `json:"related_memories"`
	GitBranch       string   `json:"git_branch"`
	AgentName       string   `json:"agent_name"`
	AgentSessionID  string   `json:"agent_session_id"`
	UserPrompt      string   `json:"user_prompt"`
}

func (s *Server) handleConsolidate(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a consolidateArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid consolidate arguments: %v", err)), nil
	}

	if a.Synthesis == "" {
		return toolError("synthesis is required"), nil
	}
	if a.MemoryLevel == "" {
		return toolError("memory_level is required"), nil
	}
	if !memory.IsValidLevel(a.MemoryLevel) {
		return toolError("invalid memory_level: must be working|episodic|semantic"), nil
	}
	if memory.MemoryLevel(a.MemoryLevel) == memory.MemoryLevelWorking && a.Context.SessionID == "" {
		return toolError("context.session_id is required"), nil
	}

	if a.Context.Source == "" {
		a.Context.Source = "llm"
	}

	var timestamp time.Time
	if a.Context.Timestamp != "" {
		var err error
		timestamp, err = time.Parse(time.RFC3339, a.Context.Timestamp)
		if err != nil {
			timestamp = time.Now()
		}
	} else {
		timestamp = time.Now()
	}

	input := memory.ConsolidateInput{
		Synthesis: a.Synthesis,
		Level:     memory.MemoryLevel(a.MemoryLevel),
		Context: memory.MemoryContext{
			TaskID:          a.Context.TaskID,
			SessionID:       a.Context.SessionID,
			Timestamp:       timestamp,
			Author:          a.Context.Author,
			Tags:            a.Context.Tags,
			Source:          a.Context.Source,
			RelatedMemories: a.Context.RelatedMemories,
			GitBranch:       a.Context.GitBranch,
			AgentName:       a.Context.AgentName,
			AgentSessionID:  a.Context.AgentSessionID,
			UserPrompt:      a.Context.UserPrompt,
		},
		Force: a.Force,
	}

	result, err := s.consolidationService.Consolidate(ctx, input)
	if err != nil {
		return toolError(fmt.Sprintf("Consolidation failed: %v", err)), nil
	}

	response := struct {
		Success bool                      `json:"success"`
		Result  *memory.ConsolidateResult `json:"result"`
	}{
		Success: true,
		Result:  result,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
