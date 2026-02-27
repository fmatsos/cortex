package mcp

import (
	"context"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type listArgs struct {
	Level           string `json:"level"`
	IncludeObsolete bool   `json:"include_obsolete"`
	Limit           int    `json:"limit"`
	Offset          int    `json:"offset"`
}

func (s *Server) handleList(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a listArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid list arguments: %v", err)), nil
	}

	opts := memory.ListOptions{
		IncludeObsolete: a.IncludeObsolete,
		Limit:           a.Limit,
	}

	if a.Level != "" {
		if !memory.IsValidLevel(a.Level) {
			return toolError(fmt.Sprintf("invalid level: %s", a.Level)), nil
		}
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.Level)}
	}

	memories, err := s.service.List(ctx, opts)
	if err != nil {
		return toolError(fmt.Sprintf("List failed: %v", err)), nil
	}

	if a.Offset > 0 {
		if a.Offset >= len(memories) {
			memories = nil
		} else {
			memories = memories[a.Offset:]
		}
		if a.Limit > 0 && len(memories) > a.Limit {
			memories = memories[:a.Limit]
		}
	}

	jsonBytes, err := pkgjson.MarshalMemories(memories, false)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal memories: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
