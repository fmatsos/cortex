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
	"github.com/google/uuid"
)

const (
	ServerName    = "cortex-ai"
	ServerVersion = "1.0.0"
	MCPVersion    = "2024-11-05"
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
	case "cortex_promote_memory":
		return s.handlePromoteMemory(ctx, req.ID, params.Arguments)
	case "cortex_update_memory":
		return s.handleUpdateMemory(ctx, req.ID, params.Arguments)
	case "cortex_mark_obsolete":
		return s.handleMarkObsolete(ctx, req.ID, params.Arguments)
	case "cortex_review_session":
		return s.handleReviewSession(ctx, req.ID, params.Arguments)
	case "cortex_think_about_memory_maintenance":
		return s.handleThinkMemoryMaintenance(ctx, req.ID, params.Arguments)
	case "cortex_think_about_task_completion":
		return s.handleThinkTaskCompletion(ctx, req.ID, params.Arguments)
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
}

func (s *Server) handleChooseMemoryLayer(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a chooseMemoryLayerArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid choose memory layer arguments", err.Error())
	}

	if strings.TrimSpace(a.Content) == "" {
		return NewErrorResponse(id, InvalidParams, "content is required", nil)
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
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	finalPrompt := fmt.Sprintf("%s\n\nMemory to classify:\n%s", prompt, string(jsonBytes))
	return s.toolResult(id, finalPrompt)
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
}

func (s *Server) handleChooseWorkingConsolidation(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a chooseWorkingConsolidationArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid choose working consolidation arguments", err.Error())
	}

	if len(a.WorkingMemories) == 0 {
		return NewErrorResponse(id, InvalidParams, "working_memories is required", nil)
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.ChooseWorkingConsolidation)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.ChooseWorkingConsolidation
	}

	payload := struct {
		SelectionGoal   string                   `json:"selection_goal,omitempty"`
		WorkingMemories []workingMemoryCandidate `json:"working_memories"`
	}{
		SelectionGoal:   a.SelectionGoal,
		WorkingMemories: a.WorkingMemories,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	finalPrompt := fmt.Sprintf("%s\n\nWorking memories to review:\n%s", prompt, string(jsonBytes))
	return s.toolResult(id, finalPrompt)
}

// Promote memory arguments
type promoteMemoryArgs struct {
	MemoryID       string   `json:"memory_id"`
	RevisedContent string   `json:"revised_content"`
	RevisedTitle   string   `json:"revised_title"`
	Tags           []string `json:"tags"`
}

func (s *Server) handlePromoteMemory(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a promoteMemoryArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid promote memory arguments", err.Error())
	}

	if a.MemoryID == "" {
		return NewErrorResponse(id, InvalidParams, "memory_id is required", nil)
	}

	mem, err := s.service.Get(ctx, a.MemoryID)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to get memory: %v", err))
	}

	var targetLevel memory.MemoryLevel
	switch mem.Level {
	case memory.MemoryLevelWorking:
		targetLevel = memory.MemoryLevelEpisodic
	case memory.MemoryLevelEpisodic:
		targetLevel = memory.MemoryLevelSemantic
	case memory.MemoryLevelSemantic:
		return s.toolError(id, "semantic memories cannot be promoted further")
	default:
		return s.toolError(id, fmt.Sprintf("unknown memory level: %s", mem.Level))
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
		return s.toolError(id, fmt.Sprintf("Failed to generate embedding: %v", err))
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
		return s.toolError(id, fmt.Sprintf("Validation failed: %v", err))
	}

	if err := s.storage.Save(ctx, promoted); err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to save promoted memory: %v", err))
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
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Update memory arguments
type updateMemoryArgs struct {
	MemoryID string   `json:"memory_id"`
	Title    *string  `json:"title"`
	Content  *string  `json:"content"`
	Tags     []string `json:"tags"`
}

func (s *Server) handleUpdateMemory(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a updateMemoryArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid update memory arguments", err.Error())
	}

	if a.MemoryID == "" {
		return NewErrorResponse(id, InvalidParams, "memory_id is required", nil)
	}

	mem, err := s.service.Get(ctx, a.MemoryID)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to get memory: %v", err))
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
		return s.toolError(id, fmt.Sprintf("Validation failed: %v", err))
	}

	if needsReembed {
		text := fmt.Sprintf("Title: %s\n\nContent: %s", mem.Title, mem.Content)
		embedding, err := s.embedder.Embed(ctx, text)
		if err != nil {
			return s.toolError(id, fmt.Sprintf("Failed to generate embedding: %v", err))
		}
		mem.Embedding = embedding
	}

	mem.UpdatedAt = time.Now()

	if err := s.storage.Update(ctx, mem); err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to update memory: %v", err))
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
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Mark obsolete arguments
type markObsoleteArgs struct {
	MemoryID string `json:"memory_id"`
	Reason   string `json:"reason"`
}

func (s *Server) handleMarkObsolete(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a markObsoleteArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid mark obsolete arguments", err.Error())
	}

	if a.MemoryID == "" {
		return NewErrorResponse(id, InvalidParams, "memory_id is required", nil)
	}

	if err := s.service.MarkObsolete(ctx, a.MemoryID); err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to mark obsolete: %v", err))
	}

	response := struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		MemoryID string `json:"memory_id"`
		Reason   string `json:"reason,omitempty"`
	}{
		Success:  true,
		Action:   "marked_obsolete",
		MemoryID: a.MemoryID,
		Reason:   a.Reason,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal response: %v", err))
	}

	return s.toolResult(id, string(jsonBytes))
}

// Review session arguments
type reviewSessionArgs struct {
	SessionID   string `json:"session_id"`
	TaskSummary string `json:"task_summary"`
}

func (s *Server) handleReviewSession(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a reviewSessionArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid review session arguments", err.Error())
	}

	if a.SessionID == "" {
		return NewErrorResponse(id, InvalidParams, "session_id is required", nil)
	}

	memories, err := s.service.List(ctx, memory.ListOptions{
		FilterLevels: []memory.MemoryLevel{memory.MemoryLevelWorking},
	})
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to list working memories: %v", err))
	}

	var sessionMemories []*memory.Memory
	for _, m := range memories {
		if m.Context.SessionID == a.SessionID {
			sessionMemories = append(sessionMemories, m)
		}
	}

	if len(sessionMemories) == 0 {
		return s.toolResult(id, fmt.Sprintf("No working memories found for session %q. Nothing to review.", a.SessionID))
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.ReviewSession)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.ReviewSession
	}

	type memoryEntry struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Content   string   `json:"content"`
		Tags      []string `json:"tags,omitempty"`
		CreatedAt string   `json:"created_at"`
	}

	entries := make([]memoryEntry, 0, len(sessionMemories))
	for _, m := range sessionMemories {
		entries = append(entries, memoryEntry{
			ID:        m.ID,
			Title:     m.Title,
			Content:   m.Content,
			Tags:      m.Tags,
			CreatedAt: m.CreatedAt.Format(time.RFC3339),
		})
	}

	payload := struct {
		SessionID       string        `json:"session_id"`
		TaskSummary     string        `json:"task_summary,omitempty"`
		MemoryCount     int           `json:"memory_count"`
		WorkingMemories []memoryEntry `json:"working_memories"`
	}{
		SessionID:       a.SessionID,
		TaskSummary:     a.TaskSummary,
		MemoryCount:     len(entries),
		WorkingMemories: entries,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal payload: %v", err))
	}

	finalPrompt := fmt.Sprintf("%s\n\nSession data:\n%s", prompt, string(jsonBytes))
	return s.toolResult(id, finalPrompt)
}

// Think about memory maintenance arguments
type thinkMemoryMaintenanceArgs struct {
	FocusLevel string   `json:"focus_level"`
	FocusTags  []string `json:"focus_tags"`
}

func (s *Server) handleThinkMemoryMaintenance(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a thinkMemoryMaintenanceArgs
	if args != nil {
		if err := json.Unmarshal(args, &a); err != nil {
			return NewErrorResponse(id, InvalidParams, "Invalid memory maintenance arguments", err.Error())
		}
	}

	if a.FocusLevel != "" && !memory.IsValidLevel(a.FocusLevel) {
		return NewErrorResponse(id, InvalidParams, "invalid focus_level", a.FocusLevel)
	}

	opts := memory.ListOptions{IncludeObsolete: true}
	if a.FocusLevel != "" {
		opts.FilterLevels = []memory.MemoryLevel{memory.MemoryLevel(a.FocusLevel)}
	}

	memories, err := s.service.List(ctx, opts)
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to list memories: %v", err))
	}

	// Filter by tags if specified
	if len(a.FocusTags) > 0 {
		tagSet := make(map[string]bool)
		for _, t := range a.FocusTags {
			tagSet[t] = true
		}
		var filtered []*memory.Memory
		for _, m := range memories {
			for _, t := range m.Tags {
				if tagSet[t] {
					filtered = append(filtered, m)
					break
				}
			}
		}
		memories = filtered
	}

	// Compute statistics
	var workingCount, episodicCount, semanticCount, obsoleteCount int

	type memoryEntry struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Level     string   `json:"level"`
		Tags      []string `json:"tags,omitempty"`
		CreatedAt string   `json:"created_at"`
		Obsolete  bool     `json:"obsolete,omitempty"`
		Preview   string   `json:"preview"`
	}

	entries := make([]memoryEntry, 0, len(memories))
	for _, m := range memories {
		switch m.Level {
		case memory.MemoryLevelWorking:
			workingCount++
		case memory.MemoryLevelEpisodic:
			episodicCount++
		case memory.MemoryLevelSemantic:
			semanticCount++
		}
		if m.Obsolete {
			obsoleteCount++
		}

		preview := m.Content
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}

		entries = append(entries, memoryEntry{
			ID:        m.ID,
			Title:     m.Title,
			Level:     string(m.Level),
			Tags:      m.Tags,
			CreatedAt: m.CreatedAt.Format(time.RFC3339),
			Obsolete:  m.Obsolete,
			Preview:   preview,
		})
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.MemoryMaintenance)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.MemoryMaintenance
	}

	stats := struct {
		Total    int `json:"total"`
		Working  int `json:"working"`
		Episodic int `json:"episodic"`
		Semantic int `json:"semantic"`
		Obsolete int `json:"obsolete"`
	}{
		Total:    len(memories),
		Working:  workingCount,
		Episodic: episodicCount,
		Semantic: semanticCount,
		Obsolete: obsoleteCount,
	}

	payload := struct {
		Stats      interface{}   `json:"stats"`
		FocusLevel string        `json:"focus_level,omitempty"`
		FocusTags  []string      `json:"focus_tags,omitempty"`
		Memories   []memoryEntry `json:"memories"`
	}{
		Stats:      stats,
		FocusLevel: a.FocusLevel,
		FocusTags:  a.FocusTags,
		Memories:   entries,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal payload: %v", err))
	}

	finalPrompt := fmt.Sprintf("%s\n\nMemory store data:\n%s", prompt, string(jsonBytes))
	return s.toolResult(id, finalPrompt)
}

// Think about task completion arguments
type thinkTaskCompletionArgs struct {
	TaskDescription  string   `json:"task_description"`
	Outcome          string   `json:"outcome"`
	SessionID        string   `json:"session_id"`
	RelatedMemoryIDs []string `json:"related_memory_ids"`
}

func (s *Server) handleThinkTaskCompletion(ctx context.Context, id interface{}, args json.RawMessage) *Response {
	var a thinkTaskCompletionArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return NewErrorResponse(id, InvalidParams, "Invalid task completion arguments", err.Error())
	}

	if a.TaskDescription == "" {
		return NewErrorResponse(id, InvalidParams, "task_description is required", nil)
	}
	if a.Outcome == "" {
		return NewErrorResponse(id, InvalidParams, "outcome is required", nil)
	}

	prompt := strings.TrimSpace(config.Global().MCP.Prompts.TaskCompletion)
	if prompt == "" {
		prompt = config.DefaultConfig().MCP.Prompts.TaskCompletion
	}

	type relatedMemory struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Level   string `json:"level"`
		Preview string `json:"preview"`
	}

	var relatedMemories []relatedMemory
	for _, memID := range a.RelatedMemoryIDs {
		if m, err := s.service.Get(ctx, memID); err == nil {
			preview := m.Content
			if len(preview) > 200 {
				preview = preview[:200] + "..."
			}
			relatedMemories = append(relatedMemories, relatedMemory{
				ID:      m.ID,
				Title:   m.Title,
				Level:   string(m.Level),
				Preview: preview,
			})
		}
	}

	payload := struct {
		TaskDescription string          `json:"task_description"`
		Outcome         string          `json:"outcome"`
		SessionID       string          `json:"session_id,omitempty"`
		RelatedMemories []relatedMemory `json:"related_memories,omitempty"`
	}{
		TaskDescription: a.TaskDescription,
		Outcome:         a.Outcome,
		SessionID:       a.SessionID,
		RelatedMemories: relatedMemories,
	}

	jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return s.toolError(id, fmt.Sprintf("Failed to marshal payload: %v", err))
	}

	finalPrompt := fmt.Sprintf("%s\n\nTask data:\n%s", prompt, string(jsonBytes))
	return s.toolResult(id, finalPrompt)
}

// generateID creates a new UUID string
func generateID() string {
	return uuid.New().String()
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
