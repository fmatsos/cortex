package mcp

import (
	"encoding/json"
	"fmt"
	"os"

	charmlog "github.com/charmbracelet/log"
	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/consolidation"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/schemas"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/google/uuid"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

const (
	ServerName    = "cortex-ai"
	ServerVersion = "1.0.0"
)

// Server represents the MCP server wrapping mcp-go
type Server struct {
	mcp                  *mcpserver.MCPServer
	service              *memory.MemoryService
	storage              storage.Storage
	consolidationService *consolidation.Service
	embedder             memory.Embedder
	logger               *charmlog.Logger
	verboseLevel         int
}

// NewServer creates a new MCP server
func NewServer() *Server {
	s := &Server{
		mcp:    mcpserver.NewMCPServer(ServerName, ServerVersion, mcpserver.WithToolCapabilities(false)),
		logger: charmlog.NewWithOptions(os.Stderr, charmlog.Options{Prefix: "mcp", ReportTimestamp: true}),
	}
	s.registerTools()
	return s
}

// SetLogger replaces the server's logger.
func (s *Server) SetLogger(l *charmlog.Logger) { s.logger = l }

// SetVerboseLevel sets verbosity (0=default, 1=--v, 2=--vv, 3=--vvv).
func (s *Server) SetVerboseLevel(level int) { s.verboseLevel = level }

// MCPServer returns the underlying mcp-go server for transport binding.
func (s *Server) MCPServer() *mcpserver.MCPServer { return s.mcp }

// Initialize sets up the memory service using the backend selected in the global config.
func (s *Server) Initialize(embedder memory.Embedder) error {
	if embedder == nil {
		return fmt.Errorf("embedder is required")
	}

	s.embedder = embedder

	cfg := config.Global()
	store, err := storage.New(cfg.Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	s.storage = store

	s.service = memory.NewMemoryService(store, embedder)
	s.consolidationService = consolidation.NewService(store, embedder, &cfg.Consolidation)

	return nil
}

// Close cleans up resources
func (s *Server) Close() error {
	if s.storage != nil {
		return s.storage.Close()
	}
	return nil
}

// registerTools loads tool definitions from embedded JSON schemas and registers handlers.
func (s *Server) registerTools() {
	handlers := map[string]mcpserver.ToolHandlerFunc{
		"cortex_search":                         s.handleSearch,
		"cortex_create":                         s.handleCreate,
		"cortex_list":                           s.handleList,
		"cortex_get":                            s.handleGet,
		"cortex_consolidate":                    s.handleConsolidate,
		"cortex_choose_memory_layer":            s.handleChooseMemoryLayer,
		"cortex_choose_working_consolidation":   s.handleChooseWorkingConsolidation,
		"cortex_promote_memory":                 s.handlePromoteMemory,
		"cortex_update_memory":                  s.handleUpdateMemory,
		"cortex_mark_obsolete":                  s.handleMarkObsolete,
		"cortex_review_session":                 s.handleReviewSession,
		"cortex_think_about_memory_maintenance": s.handleThinkMemoryMaintenance,
		"cortex_think_about_task_completion":    s.handleThinkTaskCompletion,
	}

	for _, name := range schemas.MCPToolNames {
		schema, err := schemas.LoadMCPToolSchema(name)
		if err != nil {
			s.logger.Warn("failed to load schema", "tool", name, "err", err)
			continue
		}

		rawSchema, err := json.Marshal(schema.InputSchema)
		if err != nil {
			s.logger.Warn("failed to marshal schema", "tool", name, "err", err)
			continue
		}

		tool := mcpgo.Tool{
			Name:           schema.Name,
			Description:    schema.Description,
			RawInputSchema: rawSchema,
		}

		handler, ok := handlers[name]
		if !ok {
			s.logger.Warn("no handler for tool", "tool", name)
			continue
		}

		s.mcp.AddTool(tool, handler)
	}
}

// bindArgs unmarshals tool call arguments into the target struct.
func bindArgs(req mcpgo.CallToolRequest, target interface{}) error {
	data, err := json.Marshal(req.Params.Arguments)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

// toolResult creates a successful text tool result.
func toolResult(text string) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultText(text)
}

// toolError creates an error tool result.
func toolError(message string) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultError(message)
}

// generateID creates a new UUID string
func generateID() string {
	return uuid.New().String()
}
