// cortex-mcp is an MCP (Model Context Protocol) server for Cortex AI.
// It allows LLM tools like Claude Code and Cursor to interact with Cortex memories.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/mcp"
)

func main() {
	// Determine storage path
	storagePath := getStoragePath()

	// Create MCP server
	server := mcp.NewServer(os.Stdin, os.Stdout)

	// Initialize with storage
	if err := server.Initialize(storagePath); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize: %v\n", err)
		os.Exit(1)
	}
	defer server.Close()

	// Run the server
	if err := server.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

// getStoragePath returns the storage path from env or default
func getStoragePath() string {
	// Check environment variable
	if path := os.Getenv("CORTEX_STORAGE_PATH"); path != "" {
		return path
	}

	// Check XDG_DATA_HOME
	if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
		return filepath.Join(xdgData, "cortex-ai")
	}

	// Default to ~/.local/share/cortex-ai
	home, err := os.UserHomeDir()
	if err != nil {
		return ".local/share/cortex-ai"
	}

	return filepath.Join(home, ".local", "share", "cortex-ai")
}
