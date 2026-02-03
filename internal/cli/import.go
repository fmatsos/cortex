package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	"github.com/cortex-ai/cortex-ai/pkg/markdown"
	"github.com/spf13/cobra"
)

var importCmd = &cobra.Command{
	Use:   "import [files...]",
	Short: "Import memories from files (JSON by default, Markdown supported)",
	Long: `Import memories from JSON or Markdown files.
JSON files (.json) are the default format. Markdown files (.md) with YAML frontmatter are also supported.

Files must have required fields: title and level.
If no ID is provided, one will be generated.

Examples:
  cortex import memory1.json memory2.json
  cortex import ./memories/*.json
  cortex import --format markdown memory.md
  cortex import --dry-run document.json
  cortex import --force existing-memory.json`,
	Args: cobra.MinimumNArgs(1),
	RunE: runImport,
}

var (
	importForce      bool
	importDryRun     bool
	importFormat     string
	importFileFormat string
)

func init() {
	importCmd.Flags().BoolVar(&importForce, "force", false, "Overwrite existing memories with same ID")
	importCmd.Flags().BoolVar(&importDryRun, "dry-run", false, "Validate files without importing")
	importCmd.Flags().StringVar(&importFormat, "output", "text", "Output format (text|json)")
	importCmd.Flags().StringVarP(&importFileFormat, "format", "f", "", "File format (json|markdown). Auto-detected by extension if not specified")

	rootCmd.AddCommand(importCmd)
}

func runImport(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Expand glob patterns if any
	var files []string
	for _, pattern := range args {
		// Try JSON glob first
		jsonExpanded, err := pkgjson.ExpandGlob(pattern)
		if err != nil {
			return fmt.Errorf("invalid pattern %s: %w", pattern, err)
		}
		if len(jsonExpanded) > 0 {
			files = append(files, jsonExpanded...)
			continue
		}

		// Try Markdown glob
		mdExpanded, err := markdown.ExpandGlob(pattern)
		if err != nil {
			return fmt.Errorf("invalid pattern %s: %w", pattern, err)
		}
		if len(mdExpanded) > 0 {
			files = append(files, mdExpanded...)
			continue
		}

		// If no glob expansion, treat as literal path
		files = append(files, pattern)
	}

	if len(files) == 0 {
		return fmt.Errorf("no files to import")
	}

	// Dry run mode - just validate
	if importDryRun {
		return runDryRun(files)
	}

	// Real import
	return runRealImport(ctx, files)
}

// ImportFileResult represents the result of importing a single file
type ImportFileResult struct {
	Path   string
	Memory *memory.Memory
	Error  error
}

// detectFileFormat detects the format of a file based on extension or flag
func detectFileFormat(path string) string {
	if importFileFormat != "" {
		return importFileFormat
	}
	ext := filepath.Ext(path)
	if ext == ".md" || ext == ".markdown" {
		return "markdown"
	}
	return "json" // Default to JSON
}

// validateFile validates a single file
func validateFile(path string) error {
	format := detectFileFormat(path)
	if format == "markdown" {
		return markdown.NewImporter().ValidateFile(path)
	}
	return pkgjson.NewImporter().ValidateFile(path)
}

// importFile imports a single file
func importFile(path string) (*memory.Memory, error) {
	format := detectFileFormat(path)
	if format == "markdown" {
		return markdown.NewImporter().ImportFile(path)
	}
	return pkgjson.NewImporter().ImportFile(path)
}

func runDryRun(files []string) error {
	var valid, invalid int
	var results []ImportFileResult

	for _, path := range files {
		err := validateFile(path)
		results = append(results, ImportFileResult{
			Path:  path,
			Error: err,
		})
		if err != nil {
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

func runRealImport(ctx context.Context, files []string) error {
	// Initialize embedder from config
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize storage from config
	storageBackend, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = storageBackend.Close() }()

	// Create service
	svc := memory.NewMemoryService(storageBackend, embedder)

	var imported, failed, skipped int
	var importResults []map[string]interface{}

	for _, path := range files {
		entry := map[string]interface{}{
			"path": path,
		}

		// Import file based on format
		mem, err := importFile(path)
		if err != nil {
			failed++
			entry["status"] = "failed"
			entry["error"] = err.Error()
			importResults = append(importResults, entry)
			continue
		}

		// Check if memory already exists
		existing, _ := storageBackend.Get(ctx, mem.ID)
		if existing != nil && !importForce {
			skipped++
			entry["status"] = "skipped"
			entry["reason"] = "memory already exists (use --force to overwrite)"
			entry["id"] = mem.ID
			importResults = append(importResults, entry)
			continue
		}

		// Save the memory (this will generate embedding)
		input := memory.CreateInput{
			Title:     mem.Title,
			Content:   mem.Content,
			Level:     mem.Level,
			Tags:      mem.Tags,
			SessionID: mem.Context.SessionID,
			Source:    mem.Context.Source,
			TaskID:    mem.Context.TaskID,
			Author:    mem.Context.Author,
		}

		// If we're forcing overwrite and memory exists, delete first
		if existing != nil && importForce {
			if err := storageBackend.Delete(ctx, mem.ID); err != nil {
				failed++
				entry["status"] = "failed"
				entry["error"] = fmt.Sprintf("failed to delete existing: %v", err)
				importResults = append(importResults, entry)
				continue
			}
		}

		createdMem, err := svc.Create(ctx, input)
		if err != nil {
			failed++
			entry["status"] = "failed"
			entry["error"] = err.Error()
			importResults = append(importResults, entry)
			continue
		}

		imported++
		entry["status"] = "imported"
		entry["id"] = createdMem.ID
		entry["title"] = createdMem.Title
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
