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

	// Search
	opts := memory.SearchOptions{
		TopK:            searchTop,
		MinScore:        searchMinScore,
		FilterLevels:    filterLevels,
		IncludeObsolete: searchInclude,
		SessionID:       searchSession,
	}

	results, err := svc.Search(ctx, query, opts)
	if err != nil {
		return fmt.Errorf("search failed: %w", err)
	}

	// Output
	if searchJSON {
		items := make([]output.SearchItem, len(results))
		for i, result := range results {
			items[i] = output.SearchItem{
				ID:    result.Memory.ID,
				Title: result.Memory.Title,
				Level: string(result.Memory.Level),
				Tags:  result.Memory.Tags,
				Score: result.Score,
			}
		}
		jsonBytes, _ := json.MarshalIndent(items, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		if len(results) == 0 {
			fmt.Println("No memories found")
			return nil
		}

		w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "SCORE\tID\tTITLE\tLEVEL")
		for _, result := range results {
			_, _ = fmt.Fprintf(w, "%.2f\t%s\t%s\t%v\n",
				result.Score,
				result.Memory.ID[:8]+"...",
				result.Memory.Title,
				result.Memory.Level)
		}
		_ = w.Flush()
	}

	return nil
}
