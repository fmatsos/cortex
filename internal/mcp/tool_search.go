package mcp

import (
	"context"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type searchArgs struct {
	Query           string  `json:"query"`
	TopK            int     `json:"top_k"`
	MinScore        float64 `json:"min_score"`
	Level           string  `json:"level"`
	SessionID       string  `json:"session_id"`
	IncludeObsolete bool    `json:"include_obsolete"`
}

func (s *Server) handleSearch(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a searchArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid search arguments: %v", err)), nil
	}

	if a.Query == "" {
		return toolError("Query is required"), nil
	}

	if a.TopK <= 0 {
		a.TopK = 5
	}
	if a.MinScore <= 0 {
		a.MinScore = 0.5
	}

	opts := memory.SearchOptions{
		TopK:            a.TopK,
		MinScore:        a.MinScore,
		IncludeObsolete: a.IncludeObsolete,
		SessionID:       a.SessionID,
	}

	if a.Level != "" {
		if !memory.IsValidLevel(a.Level) {
			return toolError(fmt.Sprintf("invalid level: %s", a.Level)), nil
		}
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.Level)}
	}

	results, err := s.service.Search(ctx, a.Query, opts)
	if err != nil {
		return toolError(fmt.Sprintf("Search failed: %v", err)), nil
	}

	jsonBytes, err := pkgjson.MarshalSearchResults(results, false)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal results: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
