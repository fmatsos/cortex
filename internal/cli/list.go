package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/cli/output"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
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
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	if len(memories) == 0 {
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render("No memories found."))
		return nil
	}

	rows := make([][]string, len(memories))
	for i, m := range memories {
		obsoleteFlag := ""
		if m.Obsolete {
			obsoleteFlag = tui.Warning.Render("obsolete")
		}
		rows[i] = []string{
			tui.FormatLevel(string(m.Level)),
			tui.ShortID(m.ID),
			m.Title,
			m.CreatedAt.Format("2006-01-02 15:04"),
			obsoleteFlag,
		}
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderTable([]string{"LEVEL", "ID", "TITLE", "CREATED", "FLAGS"}, rows))
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render(fmt.Sprintf("%d memor%s", len(memories), func() string {
		if len(memories) == 1 {
			return "y"
		}
		return "ies"
	}())))
	return nil
}
