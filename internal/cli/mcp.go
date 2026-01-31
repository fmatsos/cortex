package cli

import (
	"fmt"
	"os"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/mcp"
	"github.com/spf13/cobra"
)

var startMCPServerCmd = &cobra.Command{
	Use:   "start-mcp-server",
	Short: "Start the MCP (Model Context Protocol) server",
	Long: `Start the MCP server for integration with AI tools like Claude Code and Cursor.

The server communicates via JSON-RPC 2.0 over stdio and provides tools for:
- cortex_search: Semantic search across memories
- cortex_create: Create new memories
- cortex_list: List all memories
- cortex_get: Get a specific memory by ID

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
`,
	RunE: runStartMCPServer,
}

func init() {
	rootCmd.AddCommand(startMCPServerCmd)
}

func runStartMCPServer(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg := config.Global()

	// Create MCP server
	server := mcp.NewServer(os.Stdin, os.Stdout)

	// Initialize with storage path from config
	if err := server.Initialize(cfg.Storage.Path); err != nil {
		return fmt.Errorf("failed to initialize MCP server: %w", err)
	}
	defer server.Close()

	// Run the server (blocks until client disconnects)
	return server.Run()
}
