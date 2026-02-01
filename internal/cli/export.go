package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/schemas"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	"github.com/cortex-ai/cortex-ai/pkg/markdown"
	"github.com/spf13/cobra"
)

var exportCmd = &cobra.Command{
	Use:   "export [id]",
	Short: "Export memories to files (JSON by default, Markdown optional)",
	Long: `Export memories to files. JSON is the default format for better LLM parsing.
Use --format markdown for human-readable export with YAML frontmatter.

Export modes:
  - Export a single memory by ID
  - Export all memories with --all
  - Export a synthesis of related memories with --intent

Examples:
  cortex export abc-123 --output ./memories/
  cortex export --all --output ./memories/
  cortex export --all --format markdown --output ./memories/
  cortex export --intent "authentication patterns" --output ./`,
	RunE: runExport,
}

var (
	exportOutput         string
	exportAll            bool
	exportIntent         string
	exportFormat         string
	exportMemoryTemplate string
	exportSynthTemplate  string
)

func init() {
	exportCmd.Flags().StringVarP(&exportOutput, "output", "o", ".", "Output directory or file path")
	exportCmd.Flags().BoolVar(&exportAll, "all", false, "Export all memories")
	exportCmd.Flags().StringVar(&exportIntent, "intent", "", "Export synthesis based on semantic search")
	exportCmd.Flags().StringVarP(&exportFormat, "format", "f", "json", "Export format (json|markdown)")
	exportCmd.Flags().StringVar(&exportMemoryTemplate, "memory-template", "", "Custom template file for memory export (.yaml, .json, or .tmpl)")
	exportCmd.Flags().StringVar(&exportSynthTemplate, "synthesis-template", "", "Custom template file for synthesis export (.yaml or .json)")

	rootCmd.AddCommand(exportCmd)
}

func runExport(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Validate arguments
	hasID := len(args) > 0
	if !hasID && !exportAll && exportIntent == "" {
		return fmt.Errorf("please provide a memory ID, --all, or --intent")
	}

	// Validate format
	if exportFormat != "json" && exportFormat != "markdown" {
		return fmt.Errorf("invalid format: %s (must be json or markdown)", exportFormat)
	}

	// Initialize storage from config
	storageBackend, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = storageBackend.Close() }()

	// Export by intent (synthesis)
	if exportIntent != "" {
		return exportSynthesis(ctx, storageBackend)
	}

	// Export all memories
	if exportAll {
		return exportAllMemories(ctx, storageBackend)
	}

	// Export single memory by ID
	return exportSingleMemory(ctx, storageBackend, args[0])
}

func exportSingleMemory(ctx context.Context, store storage.Storage, id string) error {
	mem, err := store.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get memory: %w", err)
	}

	var path string

	if exportFormat == "markdown" {
		// Load template configuration
		tmplCfg, err := loadTemplateConfig()
		if err != nil {
			return fmt.Errorf("failed to load template config: %w", err)
		}

		// Export as Markdown with YAML frontmatter
		exporter := markdown.NewExporterWithConfig(exportOutput, tmplCfg)
		path, err = exporter.ExportMemory(mem)
		if err != nil {
			return fmt.Errorf("failed to export memory: %w", err)
		}
		fmt.Printf("Exported memory to: %s\n", path)
	} else {
		// Export as JSON (default)
		exporter := pkgjson.NewExporter(exportOutput)
		path, err = exporter.ExportMemory(mem)
		if err != nil {
			return fmt.Errorf("failed to export memory: %w", err)
		}
		output := map[string]interface{}{
			"path":    path,
			"id":      mem.ID,
			"title":   mem.Title,
			"success": true,
		}
		jsonBytes, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(jsonBytes))
	}

	return nil
}

func exportAllMemories(ctx context.Context, store storage.Storage) error {
	memories, err := store.List(ctx, memory.ListOptions{
		IncludeObsolete: true,
	})
	if err != nil {
		return fmt.Errorf("failed to list memories: %w", err)
	}

	if len(memories) == 0 {
		fmt.Println("No memories to export")
		return nil
	}

	var paths []string

	if exportFormat == "markdown" {
		// Load template configuration
		tmplCfg, err := loadTemplateConfig()
		if err != nil {
			return fmt.Errorf("failed to load template config: %w", err)
		}

		// Export as Markdown with YAML frontmatter
		exporter := markdown.NewExporterWithConfig(exportOutput, tmplCfg)
		paths, err = exporter.ExportAll(memories)
		if err != nil {
			return fmt.Errorf("failed to export memories: %w", err)
		}
		fmt.Printf("Exported %d memories:\n", len(paths))
		for _, p := range paths {
			fmt.Printf("  - %s\n", p)
		}
	} else {
		// Export as JSON (default)
		exporter := pkgjson.NewExporter(exportOutput)
		paths, err = exporter.ExportAll(memories)
		if err != nil {
			return fmt.Errorf("failed to export memories: %w", err)
		}
		output := map[string]interface{}{
			"count": len(paths),
			"paths": paths,
		}
		jsonBytes, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(jsonBytes))
	}

	return nil
}

func exportSynthesis(ctx context.Context, store storage.Storage) error {
	// Initialize embedder from config for search
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Create service for semantic search
	svc := memory.NewMemoryService(store, embedder)

	// Search memories related to intent
	results, err := svc.Search(ctx, exportIntent, memory.SearchOptions{
		TopK:     10,
		MinScore: 0.5,
	})
	if err != nil {
		return fmt.Errorf("failed to search memories: %w", err)
	}

	if len(results) == 0 {
		return fmt.Errorf("no memories found matching intent: %s", exportIntent)
	}

	var path string

	if exportFormat == "markdown" {
		// Load template configuration
		tmplCfg, err := loadTemplateConfig()
		if err != nil {
			return fmt.Errorf("failed to load template config: %w", err)
		}

		// Export as Markdown
		exporter := markdown.NewExporterWithConfig(exportOutput, tmplCfg)
		path, err = exporter.ExportSynthesis(exportIntent, results)
		if err != nil {
			return fmt.Errorf("failed to export synthesis: %w", err)
		}
		fmt.Printf("Exported synthesis to: %s\n", path)
		fmt.Printf("Based on %d memories matching '%s'\n", len(results), exportIntent)
	} else {
		// Export as JSON (default)
		exporter := pkgjson.NewExporter(exportOutput)
		path, err = exporter.ExportSynthesis(exportIntent, results)
		if err != nil {
			return fmt.Errorf("failed to export synthesis: %w", err)
		}
		sources := make([]map[string]interface{}, len(results))
		for i, r := range results {
			sources[i] = map[string]interface{}{
				"id":    r.Memory.ID,
				"title": r.Memory.Title,
				"score": r.Score,
			}
		}
		output := map[string]interface{}{
			"path":    path,
			"intent":  exportIntent,
			"count":   len(results),
			"sources": sources,
		}
		jsonBytes, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(jsonBytes))
	}

	return nil
}

// loadTemplateConfig loads template configuration from files or config
func loadTemplateConfig() (*config.MarkdownTemplateConfig, error) {
	// Start with defaults
	tmplCfg := config.DefaultMarkdownTemplateConfig()

	// Load from config file if templates are configured
	globalCfg := config.Global()
	if globalCfg.Templates.Markdown != nil {
		// Merge with config from file
		if globalCfg.Templates.Markdown.Memory != nil && tmplCfg.Memory != nil {
			if globalCfg.Templates.Markdown.Memory.Body != "" {
				tmplCfg.Memory.Body = globalCfg.Templates.Markdown.Memory.Body
			}
			if globalCfg.Templates.Markdown.Memory.Frontmatter != nil {
				// Merge frontmatter settings
				if globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeID != nil {
					tmplCfg.Memory.Frontmatter.IncludeID = globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeID
				}
				if globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeDates != nil {
					tmplCfg.Memory.Frontmatter.IncludeDates = globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeDates
				}
				if globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeMetadata != nil {
					tmplCfg.Memory.Frontmatter.IncludeMetadata = globalCfg.Templates.Markdown.Memory.Frontmatter.IncludeMetadata
				}
				if globalCfg.Templates.Markdown.Memory.Frontmatter.DateFormat != "" {
					tmplCfg.Memory.Frontmatter.DateFormat = globalCfg.Templates.Markdown.Memory.Frontmatter.DateFormat
				}
			}
		}
		if globalCfg.Templates.Markdown.Synthesis != nil {
			tmplCfg.Synthesis = globalCfg.Templates.Markdown.Synthesis
		}
	}

	// Override with command-line template files
	if exportMemoryTemplate != "" {
		memTmpl, err := schemas.LoadMemoryTemplateFromFile(exportMemoryTemplate)
		if err != nil {
			return nil, fmt.Errorf("failed to load memory template: %w", err)
		}
		// Validate the template
		result, err := schemas.ValidateMemoryTemplateFile(exportMemoryTemplate)
		if err != nil {
			return nil, fmt.Errorf("failed to validate memory template: %w", err)
		}
		if !result.Valid {
			return nil, fmt.Errorf("invalid memory template: %v", result.Errors)
		}
		tmplCfg.Memory = memTmpl
	}

	if exportSynthTemplate != "" {
		synthTmpl, err := schemas.LoadSynthesisTemplateFromFile(exportSynthTemplate)
		if err != nil {
			return nil, fmt.Errorf("failed to load synthesis template: %w", err)
		}
		// Validate the template
		result, err := schemas.ValidateSynthesisTemplateFile(exportSynthTemplate)
		if err != nil {
			return nil, fmt.Errorf("failed to validate synthesis template: %w", err)
		}
		if !result.Valid {
			return nil, fmt.Errorf("invalid synthesis template: %v", result.Errors)
		}
		tmplCfg.Synthesis = synthTmpl
	}

	return tmplCfg, nil
}
