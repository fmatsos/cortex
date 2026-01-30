package cli

import (
	"github.com/spf13/cobra"
)

var (
	configPath string
	storageBackend string
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "cortex",
	Short: "Cortex AI - Persistent memory for AI coding agents",
	Long: `Cortex AI is a CLI tool that provides persistent memory for AI coding agents.
It allows storing, retrieving, and searching memories using semantic similarity.`,
	Version: "0.0.1",
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "", "Path to config file")
	rootCmd.PersistentFlags().StringVar(&storageBackend, "storage", "gob", "Storage backend (gob|sqlite)")
}
