package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/schemas"
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

var configSchemaCmd = &cobra.Command{
	Use:   "schema [type]",
	Short: "Show or export JSON schema for configuration templates",
	Long: `Display or export the JSON schema for configuration templates.

Available schemas:
  markdown   - Markdown export template schema

Examples:
  cortex config schema markdown              # Show Markdown template schema
  cortex config schema markdown -o schema.json  # Export schema to file`,
	Args: cobra.ExactArgs(1),
	RunE: runConfigSchema,
}

var configTemplateCmd = &cobra.Command{
	Use:   "template",
	Short: "Template management commands",
	Long:  `Commands for managing and validating configuration templates.`,
}

var configTemplateValidateCmd = &cobra.Command{
	Use:   "validate <file>",
	Short: "Validate a custom template configuration file",
	Long: `Validate a custom Markdown template configuration file against the schema.

Supports JSON (.json) and YAML (.yaml, .yml) files.

Examples:
  cortex config template validate my-template.json
  cortex config template validate my-template.yaml`,
	Args: cobra.ExactArgs(1),
	RunE: runConfigTemplateValidate,
}

var (
	configOutputFormat string
	schemaOutputFile   string
)

func init() {
	configCmd.Flags().StringVar(&configOutputFormat, "output", "yaml", "Output format (yaml|json|text)")

	configSchemaCmd.Flags().StringVarP(&schemaOutputFile, "output", "o", "", "Export schema to file")

	configTemplateCmd.AddCommand(configTemplateValidateCmd)

	configCmd.AddCommand(configInitCmd)
	configCmd.AddCommand(configPathCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSchemaCmd)
	configCmd.AddCommand(configTemplateCmd)

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
		_, _ = fmt.Fprintln(w, "Configuration:")
		_, _ = fmt.Fprintln(w, "")
		_, _ = fmt.Fprintln(w, "[Storage]")
		_, _ = fmt.Fprintf(w, "  Backend:\t%s\n", cfg.Storage.Backend)
		_, _ = fmt.Fprintf(w, "  Path:\t%s\n", cfg.Storage.Path)
		_, _ = fmt.Fprintln(w, "")
		_, _ = fmt.Fprintln(w, "[Embeddings]")
		_, _ = fmt.Fprintf(w, "  Provider:\t%s\n", cfg.Embeddings.Provider)
		_, _ = fmt.Fprintf(w, "  Model:\t%s\n", cfg.Embeddings.Model)
		_, _ = fmt.Fprintf(w, "  Endpoint:\t%s\n", cfg.Embeddings.Endpoint)
		_, _ = fmt.Fprintf(w, "  Timeout:\t%s\n", cfg.Embeddings.Timeout)
		_, _ = fmt.Fprintln(w, "")
		_, _ = fmt.Fprintln(w, "[Search]")
		_, _ = fmt.Fprintf(w, "  Top K:\t%d\n", cfg.Search.TopK)
		_, _ = fmt.Fprintf(w, "  Min Score:\t%.2f\n", cfg.Search.MinScore)
		_, _ = fmt.Fprintf(w, "  Include Obsolete:\t%v\n", cfg.Search.IncludeObsolete)
		_, _ = fmt.Fprintln(w, "")
		_, _ = fmt.Fprintln(w, "[Output]")
		_, _ = fmt.Fprintf(w, "  Format:\t%s\n", cfg.Output.Format)
		_, _ = fmt.Fprintf(w, "  Colors:\t%v\n", cfg.Output.Colors)
		_ = w.Flush()

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

func runConfigSchema(cmd *cobra.Command, args []string) error {
	schemaType := args[0]

	var data []byte
	var err error

	switch schemaType {
	case "markdown":
		data, err = schemas.LoadTemplateSchema(schemas.MarkdownTemplateSchemaFile)
		if err != nil {
			return fmt.Errorf("failed to load markdown template schema: %w", err)
		}
	default:
		return fmt.Errorf("unknown schema type: %s (available: markdown)", schemaType)
	}

	// Export to file if output flag is set
	if schemaOutputFile != "" {
		if err := os.WriteFile(schemaOutputFile, data, 0644); err != nil {
			return fmt.Errorf("failed to write schema to file: %w", err)
		}
		fmt.Printf("Schema exported to: %s\n", schemaOutputFile)
		return nil
	}

	fmt.Println(string(data))
	return nil
}

func runConfigTemplateValidate(cmd *cobra.Command, args []string) error {
	filePath := args[0]

	result, err := schemas.ValidateMarkdownTemplateFile(filePath)
	if err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	if result.Valid {
		fmt.Printf("Template file is valid: %s\n", filePath)
		return nil
	}

	fmt.Printf("Template file is invalid: %s\n\n", filePath)
	fmt.Println("Errors:")
	for _, e := range result.Errors {
		if e.Field != "" {
			fmt.Printf("  - %s: %s\n", e.Field, e.Message)
		} else {
			fmt.Printf("  - %s\n", e.Message)
		}
	}

	return fmt.Errorf("validation failed with %d error(s)", len(result.Errors))
}
