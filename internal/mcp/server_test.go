package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cortex-ai/cortex-ai/internal/memory"
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
	req := &Request{
		JSONRPC: JSONRPCVersion,
		ID:      1,
		Method:  "initialize",
	}

	server := NewServerWithStdio(strings.NewReader(""), &bytes.Buffer{})
	resp := server.handleRequest(req)

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
	req := &Request{
		JSONRPC: JSONRPCVersion,
		ID:      2,
		Method:  "tools/list",
	}

	server := NewServerWithStdio(strings.NewReader(""), &bytes.Buffer{})
	resp := server.handleRequest(req)

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

	// Should have 13 tools
	if len(result.Tools) != 13 {
		t.Errorf("Tools count = %d, want 13", len(result.Tools))
	}

	// Verify tool names
	expectedTools := map[string]bool{
		"cortex_search":                         false,
		"cortex_create":                         false,
		"cortex_list":                           false,
		"cortex_get":                            false,
		"cortex_consolidate":                    false,
		"cortex_choose_memory_layer":            false,
		"cortex_choose_working_consolidation":   false,
		"cortex_promote_memory":                 false,
		"cortex_update_memory":                  false,
		"cortex_mark_obsolete":                  false,
		"cortex_review_session":                 false,
		"cortex_think_about_memory_maintenance": false,
		"cortex_think_about_task_completion":    false,
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
	req := &Request{
		JSONRPC: JSONRPCVersion,
		ID:      3,
		Method:  "unknown/method",
	}

	server := NewServerWithStdio(strings.NewReader(""), &bytes.Buffer{})
	resp := server.handleRequest(req)

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
	server := NewServerWithStdio(strings.NewReader(""), &bytes.Buffer{})
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
				t.Errorf("cortex_create should require title, content, level")
			}
		case "cortex_get":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "id" {
				t.Errorf("cortex_get should require 'id'")
			}
		case "cortex_promote_memory":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "memory_id" {
				t.Errorf("cortex_promote_memory should require 'memory_id'")
			}
		case "cortex_update_memory":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "memory_id" {
				t.Errorf("cortex_update_memory should require 'memory_id'")
			}
		case "cortex_mark_obsolete":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "memory_id" {
				t.Errorf("cortex_mark_obsolete should require 'memory_id'")
			}
		case "cortex_review_session":
			if len(tool.InputSchema.Required) != 1 || tool.InputSchema.Required[0] != "session_id" {
				t.Errorf("cortex_review_session should require 'session_id'")
			}
		case "cortex_think_about_task_completion":
			if len(tool.InputSchema.Required) != 2 {
				t.Errorf("cortex_think_about_task_completion should require task_description and outcome")
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

func TestStdioTransportReceive(t *testing.T) {
	input := `{"jsonrpc":"2.0","id":1,"method":"initialize"}
`
	transport := NewStdioTransport(strings.NewReader(input), &bytes.Buffer{})

	ctx := context.Background()
	req, err := transport.Receive(ctx)
	if err != nil {
		t.Fatalf("Receive failed: %v", err)
	}

	if req.Method != "initialize" {
		t.Errorf("Method = %q, want %q", req.Method, "initialize")
	}
	if req.ID != float64(1) {
		t.Errorf("ID = %v, want %v", req.ID, 1)
	}
}

func TestStdioTransportSend(t *testing.T) {
	var output bytes.Buffer
	transport := NewStdioTransport(strings.NewReader(""), &output)

	ctx := context.Background()
	resp := NewResponse(1, "test result")

	err := transport.Send(ctx, resp)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	// Verify output contains JSON
	outStr := output.String()
	if !strings.Contains(outStr, `"jsonrpc":"2.0"`) {
		t.Errorf("Output should contain jsonrpc version")
	}
	if !strings.Contains(outStr, `"result":"test result"`) {
		t.Errorf("Output should contain result")
	}
}

func TestTransportTypes(t *testing.T) {
	if !IsValidTransport(TransportStdio) {
		t.Error("stdio should be a valid transport")
	}
	if !IsValidTransport(TransportSSE) {
		t.Error("sse should be a valid transport")
	}
	if IsValidTransport(TransportType("invalid")) {
		t.Error("invalid should not be a valid transport")
	}
}

func TestValidTransports(t *testing.T) {
	transports := ValidTransports()
	if len(transports) != 2 {
		t.Errorf("Expected 2 transports, got %d", len(transports))
	}

	found := make(map[TransportType]bool)
	for _, tr := range transports {
		found[tr] = true
	}

	if !found[TransportStdio] {
		t.Error("stdio should be in valid transports")
	}
	if !found[TransportSSE] {
		t.Error("sse should be in valid transports")
	}
}

// mockEmbedder implements memory.Embedder for testing
type mockEmbedder struct {
	dim int
}

func (m *mockEmbedder) Embed(_ context.Context, _ string) ([]float64, error) {
	vec := make([]float64, m.dim)
	for i := range vec {
		vec[i] = 0.1
	}
	return vec, nil
}

func (m *mockEmbedder) EmbedBatch(_ context.Context, texts []string) ([][]float64, error) {
	results := make([][]float64, len(texts))
	for i := range texts {
		vec := make([]float64, m.dim)
		for j := range vec {
			vec[j] = 0.1
		}
		results[i] = vec
	}
	return results, nil
}

func (m *mockEmbedder) Dimension() int {
	return m.dim
}

// newTestServer creates a server with real storage for integration tests
func newTestServer(t *testing.T) *Server {
	t.Helper()
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "memories.gob")

	server := NewServerWithStdio(strings.NewReader(""), &bytes.Buffer{})
	embedder := &mockEmbedder{dim: 8}
	if err := server.Initialize(storagePath, embedder); err != nil {
		t.Fatalf("Failed to initialize server: %v", err)
	}
	return server
}

// createTestMemory creates a memory via the server for testing
func createTestMemory(t *testing.T, server *Server, level, sessionID string) string {
	t.Helper()
	args := map[string]interface{}{
		"title":   "Test Memory Title",
		"content": "This is test memory content with enough length.",
		"level":   level,
	}
	if sessionID != "" {
		args["session_id"] = sessionID
	}
	argsJSON, _ := json.Marshal(args)

	resp := server.handleCreate(context.Background(), 1, argsJSON)
	result, ok := resp.Result.(CallToolResult)
	if !ok || result.IsError {
		t.Fatalf("Failed to create test memory: %v", resp)
	}

	// Extract memory ID from response
	var createResp struct {
		Memory struct {
			ID string `json:"id"`
		} `json:"memory"`
	}
	if err := json.Unmarshal([]byte(result.Content[0].Text), &createResp); err != nil {
		t.Fatalf("Failed to parse create response: %v", err)
	}
	return createResp.Memory.ID
}

func TestHandlePromoteMemory_EpisodicToSemantic(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	args, _ := json.Marshal(map[string]interface{}{
		"memory_id":     memID,
		"revised_title": "Promoted Title",
		"tags":          []string{"promoted"},
	})

	resp := server.handlePromoteMemory(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	var promoteResp struct {
		Success   bool   `json:"success"`
		Action    string `json:"action"`
		FromLevel string `json:"from_level"`
		ToLevel   string `json:"to_level"`
		SourceID  string `json:"source_id"`
	}
	if err := json.Unmarshal([]byte(result.Content[0].Text), &promoteResp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if !promoteResp.Success {
		t.Error("Expected success=true")
	}
	if promoteResp.Action != "promoted" {
		t.Errorf("Action = %q, want %q", promoteResp.Action, "promoted")
	}
	if promoteResp.FromLevel != "episodic" {
		t.Errorf("FromLevel = %q, want %q", promoteResp.FromLevel, "episodic")
	}
	if promoteResp.ToLevel != "semantic" {
		t.Errorf("ToLevel = %q, want %q", promoteResp.ToLevel, "semantic")
	}
	if promoteResp.SourceID != memID {
		t.Errorf("SourceID = %q, want %q", promoteResp.SourceID, memID)
	}
}

func TestHandlePromoteMemory_SemanticFails(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "semantic", "")

	args, _ := json.Marshal(map[string]interface{}{
		"memory_id": memID,
	})

	resp := server.handlePromoteMemory(context.Background(), 1, args)
	result := resp.Result.(CallToolResult)
	if !result.IsError {
		t.Error("Promoting semantic memory should fail")
	}
	if !strings.Contains(result.Content[0].Text, "cannot be promoted") {
		t.Errorf("Error should mention cannot be promoted, got: %s", result.Content[0].Text)
	}
}

func TestHandlePromoteMemory_MissingID(t *testing.T) {
	server := newTestServer(t)
	args, _ := json.Marshal(map[string]interface{}{})

	resp := server.handlePromoteMemory(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleUpdateMemory(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	newTitle := "Updated Title"
	newContent := "Updated content with enough length for validation."
	args, _ := json.Marshal(map[string]interface{}{
		"memory_id": memID,
		"title":     newTitle,
		"content":   newContent,
		"tags":      []string{"updated", "test"},
	})

	resp := server.handleUpdateMemory(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	var updateResp struct {
		Success    bool   `json:"success"`
		Action     string `json:"action"`
		ReEmbedded bool   `json:"re_embedded"`
		Memory     struct {
			Title   string   `json:"title"`
			Content string   `json:"content"`
			Tags    []string `json:"tags"`
		} `json:"memory"`
	}
	if err := json.Unmarshal([]byte(result.Content[0].Text), &updateResp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if !updateResp.Success {
		t.Error("Expected success=true")
	}
	if updateResp.Action != "updated" {
		t.Errorf("Action = %q, want %q", updateResp.Action, "updated")
	}
	if !updateResp.ReEmbedded {
		t.Error("Expected re_embedded=true when content changed")
	}
	if updateResp.Memory.Title != newTitle {
		t.Errorf("Title = %q, want %q", updateResp.Memory.Title, newTitle)
	}
	if updateResp.Memory.Content != newContent {
		t.Errorf("Content = %q, want %q", updateResp.Memory.Content, newContent)
	}
}

func TestHandleUpdateMemory_MissingID(t *testing.T) {
	server := newTestServer(t)
	args, _ := json.Marshal(map[string]interface{}{})

	resp := server.handleUpdateMemory(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleMarkObsolete(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	args, _ := json.Marshal(map[string]interface{}{
		"memory_id": memID,
		"reason":    "outdated information",
	})

	resp := server.handleMarkObsolete(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	var obsoleteResp struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		MemoryID string `json:"memory_id"`
		Reason   string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(result.Content[0].Text), &obsoleteResp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if !obsoleteResp.Success {
		t.Error("Expected success=true")
	}
	if obsoleteResp.Action != "marked_obsolete" {
		t.Errorf("Action = %q, want %q", obsoleteResp.Action, "marked_obsolete")
	}
	if obsoleteResp.MemoryID != memID {
		t.Errorf("MemoryID = %q, want %q", obsoleteResp.MemoryID, memID)
	}

	// Verify memory is actually obsolete
	getArgs, _ := json.Marshal(map[string]interface{}{"id": memID})
	getResp := server.handleGet(context.Background(), 2, getArgs)
	getResult := getResp.Result.(CallToolResult)
	if strings.Contains(getResult.Content[0].Text, `"obsolete":true`) == false {
		// Check the actual memory via service
		mem, err := server.service.Get(context.Background(), memID)
		if err != nil {
			t.Fatalf("Failed to get memory: %v", err)
		}
		if !mem.Obsolete {
			t.Error("Memory should be marked obsolete")
		}
	}
}

func TestHandleMarkObsolete_MissingID(t *testing.T) {
	server := newTestServer(t)
	args, _ := json.Marshal(map[string]interface{}{})

	resp := server.handleMarkObsolete(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleReviewSession_WithMemories(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "working", "test-session-1")
	_ = createTestMemory(t, server, "working", "test-session-1")

	args, _ := json.Marshal(map[string]interface{}{
		"session_id":   "test-session-1",
		"task_summary": "Completed unit testing",
	})

	resp := server.handleReviewSession(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	text := result.Content[0].Text
	// Should contain the prompt and session data
	if !strings.Contains(text, "reviewing working memories") {
		t.Error("Response should contain review prompt")
	}
	if !strings.Contains(text, "test-session-1") {
		t.Error("Response should contain session ID")
	}
	if !strings.Contains(text, "memory_count") {
		t.Error("Response should contain memory count")
	}
}

func TestHandleReviewSession_NoMemories(t *testing.T) {
	server := newTestServer(t)

	args, _ := json.Marshal(map[string]interface{}{
		"session_id": "nonexistent-session",
	})

	resp := server.handleReviewSession(context.Background(), 1, args)
	result := resp.Result.(CallToolResult)
	if result.IsError {
		t.Error("Should not be an error, just empty result")
	}
	if !strings.Contains(result.Content[0].Text, "No working memories found") {
		t.Error("Should indicate no memories found")
	}
}

func TestHandleReviewSession_MissingSessionID(t *testing.T) {
	server := newTestServer(t)
	args, _ := json.Marshal(map[string]interface{}{})

	resp := server.handleReviewSession(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing session_id")
	}
}

func TestHandleThinkMemoryMaintenance(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "episodic", "")
	_ = createTestMemory(t, server, "semantic", "")

	args, _ := json.Marshal(map[string]interface{}{})

	resp := server.handleThinkMemoryMaintenance(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	text := result.Content[0].Text
	if !strings.Contains(text, "maintenance") {
		t.Error("Response should contain maintenance prompt")
	}
	if !strings.Contains(text, "stats") {
		t.Error("Response should contain statistics")
	}
	if !strings.Contains(text, "memories") {
		t.Error("Response should contain memories data")
	}
}

func TestHandleThinkMemoryMaintenance_FocusLevel(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "episodic", "")
	_ = createTestMemory(t, server, "semantic", "")

	args, _ := json.Marshal(map[string]interface{}{
		"focus_level": "episodic",
	})

	resp := server.handleThinkMemoryMaintenance(context.Background(), 1, args)
	result := resp.Result.(CallToolResult)
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	text := result.Content[0].Text
	if !strings.Contains(text, "episodic") {
		t.Error("Response should reference episodic level")
	}
}

func TestHandleThinkMemoryMaintenance_InvalidLevel(t *testing.T) {
	server := newTestServer(t)
	args, _ := json.Marshal(map[string]interface{}{
		"focus_level": "invalid",
	})

	resp := server.handleThinkMemoryMaintenance(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for invalid focus_level")
	}
}

func TestHandleThinkTaskCompletion(t *testing.T) {
	server := newTestServer(t)

	args, _ := json.Marshal(map[string]interface{}{
		"task_description": "Implemented workflow tools for MCP server",
		"outcome":          "Successfully added 6 new tools",
		"session_id":       "test-session",
	})

	resp := server.handleThinkTaskCompletion(context.Background(), 1, args)
	result, ok := resp.Result.(CallToolResult)
	if !ok {
		t.Fatal("Result should be CallToolResult")
	}
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	text := result.Content[0].Text
	if !strings.Contains(text, "completed a task") {
		t.Error("Response should contain task completion prompt")
	}
	if !strings.Contains(text, "Implemented workflow tools") {
		t.Error("Response should contain task description")
	}
	if !strings.Contains(text, "Successfully added") {
		t.Error("Response should contain outcome")
	}
}

func TestHandleThinkTaskCompletion_WithRelatedMemories(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	args, _ := json.Marshal(map[string]interface{}{
		"task_description":   "Fixed a bug",
		"outcome":            "Bug resolved",
		"related_memory_ids": []string{memID},
	})

	resp := server.handleThinkTaskCompletion(context.Background(), 1, args)
	result := resp.Result.(CallToolResult)
	if result.IsError {
		t.Fatalf("Unexpected error: %s", result.Content[0].Text)
	}

	text := result.Content[0].Text
	if !strings.Contains(text, "related_memories") {
		t.Error("Response should contain related memories")
	}
}

func TestHandleThinkTaskCompletion_MissingRequired(t *testing.T) {
	server := newTestServer(t)

	// Missing outcome
	args, _ := json.Marshal(map[string]interface{}{
		"task_description": "Something",
	})
	resp := server.handleThinkTaskCompletion(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing outcome")
	}

	// Missing task_description
	args, _ = json.Marshal(map[string]interface{}{
		"outcome": "Something",
	})
	resp = server.handleThinkTaskCompletion(context.Background(), 1, args)
	if resp.Error == nil {
		t.Error("Expected error for missing task_description")
	}
}

func TestWorkflowToolDispatch(t *testing.T) {
	server := newTestServer(t)

	// Verify all new tools are reachable via handleCallTool
	tools := []struct {
		name      string
		args      map[string]interface{}
		expectErr bool
	}{
		{"cortex_promote_memory", map[string]interface{}{}, true},
		{"cortex_update_memory", map[string]interface{}{}, true},
		{"cortex_mark_obsolete", map[string]interface{}{}, true},
		{"cortex_review_session", map[string]interface{}{}, true},
		{"cortex_think_about_memory_maintenance", map[string]interface{}{}, false},
		{"cortex_think_about_task_completion", map[string]interface{}{}, true},
	}

	for _, tc := range tools {
		t.Run(tc.name, func(t *testing.T) {
			argsJSON, _ := json.Marshal(tc.args)
			params, _ := json.Marshal(CallToolParams{Name: tc.name, Arguments: argsJSON})
			req := &Request{
				JSONRPC: JSONRPCVersion,
				ID:      1,
				Method:  "tools/call",
				Params:  params,
			}

			resp := server.handleRequest(req)
			if resp == nil {
				t.Fatal("Response should not be nil")
			}

			if tc.expectErr {
				// Should get an error (missing required params) but not MethodNotFound
				if resp.Error != nil && resp.Error.Code == MethodNotFound {
					t.Errorf("Tool %s should be routed, not MethodNotFound", tc.name)
				}
			}
		})
	}
}

// Suppress unused import warning
var _ = os.Getenv
var _ memory.MemoryLevel
