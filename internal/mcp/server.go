package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/cortex-ai/cortex-ai/internal/embeddings"
	"github.com/cortex-ai/cortex-ai/internal/memory"
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
	transport Transport
	service   memory.Service
	storage   storage.Storage
	logger    *log.Logger
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
func (s *Server) Initialize(storagePath string) error {
	// Initialize storage
	store, err := storage.NewGobStorage(storagePath)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	s.storage = store

	// Initialize embedder
	embedder, err := embeddings.NewOllamaEmbedder("", "nomic-embed-text", 0)
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Create service
	s.service = memory.NewMemoryService(store, embedder)

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

// handleListTools returns available tools
func (s *Server) handleListTools(req *Request) *Response {
	tools := []Tool{
		{
			Name:        "cortex_search",
			Description: "Search memories using semantic similarity. Returns relevant memories based on the query.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"query": {
						Type:        "string",
						Description: "The search query to find relevant memories",
					},
					"top_k": {
						Type:        "integer",
						Description: "Maximum number of results to return (default: 5)",
						Default:     5,
					},
					"min_score": {
						Type:        "number",
						Description: "Minimum similarity score (0-1, default: 0.5)",
						Default:     0.5,
					},
					"type": {
						Type:        "string",
						Description: "Filter by memory type",
						Enum:        []string{"solution", "issue", "analysis", "rule", "any"},
					},
				},
				Required: []string{"query"},
			},
		},
		{
			Name:        "cortex_create",
			Description: "Create a new memory. Memories store solutions, issues, analyses, or rules for future reference.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"title": {
						Type:        "string",
						Description: "Title of the memory",
					},
					"content": {
						Type:        "string",
						Description: "Content of the memory (markdown supported)",
					},
					"type": {
						Type:        "string",
						Description: "Type of memory",
						Enum:        []string{"solution", "issue", "analysis", "rule", "any"},
					},
					"tags": {
						Type:        "array",
						Description: "Tags for categorization",
						Items:       &Items{Type: "string"},
					},
				},
				Required: []string{"title", "content", "type"},
			},
		},
		{
			Name:        "cortex_list",
			Description: "List all memories, optionally filtered by type.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"type": {
						Type:        "string",
						Description: "Filter by memory type",
						Enum:        []string{"solution", "issue", "analysis", "rule", "any"},
					},
					"include_obsolete": {
						Type:        "boolean",
						Description: "Include obsolete memories (default: false)",
						Default:     false,
					},
				},
			},
		},
		{
			Name:        "cortex_get",
			Description: "Get a specific memory by ID.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"id": {
						Type:        "string",
						Description: "The memory ID",
					},
				},
				Required: []string{"id"},
			},
		},
	}

	return NewResponse(req.ID, ListToolsResult{Tools: tools})
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
