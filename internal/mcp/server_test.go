package mcp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

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

// makeReq builds a CallToolRequest with the given arguments.
func makeReq(args map[string]interface{}) mcpgo.CallToolRequest {
	var req mcpgo.CallToolRequest
	req.Params.Arguments = args
	return req
}

// resultText extracts the text from the first content entry of a CallToolResult.
func resultText(t *testing.T, result *mcpgo.CallToolResult) string {
	t.Helper()
	if result == nil {
		t.Fatal("result is nil")
	}
	if len(result.Content) == 0 {
		t.Fatal("no content in result")
	}
	tc, ok := result.Content[0].(mcpgo.TextContent)
	if !ok {
		t.Fatalf("content is not TextContent: %T", result.Content[0])
	}
	return tc.Text
}

// newTestServer creates a server with real storage for integration tests
func newTestServer(t *testing.T) *Server {
	t.Helper()
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "memories.gob")

	server := NewServer()
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

	result, err := server.handleCreate(context.Background(), makeReq(args))
	if err != nil {
		t.Fatalf("handleCreate returned error: %v", err)
	}
	if result.IsError {
		t.Fatalf("Failed to create test memory: %s", resultText(t, result))
	}

	var createResp struct {
		Memory struct {
			ID string `json:"id"`
		} `json:"memory"`
	}
	if err := json.Unmarshal([]byte(resultText(t, result)), &createResp); err != nil {
		t.Fatalf("Failed to parse create response: %v", err)
	}
	return createResp.Memory.ID
}

func TestNewServer(t *testing.T) {
	server := NewServer()
	if server == nil {
		t.Fatal("NewServer returned nil")
	}
	if server.MCPServer() == nil {
		t.Fatal("MCPServer() returned nil")
	}
}

func TestServerInitialize(t *testing.T) {
	server := newTestServer(t)
	if server.service == nil {
		t.Error("service should be initialized")
	}
	if server.storage == nil {
		t.Error("storage should be initialized")
	}
	if server.embedder == nil {
		t.Error("embedder should be initialized")
	}
}

func TestServerInitialize_NilEmbedder(t *testing.T) {
	server := NewServer()
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "memories.gob")
	if err := server.Initialize(storagePath, nil); err == nil {
		t.Error("Initialize with nil embedder should fail")
	}
}

func TestHandleSearch_MissingQuery(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleSearch(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for missing query")
	}
}

func TestHandleSearch(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "episodic", "")

	result, err := server.handleSearch(context.Background(), makeReq(map[string]interface{}{
		"query": "test memory",
		"top_k": 5,
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}
}

func TestHandleCreate_MissingRequired(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleCreate(context.Background(), makeReq(map[string]interface{}{
		"title": "test",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for missing required fields")
	}
}

func TestHandleList(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "episodic", "")

	result, err := server.handleList(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}
	text := resultText(t, result)
	if !strings.Contains(text, "Test Memory Title") {
		t.Error("list should contain created memory")
	}
}

func TestHandleGet_MissingID(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleGet(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for missing ID")
	}
}

func TestHandleGet(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	result, err := server.handleGet(context.Background(), makeReq(map[string]interface{}{
		"id": memID,
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}
	text := resultText(t, result)
	if !strings.Contains(text, memID) {
		t.Error("response should contain the memory ID")
	}
}

func TestHandlePromoteMemory_EpisodicToSemantic(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	result, err := server.handlePromoteMemory(context.Background(), makeReq(map[string]interface{}{
		"memory_id":     memID,
		"revised_title": "Promoted Title",
		"tags":          []string{"promoted"},
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	var promoteResp struct {
		Success   bool   `json:"success"`
		Action    string `json:"action"`
		FromLevel string `json:"from_level"`
		ToLevel   string `json:"to_level"`
		SourceID  string `json:"source_id"`
	}
	if err := json.Unmarshal([]byte(resultText(t, result)), &promoteResp); err != nil {
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

	result, err := server.handlePromoteMemory(context.Background(), makeReq(map[string]interface{}{
		"memory_id": memID,
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Promoting semantic memory should fail")
	}
	if !strings.Contains(resultText(t, result), "cannot be promoted") {
		t.Errorf("Error should mention cannot be promoted, got: %s", resultText(t, result))
	}
}

func TestHandlePromoteMemory_MissingID(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handlePromoteMemory(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleUpdateMemory(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	newTitle := "Updated Title"
	newContent := "Updated content with enough length for validation."
	result, err := server.handleUpdateMemory(context.Background(), makeReq(map[string]interface{}{
		"memory_id": memID,
		"title":     newTitle,
		"content":   newContent,
		"tags":      []string{"updated", "test"},
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
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
	if err := json.Unmarshal([]byte(resultText(t, result)), &updateResp); err != nil {
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
	result, err := server.handleUpdateMemory(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleMarkObsolete(t *testing.T) {
	server := newTestServer(t)
	memID := createTestMemory(t, server, "episodic", "")

	result, err := server.handleMarkObsolete(context.Background(), makeReq(map[string]interface{}{
		"memory_id": memID,
		"reason":    "outdated information",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	var obsoleteResp struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		MemoryID string `json:"memory_id"`
		Reason   string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(resultText(t, result)), &obsoleteResp); err != nil {
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
	mem, memErr := server.service.Get(context.Background(), memID)
	if memErr != nil {
		t.Fatalf("Failed to get memory: %v", memErr)
	}
	if !mem.Obsolete {
		t.Error("Memory should be marked obsolete")
	}
}

func TestHandleMarkObsolete_MissingID(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleMarkObsolete(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing memory_id")
	}
}

func TestHandleReviewSession_WithMemories(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "working", "test-session-1")
	_ = createTestMemory(t, server, "working", "test-session-1")

	result, err := server.handleReviewSession(context.Background(), makeReq(map[string]interface{}{
		"session_id":   "test-session-1",
		"task_summary": "Completed unit testing",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	text := resultText(t, result)
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

	result, err := server.handleReviewSession(context.Background(), makeReq(map[string]interface{}{
		"session_id": "nonexistent-session",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Error("Should not be an error, just empty result")
	}
	if !strings.Contains(resultText(t, result), "No working memories found") {
		t.Error("Should indicate no memories found")
	}
}

func TestHandleReviewSession_MissingSessionID(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleReviewSession(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing session_id")
	}
}

func TestHandleThinkMemoryMaintenance(t *testing.T) {
	server := newTestServer(t)
	_ = createTestMemory(t, server, "episodic", "")
	_ = createTestMemory(t, server, "semantic", "")

	result, err := server.handleThinkMemoryMaintenance(context.Background(), makeReq(map[string]interface{}{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	text := resultText(t, result)
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

	result, err := server.handleThinkMemoryMaintenance(context.Background(), makeReq(map[string]interface{}{
		"focus_level": "episodic",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	text := resultText(t, result)
	if !strings.Contains(text, "episodic") {
		t.Error("Response should reference episodic level")
	}
}

func TestHandleThinkMemoryMaintenance_InvalidLevel(t *testing.T) {
	server := newTestServer(t)
	result, err := server.handleThinkMemoryMaintenance(context.Background(), makeReq(map[string]interface{}{
		"focus_level": "invalid",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for invalid focus_level")
	}
}

func TestHandleThinkTaskCompletion(t *testing.T) {
	server := newTestServer(t)

	result, err := server.handleThinkTaskCompletion(context.Background(), makeReq(map[string]interface{}{
		"task_description": "Implemented workflow tools for MCP server",
		"outcome":          "Successfully added 6 new tools",
		"session_id":       "test-session",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	text := resultText(t, result)
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

	result, err := server.handleThinkTaskCompletion(context.Background(), makeReq(map[string]interface{}{
		"task_description":   "Fixed a bug",
		"outcome":            "Bug resolved",
		"related_memory_ids": []string{memID},
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %s", resultText(t, result))
	}

	text := resultText(t, result)
	if !strings.Contains(text, "related_memories") {
		t.Error("Response should contain related memories")
	}
}

func TestHandleThinkTaskCompletion_MissingRequired(t *testing.T) {
	server := newTestServer(t)

	// Missing outcome
	result, err := server.handleThinkTaskCompletion(context.Background(), makeReq(map[string]interface{}{
		"task_description": "Something",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing outcome")
	}

	// Missing task_description
	result, err = server.handleThinkTaskCompletion(context.Background(), makeReq(map[string]interface{}{
		"outcome": "Something",
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("Expected error for missing task_description")
	}
}
