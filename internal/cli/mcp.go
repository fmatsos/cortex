package cli

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	charmlog "github.com/charmbracelet/log"
	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/spf13/cobra"
)

var (
	mcpTransport  string
	mcpAddress    string
	mcpNoLogs     bool
	mcpVerboseV   bool
	mcpVerboseVV  bool
	mcpVerboseVVV bool
)

var startMCPServerCmd = &cobra.Command{
	Use:   "start-mcp-server",
	Short: "Start the MCP (Model Context Protocol) server",
	Long: `Start the MCP server for integration with AI tools like Claude Code and Cursor.

The server communicates via JSON-RPC 2.0 and provides tools for:
- cortex_search: Semantic search across memories
- cortex_create: Create new memories
- cortex_list: List all memories
- cortex_get: Get a specific memory by ID

Transport modes:
- stdio: Communicate via stdin/stdout (default, for CLI integrations)
- sse:   Communicate via Server-Sent Events over HTTP (for web integrations)

Example MCP configuration for Claude Code (~/.config/claude-code/mcp.json):
  {
    "mcpServers": {
      "cortex": {
        "command": "cortex",
        "args": ["start-mcp-server"]
      }
    }
  }

Example MCP configuration for Cursor:
  {
    "mcp": {
      "servers": {
        "cortex": {
          "command": "cortex",
          "args": ["start-mcp-server"]
        }
      }
    }
  }

Example SSE mode:
  cortex start-mcp-server --transport sse --address :8080

  Then connect via:
  - SSE endpoint: GET http://localhost:8080/sse
  - Message endpoint: POST http://localhost:8080/message?session_id=<id>
`,
	RunE: runStartMCPServer,
}

func init() {
	rootCmd.AddCommand(startMCPServerCmd)

	startMCPServerCmd.Flags().StringVar(&mcpTransport, "transport", "stdio",
		"Transport mode: stdio or sse")
	startMCPServerCmd.Flags().StringVar(&mcpAddress, "address", ":8080",
		"Address to listen on for SSE transport (e.g., :8080 or 127.0.0.1:8080)")
	startMCPServerCmd.Flags().BoolVar(&mcpNoLogs, "no-logs", false,
		"Disable all logging output")
	startMCPServerCmd.Flags().BoolVar(&mcpVerboseV, "v", false,
		"Verbose logging (level 1: MCP methods)")
	startMCPServerCmd.Flags().BoolVar(&mcpVerboseVV, "vv", false,
		"More verbose (level 2: tool calls)")
	startMCPServerCmd.Flags().BoolVar(&mcpVerboseVVV, "vvv", false,
		"Debug logging (level 3: JSON payloads)")
}

func buildMCPLogConfig(noLogs, v, vv, vvv bool) (charmlog.Level, io.Writer, int) {
	verboseLevel := 0
	switch {
	case vvv:
		verboseLevel = 3
	case vv:
		verboseLevel = 2
	case v:
		verboseLevel = 1
	}

	level := charmlog.InfoLevel
	if verboseLevel > 0 {
		level = charmlog.DebugLevel
	}

	w := io.Writer(os.Stderr)
	if noLogs {
		w = io.Discard
	}

	return level, w, verboseLevel
}

func buildMCPLogger(noLogs, v, vv, vvv bool) (*charmlog.Logger, int) {
	level, w, verboseLevel := buildMCPLogConfig(noLogs, v, vv, vvv)
	logger := charmlog.NewWithOptions(w, charmlog.Options{
		Level:           level,
		Prefix:          "mcp",
		ReportTimestamp: true,
	})
	return logger, verboseLevel
}

func runStartMCPServer(cmd *cobra.Command, args []string) error {
	logger, verboseLevel := buildMCPLogger(mcpNoLogs, mcpVerboseV, mcpVerboseVV, mcpVerboseVVV)

	// Validate transport
	if mcpTransport != "stdio" && mcpTransport != "sse" {
		return fmt.Errorf("invalid transport: %s (valid: stdio, sse)", mcpTransport)
	}
	logger.Info("starting MCP server", "transport", mcpTransport)

	// Create cortex MCP server (registers tools, no heavy init yet)
	server := mcp.NewServer()
	server.SetLogger(logger)
	server.SetVerboseLevel(verboseLevel)

	// Load configuration and initialize storage + embedder
	cfg := config.Global()
	logger.Info("initializing embedder", "model", cfg.Embeddings.Model, "endpoint", cfg.Embeddings.Endpoint)
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	logger.Info("initializing storage", "backend", cfg.Storage.Backend, "path", cfg.Storage.Path)
	if err := server.Initialize(embedder); err != nil {
		return fmt.Errorf("failed to initialize MCP server: %w", err)
	}
	defer func() { _ = server.Close() }()

	logger.Info("MCP server ready")

	// Build stderr logger for mcp-go transport using charm log adapter
	stdErrLogger := logger.StandardLog()

	switch mcpTransport {
	case "stdio":
		return mcpserver.ServeStdio(server.MCPServer(), mcpserver.WithErrorLogger(stdErrLogger))

	case "sse":
		sseServer := mcpserver.NewSSEServer(server.MCPServer(),
			mcpserver.WithSSEEndpoint("/sse"),
			mcpserver.WithMessageEndpoint("/message"),
		)
		logger.Info("starting SSE transport", "address", mcpAddress)

		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigChan
			_ = server.Close()
			os.Exit(0)
		}()

		if err := http.ListenAndServe(mcpAddress, sseServer); err != nil {
			return fmt.Errorf("SSE server error: %w", err)
		}
	}

	return nil
}
