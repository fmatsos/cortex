package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type updateMemoryArgs struct {
	MemoryID string   `json:"memory_id"`
	Title    *string  `json:"title"`
	Content  *string  `json:"content"`
	Tags     []string `json:"tags"`
}

func (s *Server) handleUpdateMemory(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a updateMemoryArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid update memory arguments: %v", err)), nil
	}

	if a.MemoryID == "" {
		return toolError("memory_id is required"), nil
	}

	mem, err := s.service.Get(ctx, a.MemoryID)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to get memory: %v", err)), nil
	}

	needsReembed := false

	if a.Title != nil && *a.Title != mem.Title {
		mem.Title = *a.Title
		needsReembed = true
	}
	if a.Content != nil && *a.Content != mem.Content {
		mem.Content = *a.Content
		needsReembed = true
	}
	if a.Tags != nil {
		mem.Tags = a.Tags
		mem.Context.Tags = a.Tags
	}

	if err := mem.Validate(); err != nil {
		return toolError(fmt.Sprintf("Validation failed: %v", err)), nil
	}

	if needsReembed {
		text := fmt.Sprintf("Title: %s\n\nContent: %s", mem.Title, mem.Content)
		embedding, err := s.embedder.Embed(ctx, text)
		if err != nil {
			return toolError(fmt.Sprintf("Failed to generate embedding: %v", err)), nil
		}
		mem.Embedding = embedding
	}

	mem.UpdatedAt = time.Now()

	if err := s.storage.Update(ctx, mem); err != nil {
		return toolError(fmt.Sprintf("Failed to update memory: %v", err)), nil
	}

	response := struct {
		Success    bool               `json:"success"`
		Action     string             `json:"action"`
		ReEmbedded bool               `json:"re_embedded"`
		Memory     pkgjson.MemoryJSON `json:"memory"`
	}{
		Success:    true,
		Action:     "updated",
		ReEmbedded: needsReembed,
		Memory:     pkgjson.ToMemoryJSON(mem),
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
