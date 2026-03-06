package cli

import (
	"fmt"
	"os"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/embeddings"
	"github.com/cortex-ai/cortex-ai/internal/logging"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/spf13/cobra"
)

var configPath string

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "cortex",
	Short: "Cortex - Persistent memory for AI coding agents",
	Long: `Cortex is a CLI tool that provides persistent memory for AI coding agents.
It allows storing, retrieving, and searching memories using semantic similarity.`,
	Version: "0.0.1",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Initialize configuration with custom config file if provided
		if err := config.Initialize(configPath); err != nil {
			return err
		}
		// Logging is ancillary; a misconfigured log path or invalid level must
		// not prevent commands from running (e.g. `completion`, `config path`).
		if err := logging.Initialize(config.Global().Logging); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "warning: logging disabled: %v\n", err)
		}
		return nil
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&configPath, "config", "", "", "Path to config file")
}

// GetConfigPath returns the current config file path (for commands that need to display it)
func GetConfigPath() string {
	return configPath
}

// initStorage initializes storage from the global configuration.
// The backend is selected by cfg.Storage.Backend (default: "gob").
func initStorage() (storage.Storage, error) {
	cfg := config.Global()
	return storage.New(cfg.Storage)
}

// initEmbedder initializes the embedder from the global configuration
func initEmbedder() (memory.Embedder, error) {
	cfg := config.Global()
	return embeddings.NewOllamaEmbedder(
		cfg.Embeddings.Endpoint,
		cfg.Embeddings.Model,
		cfg.Embeddings.Timeout,
		cfg.Embeddings.ChunkSize,
		cfg.Embeddings.ChunkOverlap,
		cfg.Embeddings.ChunkStrategy,
	)
}
