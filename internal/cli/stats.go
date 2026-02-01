package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/spf13/cobra"
)

var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Display database statistics",
	Long: `Display statistics about the memory database.

Shows:
  - Total number of memories
  - Number of memories by type
  - Number of vector chunks (embeddings)
  - Database creation date
  - Date of the last record

Examples:
  cortex stats
  cortex stats --json`,
	RunE: runStats,
}

var statsJSON bool

func init() {
	statsCmd.Flags().BoolVar(&statsJSON, "json", false, "Output as JSON")

	rootCmd.AddCommand(statsCmd)
}

// Statistics represents the statistics data
type Statistics struct {
	TotalMemories   int            `json:"total_memories"`
	MemoriesByType  map[string]int `json:"memories_by_type"`
	TotalChunks     int            `json:"total_chunks"`
	DatabaseCreated *time.Time     `json:"database_created,omitempty"`
	LastRecordDate  *time.Time     `json:"last_record_date,omitempty"`
	ObsoleteCount   int            `json:"obsolete_count"`
	ActiveCount     int            `json:"active_count"`
	StorageMode     string         `json:"storage_mode"`
	StoragePath     string         `json:"storage_path"`
}

func runStats(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Initialize storage (no embedder needed for stats)
	storageBackend, err := storage.NewGobStorage(".local/share/cortex-ai")
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer storageBackend.Close()

	// Get all memories including obsolete
	opts := memory.ListOptions{
		IncludeObsolete: true,
		SortBy:          "created",
	}

	memories, err := storageBackend.List(ctx, opts)
	if err != nil {
		return fmt.Errorf("failed to list memories: %w", err)
	}

	// Calculate statistics
	stats := calculateStats(memories, storageBackend)

	// Output
	if statsJSON {
		return outputStatsJSON(stats)
	}
	return outputStatsText(cmd, stats)
}

func calculateStats(memories []*memory.Memory, storageBackend *storage.GobStorage) Statistics {
	stats := Statistics{
		TotalMemories:  len(memories),
		MemoriesByType: make(map[string]int),
		TotalChunks:    storageBackend.MemoryCount(),
		StorageMode:    string(storageBackend.Mode()),
		StoragePath:    storageBackend.FilePath(),
	}

	// Initialize type counts to 0 for all types
	for _, t := range memory.ValidMemoryTypes {
		stats.MemoriesByType[string(t)] = 0
	}

	var oldestCreated, newestUpdated time.Time

	for _, m := range memories {
		// Count by type
		for _, t := range m.Types {
			stats.MemoriesByType[string(t)]++
		}

		// Count obsolete vs active
		if m.Obsolete {
			stats.ObsoleteCount++
		} else {
			stats.ActiveCount++
		}

		// Track oldest and newest dates
		if oldestCreated.IsZero() || m.CreatedAt.Before(oldestCreated) {
			oldestCreated = m.CreatedAt
		}
		if newestUpdated.IsZero() || m.UpdatedAt.After(newestUpdated) {
			newestUpdated = m.UpdatedAt
		}
	}

	if !oldestCreated.IsZero() {
		stats.DatabaseCreated = &oldestCreated
	}
	if !newestUpdated.IsZero() {
		stats.LastRecordDate = &newestUpdated
	}

	return stats
}

func outputStatsJSON(stats Statistics) error {
	jsonBytes, err := json.MarshalIndent(stats, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal stats: %w", err)
	}
	fmt.Println(string(jsonBytes))
	return nil
}

func outputStatsText(cmd *cobra.Command, stats Statistics) error {
	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)

	fmt.Fprintln(w, "=== Cortex Memory Statistics ===")
	fmt.Fprintln(w)

	// General stats
	fmt.Fprintf(w, "Total memories:\t%d\n", stats.TotalMemories)
	fmt.Fprintf(w, "Active memories:\t%d\n", stats.ActiveCount)
	fmt.Fprintf(w, "Obsolete memories:\t%d\n", stats.ObsoleteCount)
	fmt.Fprintf(w, "Vector chunks:\t%d\n", stats.TotalChunks)
	fmt.Fprintln(w)

	// Memories by type
	fmt.Fprintln(w, "Memories by type:")
	for _, t := range memory.ValidMemoryTypes {
		count := stats.MemoriesByType[string(t)]
		fmt.Fprintf(w, "  %s:\t%d\n", t, count)
	}
	fmt.Fprintln(w)

	// Dates
	if stats.DatabaseCreated != nil {
		fmt.Fprintf(w, "Database created:\t%s\n", stats.DatabaseCreated.Format("2006-01-02 15:04:05"))
	} else {
		fmt.Fprintf(w, "Database created:\t-\n")
	}

	if stats.LastRecordDate != nil {
		fmt.Fprintf(w, "Last record:\t%s\n", stats.LastRecordDate.Format("2006-01-02 15:04:05"))
	} else {
		fmt.Fprintf(w, "Last record:\t-\n")
	}
	fmt.Fprintln(w)

	// Storage info
	fmt.Fprintf(w, "Storage mode:\t%s\n", stats.StorageMode)
	fmt.Fprintf(w, "Storage path:\t%s\n", stats.StoragePath)

	// Check if storage file exists
	if _, err := os.Stat(stats.StoragePath); err == nil {
		info, err := os.Stat(stats.StoragePath)
		if err == nil {
			fmt.Fprintf(w, "Storage file modified:\t%s\n", info.ModTime().Format("2006-01-02 15:04:05"))
		}
	}

	_ = w.Flush()
	return nil
}
