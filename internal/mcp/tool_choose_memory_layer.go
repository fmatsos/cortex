package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type chooseMemoryLayerArgs struct {
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags"`
	SessionID string   `json:"session_id"`
}

func (s *Server) handleChooseMemoryLayer(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a chooseMemoryLayerArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid choose memory layer arguments: %v", err)), nil
	}

	if strings.TrimSpace(a.Content) == "" {
		return toolError("content is required"), nil
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.ChooseMemoryLayer)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.ChooseMemoryLayer
	}

	payload := struct {
		Title     string   `json:"title,omitempty"`
		Content   string   `json:"content"`
		Tags      []string `json:"tags,omitempty"`
		SessionID string   `json:"session_id,omitempty"`
	}{
		Title:     a.Title,
		Content:   a.Content,
		Tags:      a.Tags,
		SessionID: a.SessionID,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	finalPrompt := fmt.Sprintf("%s\n\nMemory to classify:\n%s", prompt, string(jsonBytes))
	return toolResult(finalPrompt), nil
}
