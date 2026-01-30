package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/embeddings"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/cortex-ai/cortex-ai/pkg/markdown"
	"github.com/spf13/cobra"
)

var importCmd = &cobra.Command{
	Use:   "import [files...]",
	Short: "Import memories from Markdown files",
	Long: `Import memories from Markdown files with YAML frontmatter.

Files must have valid frontmatter with required fields: title and type.
If no ID is provided in the frontmatter, one will be generated.

Examples:
  cortex import memory1.md memory2.md
  cortex import ./memories/*.md
  cortex import --dry-run document.md
  cortex import --force existing-memory.md`,
	Args: cobra.MinimumNArgs(1),
	RunE: runImport,
}

var (
	importForce  bool
	importDryRun bool
	importFormat string
)

func init() {
	importCmd.Flags().BoolVar(&importForce, "force", false, "Overwrite existing memories with same ID")
	importCmd.Flags().BoolVar(&importDryRun, "dry-run", false, "Validate files without importing")
	importCmd.Flags().StringVar(&importFormat, "output", "text", "Output format (text|json)")

	rootCmd.AddCommand(importCmd)
}

func runImport(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Expand glob patterns if any
	var files []string
	for _, pattern := range args {
		expanded, err := markdown.ExpandGlob(pattern)
		if err != nil {
			return fmt.Errorf("invalid pattern %s: %w", pattern, err)
		}
		if len(expanded) > 0 {
			files = append(files, expanded...)
		} else {
			// If no glob expansion, treat as literal path
			files = append(files, pattern)
		}
	}

	if len(files) == 0 {
		return fmt.Errorf("no files to import")
	}

	importer := markdown.NewImporter()

	// Dry run mode - just validate
	if importDryRun {
		return runDryRun(importer, files)
	}

	// Real import
	return runRealImport(ctx, importer, files)
}

func runDryRun(importer *markdown.Importer, files []string) error {
	results := importer.ValidateFiles(files)

	var valid, invalid int
	for _, r := range results {
		if r.Error != nil {
			invalid++
		} else {
			valid++
		}
	}

	if importFormat == "json" {
		output := make([]map[string]interface{}, len(results))
		for i, r := range results {
			entry := map[string]interface{}{
				"path":  r.Path,
				"valid": r.Error == nil,
			}
			if r.Error != nil {
				entry["error"] = r.Error.Error()
			}
			output[i] = entry
		}
		result := map[string]interface{}{
			"dry_run": true,
			"valid":   valid,
			"invalid": invalid,
			"files":   output,
		}
		jsonBytes, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		fmt.Printf("Dry run validation: %d valid, %d invalid\n\n", valid, invalid)
		for _, r := range results {
			if r.Error != nil {
				fmt.Printf("  ✗ %s: %s\n", r.Path, r.Error.Error())
			} else {
				fmt.Printf("  ✓ %s\n", r.Path)
			}
		}
	}

	if invalid > 0 {
		return fmt.Errorf("%d files failed validation", invalid)
	}

	return nil
}

func runRealImport(ctx context.Context, importer *markdown.Importer, files []string) error {
	// Initialize embedder
	embedder, err := embeddings.NewOllamaEmbedder("", "nomic-embed-text", 0)
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize storage
	storageBackend, err := storage.NewGobStorage(".local/share/cortex-ai")
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer storageBackend.Close()

	// Create service
	svc := memory.NewMemoryService(storageBackend, embedder)

	// Import files
	results := importer.ImportFiles(files)

	var imported, failed, skipped int
	var importResults []map[string]interface{}

	for _, r := range results {
		entry := map[string]interface{}{
			"path": r.Path,
		}

		if r.Error != nil {
			failed++
			entry["status"] = "failed"
			entry["error"] = r.Error.Error()
			importResults = append(importResults, entry)
			continue
		}

		// Check if memory already exists
		existing, _ := storageBackend.Get(ctx, r.Memory.ID)
		if existing != nil && !importForce {
			skipped++
			entry["status"] = "skipped"
			entry["reason"] = "memory already exists (use --force to overwrite)"
			entry["id"] = r.Memory.ID
			importResults = append(importResults, entry)
			continue
		}

		// Save the memory (this will generate embedding)
		input := memory.CreateInput{
			Title:    r.Memory.Title,
			Content:  r.Memory.Content,
			Types:    r.Memory.Types,
			Tags:     r.Memory.Tags,
			Metadata: r.Memory.Metadata,
		}

		// If we're forcing overwrite and memory exists, delete first
		if existing != nil && importForce {
			if err := storageBackend.Delete(ctx, r.Memory.ID); err != nil {
				failed++
				entry["status"] = "failed"
				entry["error"] = fmt.Sprintf("failed to delete existing: %v", err)
				importResults = append(importResults, entry)
				continue
			}
		}

		mem, err := svc.Create(ctx, input)
		if err != nil {
			failed++
			entry["status"] = "failed"
			entry["error"] = err.Error()
			importResults = append(importResults, entry)
			continue
		}

		imported++
		entry["status"] = "imported"
		entry["id"] = mem.ID
		entry["title"] = mem.Title
		importResults = append(importResults, entry)
	}

	// Output results
	if importFormat == "json" {
		output := map[string]interface{}{
			"imported": imported,
			"failed":   failed,
			"skipped":  skipped,
			"files":    importResults,
		}
		jsonBytes, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		fmt.Printf("Import complete: %d imported, %d skipped, %d failed\n\n", imported, skipped, failed)
		for _, r := range importResults {
			switch r["status"] {
			case "imported":
				fmt.Printf("  ✓ %s -> %s\n", r["path"], r["id"])
			case "skipped":
				fmt.Printf("  - %s: %s\n", r["path"], r["reason"])
			case "failed":
				fmt.Printf("  ✗ %s: %s\n", r["path"], r["error"])
			}
		}
	}

	if failed > 0 {
		return fmt.Errorf("%d files failed to import", failed)
	}

	return nil
}
