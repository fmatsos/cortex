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

var searchCmd = &cobra.Command{
	Use:   "search [query]",
	Short: "Search memories semantically",
	Long: `Search memories by semantic similarity.

Examples:
  cortex search "authentication issues" --top 5
  cortex search "JWT tokens" --min-score 0.7
  cortex search "bug fix" --level episodic`,
	Args: cobra.ExactArgs(1),
	RunE: runSearch,
}

var (
	searchTop      int
	searchMinScore float64
	searchLevel    string
	searchSession  string
	searchInclude  bool
	searchJSON     bool
)

func init() {
	searchCmd.Flags().IntVarP(&searchTop, "top", "n", 5, "Number of results to return")
	searchCmd.Flags().Float64Var(&searchMinScore, "min-score", 0.5, "Minimum similarity score")
	searchCmd.Flags().StringVarP(&searchLevel, "level", "l", "", "Filter by memory level(s): working,episodic,semantic")
	searchCmd.Flags().StringVar(&searchSession, "session", "", "Filter working by session ID")
	searchCmd.Flags().BoolVar(&searchInclude, "include-obsolete", false, "Include obsolete memories")
	searchCmd.Flags().BoolVar(&searchJSON, "json", false, "Output as JSON")

	rootCmd.AddCommand(searchCmd)
}

func runSearch(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	query := args[0]

	var filterLevels []memory.MemoryLevel
	if searchLevel != "" {
		for _, l := range strings.Split(searchLevel, ",") {
			l = strings.TrimSpace(l)
			if !memory.IsValidLevel(l) {
				return fmt.Errorf("invalid level: %s", l)
			}
			filterLevels = append(filterLevels, memory.MemoryLevel(l))
		}
	}

	opts := memory.SearchOptions{
		TopK:            searchTop,
		MinScore:        searchMinScore,
		FilterLevels:    filterLevels,
		IncludeObsolete: searchInclude,
		SessionID:       searchSession,
	}

	var results []*memory.SearchResult

	if err := tui.RunWithSpinner("Searching memories…", func() error {
		embedder, err := initEmbedder()
		if err != nil {
			return fmt.Errorf("failed to initialize embedder: %w", err)
		}

		store, err := initStorage()
		if err != nil {
			return fmt.Errorf("failed to initialize storage: %w", err)
		}
		defer func() { _ = store.Close() }()

		svc := memory.NewMemoryService(store, embedder)
		results, err = svc.Search(ctx, query, opts)
		return err
	}); err != nil {
		return fmt.Errorf("search failed: %w", err)
	}

	if searchJSON {
		items := make([]output.SearchItem, len(results))
		for i, r := range results {
			items[i] = output.SearchItem{
				ID:    r.Memory.ID,
				Title: r.Memory.Title,
				Level: string(r.Memory.Level),
				Tags:  r.Memory.Tags,
				Score: r.Score,
			}
		}
		jsonBytes, _ := json.MarshalIndent(items, "", "  ")
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	if len(results) == 0 {
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render("No memories found."))
		return nil
	}

	rows := make([][]string, len(results))
	for i, r := range results {
		rows[i] = []string{
			tui.FormatScore(r.Score),
			tui.ShortID(r.Memory.ID),
			r.Memory.Title,
			tui.FormatLevel(string(r.Memory.Level)),
			tui.FormatTags(r.Memory.Tags),
		}
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderTable([]string{"SCORE", "ID", "TITLE", "LEVEL", "TAGS"}, rows))
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render(fmt.Sprintf("%d result(s)", len(results))))
	return nil
}
