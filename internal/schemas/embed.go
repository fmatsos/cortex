// Package schemas provides embedded JSON schemas for MCP tools and CLI output.
package schemas

import (
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed mcp/*.json cli/*.json
var FS embed.FS

// MCPToolSchema represents an MCP tool schema loaded from JSON.
type MCPToolSchema struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema InputSchema `json:"inputSchema"`
}

// InputSchema represents the input schema for an MCP tool.
type InputSchema struct {
	Type       string              `json:"type"`
	Properties map[string]Property `json:"properties,omitempty"`
	Required   []string            `json:"required,omitempty"`
}

// Property represents a property in an input schema.
type Property struct {
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
	Enum        []string `json:"enum,omitempty"`
	Items       *Items   `json:"items,omitempty"`
	Default     any      `json:"default,omitempty"`
}

// Items represents array item schema.
type Items struct {
	Type string `json:"type"`
}

// LoadMCPToolSchema loads an MCP tool schema by name.
func LoadMCPToolSchema(name string) (*MCPToolSchema, error) {
	data, err := FS.ReadFile(fmt.Sprintf("mcp/%s.json", name))
	if err != nil {
		return nil, fmt.Errorf("failed to read schema %s: %w", name, err)
	}

	var schema MCPToolSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, fmt.Errorf("failed to parse schema %s: %w", name, err)
	}

	return &schema, nil
}

// MustLoadMCPToolSchema loads an MCP tool schema or panics.
func MustLoadMCPToolSchema(name string) *MCPToolSchema {
	schema, err := LoadMCPToolSchema(name)
	if err != nil {
		panic(err)
	}
	return schema
}

// LoadCLIOutputSchema loads a CLI output schema by name.
func LoadCLIOutputSchema(name string) ([]byte, error) {
	data, err := FS.ReadFile(fmt.Sprintf("cli/%s.json", name))
	if err != nil {
		return nil, fmt.Errorf("failed to read schema %s: %w", name, err)
	}
	return data, nil
}

// MCPToolNames returns the list of available MCP tool names.
var MCPToolNames = []string{
	"cortex_search",
	"cortex_create",
	"cortex_list",
	"cortex_get",
}
