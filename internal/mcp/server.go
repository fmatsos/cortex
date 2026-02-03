package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
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

// Server represents the MCP server
type Server struct {
	transport            Transport
	service              memory.Service
	storage              storage.Storage
	consolidatedStorage  *storage.GobConsolidatedStorage
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

	// Initialize consolidated storage
	consolidatedStore, err := storage.NewGobConsolidatedStorage(storagePath)
	if err != nil {
		return fmt.Errorf("failed to initialize consolidated storage: %w", err)
	}
	s.consolidatedStorage = consolidatedStore

	// Create consolidation service
	cfg := config.Global()
	s.consolidationService = consolidation.NewService(consolidatedStore, embedder, &cfg.Consolidation)

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

	if s.consolidatedStorage != nil {
		if err := s.consolidatedStorage.Close(); err != nil {
			errs = append(errs, fmt.Errorf("consolidated storage close: %w", err))
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
	default:
		return NewErrorResponse(req.ID, InvalidParams, "Unknown tool", params.Name)
	}
}

// Search arguments
type searchArgs struct {
	Query    string  `json:"query"`
	TopK     int     `json:"top_k"`
	MinScore float64 `json:"min_score"`
	Type     string  `json:"type"`
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
		TopK:     a.TopK,
		MinScore: a.MinScore,
	}

	if a.Type != "" {
		opts.FilterTypes = []memory.MemoryType{memory.MemoryType(a.Type)}
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
	Title   string   `json:"title"`
	Content string   `json:"content"`
	Type    string   `json:"type"`
	Tags    []string `json:"tags"`
}

func (s *Server) handleCreate(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a createArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid create arguments", err.Error())
	}

	if a.Title == "" || a.Content == "" || a.Type == "" {
		return NewErrorResponse(id, InvalidParams, "title, content, and type are required", nil)
	}

	input := memory.CreateInput{
		Title:   a.Title,
		Content: a.Content,
		Types:   []memory.MemoryType{memory.MemoryType(a.Type)},
		Tags:    a.Tags,
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
	Type            string `json:"type"`
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

	if a.Type != "" {
		opts.FilterTypes = []memory.MemoryType{memory.MemoryType(a.Type)}
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

	if a.Context.SessionID == "" {
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
		Context: memory.ConsolidationContext{
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
		Success bool                       `json:"success"`
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
