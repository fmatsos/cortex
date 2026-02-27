package mcp

import (
	"context"
	"fmt"

	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type getArgs struct {
	ID string `json:"id"`
}

func (s *Server) handleGet(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a getArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid get arguments: %v", err)), nil
	}

	if a.ID == "" {
		return toolError("ID is required"), nil
	}

	mem, err := s.service.Get(ctx, a.ID)
	if err != nil {
		return toolError(fmt.Sprintf("Get failed: %v", err)), nil
	}

	jsonBytes, err := pkgjson.MarshalMemory(mem, false)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal memory: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
