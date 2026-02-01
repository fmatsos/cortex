package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"text/tabwriter"

	"github.com/cortex-ai/cortex-ai/internal/cli/output"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all memories",
	Long: `List all memories with optional filtering.

Examples:
  cortex list
  cortex list --type solution
  cortex list --include-obsolete`,
	RunE: runList,
}

var (
	listType            string
	listIncludeObsolete bool
	listJSON            bool
)

func init() {
	listCmd.Flags().StringVar(&listType, "type", "", "Filter by memory type")
	listCmd.Flags().BoolVar(&listIncludeObsolete, "include-obsolete", false, "Include obsolete memories")
	listCmd.Flags().BoolVar(&listJSON, "json", false, "Output as JSON")

	rootCmd.AddCommand(listCmd)
}

func runList(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

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

	// Parse filter type if provided
	var filterTypes []memory.MemoryType
	if listType != "" {
		if !memory.IsValidType(listType) {
			return fmt.Errorf("invalid type: %s", listType)
		}
		filterTypes = append(filterTypes, memory.MemoryType(listType))
	}

	// List
	opts := memory.ListOptions{
		IncludeObsolete: listIncludeObsolete,
		FilterTypes:     filterTypes,
		SortBy:          "created",
	}

	memories, err := svc.List(ctx, opts)
	if err != nil {
		return fmt.Errorf("failed to list memories: %w", err)
	}

	// Output
	if listJSON {
		items := make([]output.ListItem, len(memories))
		for i, m := range memories {
			items[i] = output.ListItem{
				ID:        m.ID,
				Title:     m.Title,
				Types:     m.Types,
				CreatedAt: m.CreatedAt,
				Obsolete:  m.Obsolete,
			}
		}
		jsonBytes, _ := json.MarshalIndent(items, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		if len(memories) == 0 {
			fmt.Println("No memories found")
			return nil
		}

		w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "ID\tTITLE\tTYPES\tCREATED")
		for _, m := range memories {
			status := ""
			if m.Obsolete {
				status = " (obsolete)"
			}
			_, _ = fmt.Fprintf(w, "%s\t%s%s\t%v\t%s\n",
				m.ID[:8]+"...",
				m.Title,
				status,
				m.Types,
				m.CreatedAt.Format("2006-01-02"))
		}
		_ = w.Flush()
	}

	return nil
}
