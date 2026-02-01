package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"text/tabwriter"

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
  cortex search "bug fix" --type solution`,
	Args: cobra.ExactArgs(1),
	RunE: runSearch,
}

var (
	searchTop      int
	searchMinScore float64
	searchType     string
	searchJSON     bool
)

func init() {
	searchCmd.Flags().IntVarP(&searchTop, "top", "n", 5, "Number of results to return")
	searchCmd.Flags().Float64Var(&searchMinScore, "min-score", 0.5, "Minimum similarity score")
	searchCmd.Flags().StringVar(&searchType, "type", "", "Filter by memory type")
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
	defer storageBackend.Close()

	// Create service
	svc := memory.NewMemoryService(storageBackend, embedder)

	// Parse filter type if provided
	var filterTypes []memory.MemoryType
	if searchType != "" {
		if !memory.IsValidType(searchType) {
			return fmt.Errorf("invalid type: %s", searchType)
		}
		filterTypes = append(filterTypes, memory.MemoryType(searchType))
	}

	// Search
	opts := memory.SearchOptions{
		TopK:        searchTop,
		MinScore:    searchMinScore,
		FilterTypes: filterTypes,
	}

	results, err := svc.Search(ctx, query, opts)
	if err != nil {
		return fmt.Errorf("search failed: %w", err)
	}

	// Output
	if searchJSON {
		var jsonResults []map[string]interface{}
		for _, result := range results {
			jsonResults = append(jsonResults, map[string]interface{}{
				"id":    result.Memory.ID,
				"title": result.Memory.Title,
				"types": result.Memory.Types,
				"score": result.Score,
			})
		}
		jsonBytes, _ := json.MarshalIndent(jsonResults, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		if len(results) == 0 {
			fmt.Println("No memories found")
			return nil
		}

		w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "SCORE\tID\tTITLE\tTYPES")
		for _, result := range results {
			fmt.Fprintf(w, "%.2f\t%s\t%s\t%v\n",
				result.Score,
				result.Memory.ID[:8]+"...",
				result.Memory.Title,
				result.Memory.Types)
		}
		_ = w.Flush()
	}

	return nil
}
