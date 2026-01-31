package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage configuration",
	Long: `View and manage Cortex AI configuration.

Without subcommands, displays the current configuration.

Examples:
  cortex config              # Show current configuration
  cortex config --json       # Show configuration as JSON
  cortex config init         # Create default config file
  cortex config path         # Show config file path`,
	RunE: runConfigShow,
}

var configInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Create default configuration file",
	Long:  `Creates a default configuration file if one doesn't exist.`,
	RunE:  runConfigInit,
}

var configPathCmd = &cobra.Command{
	Use:   "path",
	Short: "Show configuration file path",
	RunE:  runConfigPath,
}

var configGetCmd = &cobra.Command{
	Use:   "get <key>",
	Short: "Get a configuration value",
	Long: `Get a specific configuration value by key.

Examples:
  cortex config get storage.backend
  cortex config get embeddings.model
  cortex config get search.top_k`,
	Args: cobra.ExactArgs(1),
	RunE: runConfigGet,
}

var (
	configOutputFormat string
)

func init() {
	configCmd.Flags().StringVar(&configOutputFormat, "output", "yaml", "Output format (yaml|json|text)")

	configCmd.AddCommand(configInitCmd)
	configCmd.AddCommand(configPathCmd)
	configCmd.AddCommand(configGetCmd)

	rootCmd.AddCommand(configCmd)
}

func runConfigShow(cmd *cobra.Command, args []string) error {
	manager := config.NewManager()
	cfg, err := manager.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	switch configOutputFormat {
	case "json":
		output, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal config: %w", err)
		}
		fmt.Println(string(output))

	case "yaml":
		output, err := yaml.Marshal(cfg)
		if err != nil {
			return fmt.Errorf("failed to marshal config: %w", err)
		}
		fmt.Print(string(output))

	case "text":
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "Configuration:")
		fmt.Fprintln(w, "")
		fmt.Fprintln(w, "[Storage]")
		fmt.Fprintf(w, "  Backend:\t%s\n", cfg.Storage.Backend)
		fmt.Fprintf(w, "  Path:\t%s\n", cfg.Storage.Path)
		fmt.Fprintln(w, "")
		fmt.Fprintln(w, "[Embeddings]")
		fmt.Fprintf(w, "  Provider:\t%s\n", cfg.Embeddings.Provider)
		fmt.Fprintf(w, "  Model:\t%s\n", cfg.Embeddings.Model)
		fmt.Fprintf(w, "  Endpoint:\t%s\n", cfg.Embeddings.Endpoint)
		fmt.Fprintf(w, "  Timeout:\t%s\n", cfg.Embeddings.Timeout)
		fmt.Fprintln(w, "")
		fmt.Fprintln(w, "[Search]")
		fmt.Fprintf(w, "  Top K:\t%d\n", cfg.Search.TopK)
		fmt.Fprintf(w, "  Min Score:\t%.2f\n", cfg.Search.MinScore)
		fmt.Fprintf(w, "  Include Obsolete:\t%v\n", cfg.Search.IncludeObsolete)
		fmt.Fprintln(w, "")
		fmt.Fprintln(w, "[Output]")
		fmt.Fprintf(w, "  Format:\t%s\n", cfg.Output.Format)
		fmt.Fprintf(w, "  Colors:\t%v\n", cfg.Output.Colors)
		w.Flush()

		// Show config file used
		if cfgFile := manager.ConfigFileUsed(); cfgFile != "" {
			fmt.Printf("\nConfig file: %s\n", cfgFile)
		} else {
			fmt.Printf("\nConfig file: (using defaults)\n")
		}

	default:
		return fmt.Errorf("unknown output format: %s", configOutputFormat)
	}

	return nil
}

func runConfigInit(cmd *cobra.Command, args []string) error {
	configPath := config.ConfigFilePath()

	// Check if file already exists
	if _, err := os.Stat(configPath); err == nil {
		fmt.Printf("Configuration file already exists: %s\n", configPath)
		return nil
	}

	if err := config.WriteDefaultConfig(); err != nil {
		return fmt.Errorf("failed to create config file: %w", err)
	}

	fmt.Printf("Created default configuration file: %s\n", configPath)
	return nil
}

func runConfigPath(cmd *cobra.Command, args []string) error {
	fmt.Println(config.ConfigFilePath())
	return nil
}

func runConfigGet(cmd *cobra.Command, args []string) error {
	key := args[0]

	manager := config.NewManager()
	if _, err := manager.Load(); err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Try to get the value
	value := manager.GetString(key)
	if value == "" {
		// Try as int
		if intVal := manager.GetInt(key); intVal != 0 {
			fmt.Println(intVal)
			return nil
		}
		// Try as float
		if floatVal := manager.GetFloat64(key); floatVal != 0 {
			fmt.Println(floatVal)
			return nil
		}
		// Try as bool (tricky because false is valid)
		boolVal := manager.GetBool(key)
		fmt.Println(boolVal)
		return nil
	}

	fmt.Println(value)
	return nil
}
