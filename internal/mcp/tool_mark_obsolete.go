package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type markObsoleteArgs struct {
	MemoryID string `json:"memory_id"`
	Reason   string `json:"reason"`
}

func (s *Server) handleMarkObsolete(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a markObsoleteArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid mark obsolete arguments: %v", err)), nil
	}

	if a.MemoryID == "" {
		return toolError("memory_id is required"), nil
	}

	if err := s.service.MarkObsolete(ctx, a.MemoryID); err != nil {
		return toolError(fmt.Sprintf("Failed to mark obsolete: %v", err)), nil
	}

	response := struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		MemoryID string `json:"memory_id"`
		Reason   string `json:"reason,omitempty"`
	}{
		Success:  true,
		Action:   "marked_obsolete",
		MemoryID: a.MemoryID,
		Reason:   a.Reason,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
