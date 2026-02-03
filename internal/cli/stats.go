package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"text/tabwriter"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/spf13/cobra"
)

var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Display database statistics",
	Long: `Display statistics about the memory database.

Shows:
  - Total number of memories
  - Number of memories by level
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
	MemoriesByLevel map[string]int `json:"memories_by_level"`
	DatabaseCreated *time.Time     `json:"database_created,omitempty"`
	LastRecordDate  *time.Time     `json:"last_record_date,omitempty"`
	ObsoleteCount   int            `json:"obsolete_count"`
	ActiveCount     int            `json:"active_count"`
	StoragePath     string         `json:"storage_path"`
	ConfigFile      string         `json:"config_file,omitempty"`
}

func runStats(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Initialize storage from config (no embedder needed for stats)
	storageBackend, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = storageBackend.Close() }()

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
	cfg := config.Global()
	stats := calculateStats(memories, filepath.Join(cfg.Storage.Path, "memories.gob"))

	// Add config file info
	stats.ConfigFile = config.GlobalConfigFileUsed()

	// Output
	if statsJSON {
		return outputStatsJSON(stats)
	}
	return outputStatsText(cmd, stats)
}

func calculateStats(memories []*memory.Memory, storagePath string) Statistics {
	stats := Statistics{
		TotalMemories:   len(memories),
		MemoriesByLevel: make(map[string]int),
		StoragePath:     storagePath,
	}

	// Initialize level counts to 0 for all levels
	for _, level := range memory.ValidMemoryLevels {
		stats.MemoriesByLevel[string(level)] = 0
	}

	var oldestCreated, newestUpdated time.Time

	for _, m := range memories {
		// Count by level
		stats.MemoriesByLevel[string(m.Level)]++

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

	_, _ = fmt.Fprintln(w, "=== Cortex Memory Statistics ===")
	_, _ = fmt.Fprintln(w)

	// General stats
	_, _ = fmt.Fprintf(w, "Total memories:\t%d\n", stats.TotalMemories)
	_, _ = fmt.Fprintf(w, "Active memories:\t%d\n", stats.ActiveCount)
	_, _ = fmt.Fprintf(w, "Obsolete memories:\t%d\n", stats.ObsoleteCount)
	_, _ = fmt.Fprintln(w)

	// Memories by level
	_, _ = fmt.Fprintln(w, "Memories by level:")
	for _, level := range memory.ValidMemoryLevels {
		count := stats.MemoriesByLevel[string(level)]
		_, _ = fmt.Fprintf(w, "  %s:\t%d\n", level, count)
	}
	_, _ = fmt.Fprintln(w)

	// Dates
	if stats.DatabaseCreated != nil {
		_, _ = fmt.Fprintf(w, "Database created:\t%s\n", stats.DatabaseCreated.Format("2006-01-02 15:04:05"))
	} else {
		_, _ = fmt.Fprintf(w, "Database created:\t-\n")
	}

	if stats.LastRecordDate != nil {
		_, _ = fmt.Fprintf(w, "Last record:\t%s\n", stats.LastRecordDate.Format("2006-01-02 15:04:05"))
	} else {
		_, _ = fmt.Fprintf(w, "Last record:\t-\n")
	}
	_, _ = fmt.Fprintln(w)

	// Storage info
	_, _ = fmt.Fprintf(w, "Storage path:\t%s\n", stats.StoragePath)

	// Check if storage file exists
	if _, err := os.Stat(stats.StoragePath); err == nil {
		info, err := os.Stat(stats.StoragePath)
		if err == nil {
			_, _ = fmt.Fprintf(w, "Storage file modified:\t%s\n", info.ModTime().Format("2006-01-02 15:04:05"))
		}
	}
	_, _ = fmt.Fprintln(w)

	// Config info
	if stats.ConfigFile != "" {
		_, _ = fmt.Fprintf(w, "Config file:\t%s\n", stats.ConfigFile)
	} else {
		_, _ = fmt.Fprintf(w, "Config file:\t(using defaults)\n")
	}

	_ = w.Flush()
	return nil
}
