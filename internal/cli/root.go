package cli

import (
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/embeddings"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/spf13/cobra"
)

var (
	configPath     string
	storageBackend string
	verbosity      int
)

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

		logConfigDetails()
		return nil
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.Flags().Bool("version", false, "Show version information")
	rootCmd.PersistentFlags().StringVarP(&configPath, "config", "", "", "Path to config file")
	rootCmd.PersistentFlags().StringVar(&storageBackend, "storage", "gob", "Storage backend (gob|sqlite)")
	rootCmd.PersistentFlags().CountVarP(&verbosity, "verbose", "v", "Verbose output (repeat for more detail: -vvv)")
}

// GetConfigPath returns the current config file path (for commands that need to display it)
func GetConfigPath() string {
	return configPath
}

// initStorage initializes storage from the global configuration
func initStorage() (*storage.GobStorage, error) {
	cfg := config.Global()
	path := filepath.Join(cfg.Storage.Path, "memories.gob")
	verbosef(2, "Storage backend: %s (mode=%s)", cfg.Storage.Backend, cfg.Storage.Mode)
	verbosef(2, "Storage path: %s", path)
	return storage.NewGobStorage(path)
}

// initEmbedder initializes the embedder from the global configuration
func initEmbedder() (embeddings.Embedder, error) {
	cfg := config.Global()
	verbosef(2, "Embeddings provider: %s", cfg.Embeddings.Provider)
	verbosef(2, "Embeddings model: %s", cfg.Embeddings.Model)
	verbosef(2, "Embeddings endpoint: %s", cfg.Embeddings.Endpoint)
	verbosef(3, "Embeddings timeout: %s", cfg.Embeddings.Timeout)
	verbosef(3, "Embeddings chunking: size=%d overlap=%d strategy=%s", cfg.Embeddings.ChunkSize, cfg.Embeddings.ChunkOverlap, cfg.Embeddings.ChunkStrategy)
	return embeddings.NewOllamaEmbedder(
		cfg.Embeddings.Endpoint,
		cfg.Embeddings.Model,
		cfg.Embeddings.Timeout,
		cfg.Embeddings.ChunkSize,
		cfg.Embeddings.ChunkOverlap,
		cfg.Embeddings.ChunkStrategy,
	)
}
