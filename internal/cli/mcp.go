package cli

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/mcp"
	"github.com/spf13/cobra"
)

var (
	mcpTransport string
	mcpAddress   string
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
}

func runStartMCPServer(cmd *cobra.Command, args []string) error {
	// Validate transport
	transportType := mcp.TransportType(mcpTransport)
	if !mcp.IsValidTransport(transportType) {
		return fmt.Errorf("invalid transport: %s (valid: stdio, sse)", mcpTransport)
	}

	// Load configuration
	cfg := config.Global()

	// Create transport based on mode
	var transport mcp.Transport
	switch transportType {
	case mcp.TransportStdio:
		transport = mcp.NewStdioTransport(os.Stdin, os.Stdout)
	case mcp.TransportSSE:
		sseTransport := mcp.NewSSETransport(mcp.SSETransportConfig{
			Address: mcpAddress,
		})
		if err := sseTransport.Start(); err != nil {
			return fmt.Errorf("failed to start SSE transport: %w", err)
		}
		transport = sseTransport
	}

	// Create MCP server with transport
	server := mcp.NewServer(transport)

	// Initialize embedder from config
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize with storage path from config
	storagePath := filepath.Join(cfg.Storage.Path, "memories.gob")
	if err := server.Initialize(storagePath, embedder); err != nil {
		return fmt.Errorf("failed to initialize MCP server: %w", err)
	}
	defer func() { _ = server.Close() }()

	// Handle shutdown signals for SSE mode
	if transportType == mcp.TransportSSE {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigChan
			_ = server.Close()
		}()
	}

	// Run the server (blocks until client disconnects)
	return server.Run()
}
