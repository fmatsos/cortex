package mcp

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestNewResponse(t *testing.T) {
	resp := NewResponse(1, "test result")

	if resp.JSONRPC != JSONRPCVersion {
		t.Errorf("JSONRPC = %q, want %q", resp.JSONRPC, JSONRPCVersion)
	}
	if resp.ID != 1 {
		t.Errorf("ID = %v, want %v", resp.ID, 1)
	}
	if resp.Result != "test result" {
		t.Errorf("Result = %v, want %v", resp.Result, "test result")
	}
	if resp.Error != nil {
		t.Errorf("Error should be nil")
	}
}

func TestNewErrorResponse(t *testing.T) {
	resp := NewErrorResponse(2, InvalidParams, "test error", "details")

	if resp.JSONRPC != JSONRPCVersion {
		t.Errorf("JSONRPC = %q, want %q", resp.JSONRPC, JSONRPCVersion)
	}
	if resp.ID != 2 {
		t.Errorf("ID = %v, want %v", resp.ID, 2)
	}
	if resp.Result != nil {
		t.Errorf("Result should be nil")
	}
	if resp.Error == nil {
		t.Fatal("Error should not be nil")
	}
	if resp.Error.Code != InvalidParams {
		t.Errorf("Error.Code = %d, want %d", resp.Error.Code, InvalidParams)
	}
	if resp.Error.Message != "test error" {
		t.Errorf("Error.Message = %q, want %q", resp.Error.Message, "test error")
	}
}

func TestNewTextContent(t *testing.T) {
	content := NewTextContent("hello world")

	if content.Type != "text" {
		t.Errorf("Type = %q, want %q", content.Type, "text")
	}
	if content.Text != "hello world" {
		t.Errorf("Text = %q, want %q", content.Text, "hello world")
	}
}

func TestServerInitialize(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
`
	reader := strings.NewReader(input)
	var output bytes.Buffer

	server := NewServer(reader, &output)

	// Read and handle one message
	line, err := server.reader.ReadString('\n')
	if err != nil {
		t.Fatalf("Failed to read: %v", err)
	}

	var req Request
	if err := json.Unmarshal([]byte(line), &req); err != nil {
		t.Fatalf("Failed to parse request: %v", err)
	}

	resp := server.handleRequest(&req)
	if resp == nil {
		t.Fatal("Response should not be nil")
	}

	if resp.Error != nil {
		t.Errorf("Unexpected error: %v", resp.Error)
	}

	result, ok := resp.Result.(InitializeResult)
	if !ok {
		t.Fatal("Result should be InitializeResult")
	}

	if result.ProtocolVersion != MCPVersion {
		t.Errorf("ProtocolVersion = %q, want %q", result.ProtocolVersion, MCPVersion)
	}
	if result.ServerInfo.Name != ServerName {
		t.Errorf("ServerInfo.Name = %q, want %q", result.ServerInfo.Name, ServerName)
	}
}

func TestServerListTools(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":2,"method":"tools/list"}
`
	reader := strings.NewReader(input)
	var output bytes.Buffer

	server := NewServer(reader, &output)

	line, _ := server.reader.ReadString('\n')
	var req Request
	json.Unmarshal([]byte(line), &req)

	resp := server.handleRequest(&req)
	if resp == nil {
		t.Fatal("Response should not be nil")
	}

	if resp.Error != nil {
		t.Errorf("Unexpected error: %v", resp.Error)
	}

	result, ok := resp.Result.(ListToolsResult)
	if !ok {
		t.Fatal("Result should be ListToolsResult")
	}

	// Should have 4 tools
	if len(result.Tools) != 4 {
		t.Errorf("Tools count = %d, want 4", len(result.Tools))
	}

	// Verify tool names
	expectedTools := map[string]bool{
		"cortex_search": false,
		"cortex_create": false,
		"cortex_list":   false,
		"cortex_get":    false,
	}

	for _, tool := range result.Tools {
		if _, ok := expectedTools[tool.Name]; ok {
			expectedTools[tool.Name] = true
		}
	}

	for name, found := range expectedTools {
		if !found {
			t.Errorf("Missing tool: %s", name)
		}
	}
}

func TestServerUnknownMethod(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":3,"method":"unknown/method"}
`
	reader := strings.NewReader(input)
	var output bytes.Buffer

	server := NewServer(reader, &output)

	line, _ := server.reader.ReadString('\n')
	var req Request
	json.Unmarshal([]byte(line), &req)

	resp := server.handleRequest(&req)
	if resp == nil {
		t.Fatal("Response should not be nil")
	}

	if resp.Error == nil {
		t.Fatal("Error should not be nil for unknown method")
	}

	if resp.Error.Code != MethodNotFound {
		t.Errorf("Error.Code = %d, want %d", resp.Error.Code, MethodNotFound)
	}
}

func TestToolInputSchemas(t *testing.T) {
	var output bytes.Buffer
	server := NewServer(strings.NewReader(""), &output)

	resp := server.handleListTools(&Request{ID: 1, Method: "tools/list"})
	result := resp.Result.(ListToolsResult)

	for _, tool := range result.Tools {
		// Verify all tools have proper schema
		if tool.InputSchema.Type != "object" {
			t.Errorf("Tool %s: InputSchema.Type = %q, want %q", tool.Name, tool.InputSchema.Type, "object")
		}

		// Verify required tools have required fields
		switch tool.Name {
		case "cortex_search":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "query" {
				t.Errorf("cortex_search should require 'query'")
			}
		case "cortex_create":
			if len(tool.InputSchema.Required) != 3 {
				t.Errorf("cortex_create should require title, content, type")
			}
		case "cortex_get":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "id" {
				t.Errorf("cortex_get should require 'id'")
			}
		}
	}
}

func TestJSONRPCMarshal(t *testing.T) {
	resp := NewResponse(1, InitializeResult{
		ProtocolVersion: MCPVersion,
		ServerInfo: ServerInfo{
			Name:    ServerName,
			Version: ServerVersion,
		},
	})

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// Verify it can be unmarshaled
	var parsed Response
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if parsed.JSONRPC != JSONRPCVersion {
		t.Errorf("JSONRPC = %q, want %q", parsed.JSONRPC, JSONRPCVersion)
	}
}
