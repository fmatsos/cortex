package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

type promoteMemoryArgs struct {
	MemoryID       string   `json:"memory_id"`
	RevisedContent string   `json:"revised_content"`
	RevisedTitle   string   `json:"revised_title"`
	Tags           []string `json:"tags"`
}

func (s *Server) handlePromoteMemory(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	var a promoteMemoryArgs
	if err := bindArgs(req, &a); err != nil {
		return toolError(fmt.Sprintf("Invalid promote memory arguments: %v", err)), nil
	}

	if a.MemoryID == "" {
		return toolError("memory_id is required"), nil
	}

	mem, err := s.service.Get(ctx, a.MemoryID)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to get memory: %v", err)), nil
	}

	var targetLevel memory.MemoryLevel
	switch mem.Level {
	case memory.MemoryLevelWorking:
		targetLevel = memory.MemoryLevelEpisodic
	case memory.MemoryLevelEpisodic:
		targetLevel = memory.MemoryLevelSemantic
	case memory.MemoryLevelSemantic:
		return toolError("semantic memories cannot be promoted further"), nil
	default:
		return toolError(fmt.Sprintf("unknown memory level: %s", mem.Level)), nil
	}

	content := mem.Content
	if a.RevisedContent != "" {
		content = a.RevisedContent
	}
	title := mem.Title
	if a.RevisedTitle != "" {
		title = a.RevisedTitle
	}
	tags := mem.Tags
	if len(a.Tags) > 0 {
		tags = a.Tags
	}

	text := fmt.Sprintf("Title: %s\n\nContent: %s", title, content)
	embedding, err := s.embedder.Embed(ctx, text)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to generate embedding: %v", err)), nil
	}

	now := time.Now()
	promoted := &memory.Memory{
		ID:         generateID(),
		Level:      targetLevel,
		Title:      title,
		Content:    content,
		Tags:       tags,
		Embedding:  embedding,
		Context:    mem.Context,
		CreatedAt:  now,
		UpdatedAt:  now,
		MergedFrom: []string{a.MemoryID},
		Obsolete:   false,
	}
	promoted.Context.Source = "llm"

	if err := promoted.Validate(); err != nil {
		return toolError(fmt.Sprintf("Validation failed: %v", err)), nil
	}

	if err := s.storage.Save(ctx, promoted); err != nil {
		return toolError(fmt.Sprintf("Failed to save promoted memory: %v", err)), nil
	}

	response := struct {
		Success   bool               `json:"success"`
		Action    string             `json:"action"`
		FromLevel string             `json:"from_level"`
		ToLevel   string             `json:"to_level"`
		SourceID  string             `json:"source_id"`
		Memory    pkgjson.MemoryJSON `json:"memory"`
	}{
		Success:   true,
		Action:    "promoted",
		FromLevel: string(mem.Level),
		ToLevel:   string(targetLevel),
		SourceID:  a.MemoryID,
		Memory:    pkgjson.ToMemoryJSON(promoted),
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return toolError(fmt.Sprintf("Failed to marshal response: %v", err)), nil
	}

	return toolResult(string(jsonBytes)), nil
}
