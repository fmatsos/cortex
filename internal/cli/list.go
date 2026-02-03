package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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
  cortex list --level semantic
  cortex list --include-obsolete`,
	RunE: runList,
}

var (
	listLevel           string
	listLimit           int
	listIncludeObsolete bool
	listJSON            bool
	listReverse         bool
)

func init() {
	listCmd.Flags().StringVarP(&listLevel, "level", "l", "", "Filter by level(s): working,episodic,semantic")
	listCmd.Flags().IntVar(&listLimit, "limit", 0, "Limit number of results")
	listCmd.Flags().BoolVar(&listIncludeObsolete, "include-obsolete", false, "Include obsolete memories")
	listCmd.Flags().BoolVar(&listReverse, "reverse", false, "Reverse sort order")
	listCmd.Flags().BoolVar(&listJSON, "json", false, "Output as JSON")

	rootCmd.AddCommand(listCmd)
}

func runList(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Initialize storage from config
	storageBackend, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = storageBackend.Close() }()

	var filterLevels []memory.MemoryLevel
	if listLevel != "" {
		for _, l := range strings.Split(listLevel, ",") {
			l = strings.TrimSpace(l)
			if !memory.IsValidLevel(l) {
				return fmt.Errorf("invalid level: %s", l)
			}
			filterLevels = append(filterLevels, memory.MemoryLevel(l))
		}
	}

	// List
	opts := memory.ListOptions{
		FilterLevels:    filterLevels,
		IncludeObsolete: listIncludeObsolete,
		Limit:           listLimit,
		Reverse:         listReverse,
	}

	memories, err := storageBackend.List(ctx, opts)
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
				Level:     string(m.Level),
				Tags:      m.Tags,
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
		_, _ = fmt.Fprintln(w, "LEVEL\tID\tTITLE\tCREATED")
		for _, m := range memories {
			_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
				m.Level,
				m.ID[:8]+"...",
				m.Title,
				m.CreatedAt.Format("2006-01-02 15:04"))
		}
		_ = w.Flush()
	}

	return nil
}
