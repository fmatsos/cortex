package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/consolidation"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/schemas"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
)

const (
	ServerName    = "cortex-ai"
	ServerVersion = "1.0.0"
	MCPVersion    = "2024-11-05"
)

const (
	defaultMemoryLayerPrompt = `You are selecting the correct Cortex memory layer for a new memory.

Choose exactly one: working, episodic, semantic.

Guidelines:
- working: temporary session context, active tasks, scratch notes. Requires session_id.
- episodic: time-bound events/decisions/outcomes useful for historical recall.
- semantic: durable, reusable knowledge or conventions that should persist.

Return JSON only:
{"level":"working|episodic|semantic","rationale":"short reason","needs_session_id":true|false}`

	defaultWorkingConsolidationPrompt = `You are selecting which working memories should be consolidated.

Pick entries that capture completed work, decisions, or knowledge that should persist.
Exclude transient notes that are only useful during the session.

Return JSON only:
{"selected_ids":["id1","id2"],"rationale":"short reason","suggested_level":"episodic|semantic|mixed"}`
)

// Server represents the MCP server
type Server struct {
	transport            Transport
	service              *memory.MemoryService
	storage              storage.Storage
	consolidationService *consolidation.Service
	embedder             memory.Embedder
	logger               *log.Logger
}

// NewServer creates a new MCP server with the given transport
func NewServer(transport Transport) *Server {
	return &Server{
		transport: transport,
		logger:    log.New(os.Stderr, "[mcp] ", log.LstdFlags),
	}
}

// NewServerWithStdio creates a new MCP server using stdio transport (convenience function)
func NewServerWithStdio(reader io.Reader, writer io.Writer) *Server {
	return NewServer(NewStdioTransport(reader, writer))
}

// Initialize sets up the memory service
func (s *Server) Initialize(storagePath string, embedder memory.Embedder) error {
	if embedder == nil {
		return fmt.Errorf("embedder is required")
	}

	s.embedder = embedder

	// Initialize storage
	store, err := storage.NewGobStorage(storagePath)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	s.storage = store

	// Create service
	s.service = memory.NewMemoryService(store, embedder)

	// Create consolidation service
	cfg := config.Global()
	s.consolidationService = consolidation.NewService(store, embedder, &cfg.Consolidation)

	return nil
}

// Close cleans up resources
func (s *Server) Close() error {
	var errs []error

	if s.transport != nil {
		if err := s.transport.Close(); err != nil {
			errs = append(errs, fmt.Errorf("transport close: %w", err))
		}
	}

	if s.storage != nil {
		if err := s.storage.Close(); err != nil {
			errs = append(errs, fmt.Errorf("storage close: %w", err))
		}
	}

	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}

// Run starts the MCP server main loop
func (s *Server) Run() error {
	return s.RunWithContext(context.Background())
}

// RunWithContext starts the MCP server main loop with context support
func (s *Server) RunWithContext(ctx context.Context) error {
	s.logger.Println("Starting MCP server...")

	for {
		// Receive request from transport
		req, err := s.transport.Receive(ctx)
		if err != nil {
			if err == io.EOF || ctx.Err() != nil {
				s.logger.Println("Client disconnected")
				return nil
			}
			// Check for parse errors
			if isParseError(err) {
				s.sendError(ctx, nil, ParseError, "Parse error", err.Error())
				continue
			}
			return fmt.Errorf("receive error: %w", err)
		}

		// Handle request
		resp := s.handleRequest(req)
		if resp != nil {
			if err := s.transport.Send(ctx, resp); err != nil {
				s.logger.Printf("Failed to send response: %v", err)
			}
		}
	}
}

// isParseError checks if the error is a JSON parse error
func isParseError(err error) bool {
	return err != nil && err.Error() != "" && len(err.Error()) > 6 && err.Error()[:5] == "parse"
}

// handleRequest processes a JSON-RPC request
func (s *Server) handleRequest(req *Request) *Response {
	s.logger.Printf("Received method: %s", req.Method)

	switch req.Method {
	case "initialize":
		return s.handleInitialize(req)
	case "initialized":
		// Notification, no response needed
		return nil
	case "tools/list":
		return s.handleListTools(req)
	case "tools/call":
		return s.handleCallTool(req)
	case "shutdown":
		return NewResponse(req.ID, nil)
	default:
		return NewErrorResponse(req.ID, MethodNotFound, "Method not found", req.Method)
	}
}

// handleInitialize handles the initialize request
func (s *Server) handleInitialize(req *Request) *Response {
	result := InitializeResult{
		ProtocolVersion: MCPVersion,
		Capabilities: Capabilities{
			Tools: &ToolsCapability{},
		},
		ServerInfo: ServerInfo{
			Name:    ServerName,
			Version: ServerVersion,
		},
	}

	return NewResponse(req.ID, result)
}

// handleListTools returns available tools loaded from embedded schemas
func (s *Server) handleListTools(req *Request) *Response {
	tools := make([]Tool, 0, len(schemas.MCPToolNames))

	for _, name := range schemas.MCPToolNames {
		schema, err := schemas.LoadMCPToolSchema(name)
		if err != nil {
			s.logger.Printf("Failed to load schema for %s: %v", name, err)
			continue
		}

		tool := Tool{
			Name:        schema.Name,
			Description: schema.Description,
			InputSchema: convertInputSchema(schema.InputSchema),
		}
		tools = append(tools, tool)
	}

	return NewResponse(req.ID, ListToolsResult{Tools: tools})
}

// convertInputSchema converts schema types to MCP protocol types
func convertInputSchema(s schemas.InputSchema) InputSchema {
	props := make(map[string]Property)
	for k, v := range s.Properties {
		prop := Property{
			Type:        v.Type,
			Description: v.Description,
			Enum:        v.Enum,
			Default:     v.Default,
		}
		if v.Items != nil {
			prop.Items = &Items{Type: v.Items.Type}
		}
		props[k] = prop
	}
	return InputSchema{
		Type:       s.Type,
		Properties: props,
		Required:   s.Required,
	}
}

// handleCallTool handles tool invocations
func (s *Server) handleCallTool(req *Request) *Response {
	var params CallToolParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return NewErrorResponse(req.ID, InvalidParams, "Invalid params", err.Error())
	}

	ctx := context.Background()

	switch params.Name {
	case "cortex_search":
		return s.handleSearch(ctx, req.ID, params.Arguments)
	case "cortex_create":
		return s.handleCreate(ctx, req.ID, params.Arguments)
	case "cortex_list":
		return s.handleList(ctx, req.ID, params.Arguments)
	case "cortex_get":
		return s.handleGet(ctx, req.ID, params.Arguments)
	case "cortex_consolidate":
		return s.handleConsolidate(ctx, req.ID, params.Arguments)
	case "cortex_choose_memory_layer":
		return s.handleChooseMemoryLayer(ctx, req.ID, params.Arguments)
	case "cortex_choose_working_consolidation":
		return s.handleChooseWorkingConsolidation(ctx, req.ID, params.Arguments)
	default:
		return NewErrorResponse(req.ID, InvalidParams, "Unknown tool", params.Name)
	}
}

// Search arguments
type searchArgs struct {
	Query           string  `json:"query"`
	TopK            int     `json:"top_k"`
	MinScore        float64 `json:"min_score"`
	Level           string  `json:"level"`
	SessionID       string  `json:"session_id"`
	IncludeObsolete bool    `json:"include_obsolete"`
}

func (s *Server) handleSearch(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a searchArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid search arguments", err.Error())
	}

	if a.Query == "" {
		return NewErrorResponse(id, InvalidParams, "Query is required", nil)
	}

	// Set defaults
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
			return s.toolError(id, fmt.Sprintf("invalid level: %s", a.Level))
		}
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.Level)}
	}

	results, err := s.service.Search(ctx, a.Query, opts)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Search failed: %v", err))
	}

	// Return JSON structured results for better LLM parsing
	jsonBytes, err := pkgjson.MarshalSearchResults(results, false)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal results: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Create arguments
type createArgs struct {
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Level     string   `json:"level"`
	Tags      []string `json:"tags"`
	SessionID string   `json:"session_id"`
	Source    string   `json:"source"`
	TaskID    string   `json:"task_id"`
	Author    string   `json:"author"`
}

func (s *Server) handleCreate(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a createArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid create arguments", err.Error())
	}

	if a.Title == "" || a.Content == "" || a.Level == "" {
		return NewErrorResponse(id, InvalidParams, "title, content, and level are required", nil)
	}
	if !memory.IsValidLevel(a.Level) {
		return NewErrorResponse(id, InvalidParams, "invalid level", a.Level)
	}
	if memory.MemoryLevel(a.Level) == memory.MemoryLevelWorking && a.SessionID == "" {
		return NewErrorResponse(id, InvalidParams, "session_id is required for working level", nil)
	}

	input := memory.CreateInput{
		Title:     a.Title,
		Content:   a.Content,
		Level:     memory.MemoryLevel(a.Level),
		Tags:      a.Tags,
		SessionID: a.SessionID,
		Source:    a.Source,
		TaskID:    a.TaskID,
		Author:    a.Author,
	}

	mem, err := s.service.Create(ctx, input)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Create failed: %v", err))
	}

	// Return JSON structured response
	response := struct {
		Success bool               `json:"success"`
		Memory  pkgjson.MemoryJSON `json:"memory"`
	}{
		Success: true,
		Memory:  pkgjson.ToMemoryJSON(mem),
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// List arguments
type listArgs struct {
	Level           string `json:"level"`
	IncludeObsolete bool   `json:"include_obsolete"`
}

func (s *Server) handleList(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a listArgs
	if args != nil {
		if err := json.Unmarshal(args, &a); err != nil {
			return NewErrorResponse(id, InvalidParams, "Invalid list arguments", err.Error())
		}
	}

	opts := memory.ListOptions{
		IncludeObsolete: a.IncludeObsolete,
	}

	if a.Level != "" {
		if !memory.IsValidLevel(a.Level) {
			return s.toolError(id, fmt.Sprintf("invalid level: %s", a.Level))
		}
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.Level)}
	}

	memories, err := s.service.List(ctx, opts)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("List failed: %v", err))
	}

	// Return JSON structured results for better LLM parsing
	jsonBytes, err := pkgjson.MarshalMemories(memories, false)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal memories: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Get arguments
type getArgs struct {
	ID string `json:"id"`
}

func (s *Server) handleGet(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a getArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid get arguments", err.Error())
	}

	if a.ID == "" {
		return NewErrorResponse(id, InvalidParams, "ID is required", nil)
	}

	mem, err := s.service.Get(ctx, a.ID)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Get failed: %v", err))
	}

	// Return JSON structured memory for better LLM parsing
	jsonBytes, err := pkgjson.MarshalMemory(mem, false)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal memory: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Consolidate arguments
type consolidateArgs struct {
	Synthesis   string                `json:"synthesis"`
	MemoryLevel string                `json:"memory_level"`
	Context     consolidateContextArg `json:"context"`
	Force       bool                  `json:"force"`
}

type consolidateContextArg struct {
	TaskID          string   `json:"task_id"`
	SessionID       string   `json:"session_id"`
	Timestamp       string   `json:"timestamp"`
	Author          string   `json:"author"`
	Tags            []string `json:"tags"`
	Source          string   `json:"source"`
	RelatedMemories []string `json:"related_memories"`
}

func (s *Server) handleConsolidate(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a consolidateArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid consolidate arguments", err.Error())
	}

	if a.Synthesis == "" {
		return NewErrorResponse(id, InvalidParams, "synthesis is required", nil)
	}

	if a.MemoryLevel == "" {
		return NewErrorResponse(id, InvalidParams, "memory_level is required", nil)
	}

	if !memory.IsValidLevel(a.MemoryLevel) {
		return NewErrorResponse(id, InvalidParams, "invalid memory_level: must be working|episodic|semantic", nil)
	}

	if memory.MemoryLevel(a.MemoryLevel) == memory.MemoryLevelWorking && a.Context.SessionID == "" {
		return NewErrorResponse(id, InvalidParams, "context.session_id is required", nil)
	}

	if a.Context.Source == "" {
		a.Context.Source = "llm"
	}

	// Parse timestamp
	var timestamp time.Time
	if a.Context.Timestamp != "" {
		var err error
		timestamp, err = time.Parse(time.RFC3339, a.Context.Timestamp)
		if err != nil {
			timestamp = time.Now()
		}
	} else {
		timestamp = time.Now()
	}

	// Build consolidation input
	input := memory.ConsolidateInput{
		Synthesis: a.Synthesis,
		Level:     memory.MemoryLevel(a.MemoryLevel),
		Context: memory.MemoryContext{
			TaskID:          a.Context.TaskID,
			SessionID:       a.Context.SessionID,
			Timestamp:       timestamp,
			Author:          a.Context.Author,
			Tags:            a.Context.Tags,
			Source:          a.Context.Source,
			RelatedMemories: a.Context.RelatedMemories,
		},
		Force: a.Force,
	}

	// Consolidate
	result, err := s.consolidationService.Consolidate(ctx, input)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Consolidation failed: %v", err))
	}

	// Return JSON response
	response := struct {
		Success bool                      `json:"success"`
		Result  *memory.ConsolidateResult `json:"result"`
	}{
		Success: true,
		Result:  result,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

type chooseMemoryLayerArgs struct {
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags"`
	SessionID string   `json:"session_id"`
	Prompt    string   `json:"prompt"`
}

type chooseMemoryLayerResponse struct {
	Prompt       string `json:"prompt"`
	OutputFormat string `json:"output_format"`
	Memory       struct {
		Title     string   `json:"title"`
		Content   string   `json:"content"`
		Tags      []string `json:"tags,omitempty"`
		SessionID string   `json:"session_id,omitempty"`
	} `json:"memory"`
}

func (s *Server) handleChooseMemoryLayer(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a chooseMemoryLayerArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid choose memory layer arguments", err.Error())
	}

	if strings.TrimSpace(a.Content) == "" {
		return NewErrorResponse(id, InvalidParams, "content is required", nil)
	}

	prompt := strings.TrimSpace(a.Prompt)
	if prompt == "" {
		prompt = defaultMemoryLayerPrompt
	}

	response := chooseMemoryLayerResponse{
		Prompt:       prompt,
		OutputFormat: `{"level":"working|episodic|semantic","rationale":"short reason","needs_session_id":true|false}`,
	}
	response.Memory.Title = a.Title
	response.Memory.Content = a.Content
	response.Memory.Tags = a.Tags
	response.Memory.SessionID = a.SessionID

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

type workingMemoryCandidate struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"created_at,omitempty"`
	SessionID string   `json:"session_id,omitempty"`
}

type chooseWorkingConsolidationArgs struct {
	WorkingMemories []workingMemoryCandidate `json:"working_memories"`
	SelectionGoal   string                   `json:"selection_goal"`
	Prompt          string                   `json:"prompt"`
}

type chooseWorkingConsolidationResponse struct {
	Prompt          string                   `json:"prompt"`
	OutputFormat    string                   `json:"output_format"`
	SelectionGoal   string                   `json:"selection_goal,omitempty"`
	WorkingMemories []workingMemoryCandidate `json:"working_memories"`
}

func (s *Server) handleChooseWorkingConsolidation(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a chooseWorkingConsolidationArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid choose working consolidation arguments", err.Error())
	}

	if len(a.WorkingMemories) == 0 {
		return NewErrorResponse(id, InvalidParams, "working_memories is required", nil)
	}

	prompt := strings.TrimSpace(a.Prompt)
	if prompt == "" {
		prompt = defaultWorkingConsolidationPrompt
	}

	response := chooseWorkingConsolidationResponse{
		Prompt:          prompt,
		OutputFormat:    `{"selected_ids":["id1","id2"],"rationale":"short reason","suggested_level":"episodic|semantic|mixed"}`,
		SelectionGoal:   a.SelectionGoal,
		WorkingMemories: a.WorkingMemories,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// toolResult creates a successful tool result
func (s *Server) toolResult(id interface{}, text string) *Response {
	return NewResponse(id, CallToolResult{
		Content: []Content{NewTextContent(text)},
	})
}

// toolError creates an error tool result
func (s *Server) toolError(id interface{}, message string) *Response {
	return NewResponse(id, CallToolResult{
		Content: []Content{NewTextContent(message)},
		IsError: true,
	})
}

// sendError sends an error response
func (s *Server) sendError(ctx context.Context, id interface{}, code int, message, data string) {
	resp := NewErrorResponse(id, code, message, data)
	if err := s.transport.Send(ctx, resp); err != nil {
		s.logger.Printf("Error sending error response: %v", err)
	}
}
