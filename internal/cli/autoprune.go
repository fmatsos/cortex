package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/consolidation"
	"github.com/spf13/cobra"
)

var autopruneCmd = &cobra.Command{
	Use:   "autoprune",
	Short: "Clean and optimize the memory database",
	Long: `Autoprune cleans and optimizes the memory database.

Operations:
  --duplicates       Remove duplicate memories (similarity >= 0.92)
  --archive-episodic Archive old episodic memories (default: 90 days)
  --merge-semantic   Merge similar semantic memories (similarity >= 0.88)

If no operation flags are specified, all operations are performed.

Examples:
  cortex autoprune                              # Run all cleanup operations
  cortex autoprune --dry-run                    # Preview changes without making them
  cortex autoprune --duplicates                 # Only remove duplicates
  cortex autoprune --archive-episodic --older-than 30d  # Archive episodic older than 30 days`,
	RunE: runAutoprune,
}

var (
	autopruneDuplicates      bool
	autopruneArchiveEpisodic bool
	autopruneMergeSemantic   bool
	autopruneDryRun          bool
	autopruneOlderThan       string
	autopruneOutput          string
)

func init() {
	autopruneCmd.Flags().BoolVar(&autopruneDuplicates, "duplicates", false, "Remove duplicate memories")
	autopruneCmd.Flags().BoolVar(&autopruneArchiveEpisodic, "archive-episodic", false, "Archive old episodic memories")
	autopruneCmd.Flags().BoolVar(&autopruneMergeSemantic, "merge-semantic", false, "Merge similar semantic memories")
	autopruneCmd.Flags().BoolVar(&autopruneDryRun, "dry-run", false, "Preview changes without executing")
	autopruneCmd.Flags().StringVar(&autopruneOlderThan, "older-than", "90d", "Age threshold for archiving (e.g., 30d, 2160h)")
	autopruneCmd.Flags().StringVarP(&autopruneOutput, "output", "o", "text", "Output format (text|json)")

	rootCmd.AddCommand(autopruneCmd)
}

func runAutoprune(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Parse older-than duration
	olderThan, err := parseDuration(autopruneOlderThan)
	if err != nil {
		return fmt.Errorf("invalid older-than value: %w", err)
	}

	// Initialize embedder
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize storage
	store, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = store.Close() }()

	// Get config
	cfg := config.Global()

	// Create autoprune service
	svc := consolidation.NewAutopruneService(store, embedder, &cfg.Autoprune)

	// Build options
	opts := consolidation.AutopruneOptions{
		Duplicates:      autopruneDuplicates,
		ArchiveEpisodic: autopruneArchiveEpisodic,
		MergeSemantic:   autopruneMergeSemantic,
		DryRun:          autopruneDryRun,
		OlderThan:       olderThan,
	}

	// Run autoprune
	result, err := svc.Run(ctx, opts)
	if err != nil {
		return fmt.Errorf("autoprune failed: %w", err)
	}

	// Output
	if autopruneOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		if autopruneDryRun {
			fmt.Println("=== DRY RUN (no changes made) ===")
			fmt.Println()
		}

		fmt.Printf("Autoprune Results:\n")
		fmt.Printf("  Duplicates removed:  %d\n", result.DuplicatesRemoved)
		fmt.Printf("  Episodic archived:   %d\n", result.EpisodicArchived)
		fmt.Printf("  Semantic merged:     %d\n", result.SemanticMerged)

		if len(result.Details) > 0 {
			fmt.Println("\nDetails:")
			for _, detail := range result.Details {
				fmt.Printf("  - %s\n", detail)
			}
		}
	}

	return nil
}

// parseDuration parses a duration string that can include days (e.g., "30d", "90d")
func parseDuration(s string) (time.Duration, error) {
	// Check for day suffix
	if len(s) > 1 && s[len(s)-1] == 'd' {
		// Parse days
		var days int
		if _, err := fmt.Sscanf(s, "%dd", &days); err != nil {
			return 0, fmt.Errorf("invalid day format: %s", s)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}

	// Fall back to standard duration parsing
	return time.ParseDuration(s)
}
