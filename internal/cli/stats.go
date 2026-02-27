package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
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
	out := cmd.OutOrStdout()

	// Header
	_, _ = fmt.Fprintln(out, tui.SectionHeader("Cortex Memory Statistics"))
	_, _ = fmt.Fprintln(out)

	// Counts row
	_, _ = fmt.Fprintf(out, "  %s  %s  %s\n",
		tui.KeyValue("Total", fmt.Sprintf("%d", stats.TotalMemories)),
		tui.KeyValue("Active", tui.Success.Render(fmt.Sprintf("%d", stats.ActiveCount))),
		tui.KeyValue("Obsolete", tui.Warning.Render(fmt.Sprintf("%d", stats.ObsoleteCount))),
	)
	_, _ = fmt.Fprintln(out)

	// By level
	_, _ = fmt.Fprintln(out, "  "+tui.Label.Render("By level:"))
	for _, level := range memory.ValidMemoryLevels {
		count := stats.MemoriesByLevel[string(level)]
		bar := statsBar(count, stats.TotalMemories, 20)
		_, _ = fmt.Fprintf(out, "    %s  %s  %d\n",
			tui.FormatLevel(string(level)),
			bar,
			count,
		)
	}
	_, _ = fmt.Fprintln(out)

	// Dates
	createdStr := "-"
	if stats.DatabaseCreated != nil {
		createdStr = stats.DatabaseCreated.Format("2006-01-02 15:04:05")
	}
	lastStr := "-"
	if stats.LastRecordDate != nil {
		lastStr = stats.LastRecordDate.Format("2006-01-02 15:04:05")
	}
	_, _ = fmt.Fprintln(out, "  "+tui.KeyValue("Created", createdStr))
	_, _ = fmt.Fprintln(out, "  "+tui.KeyValue("Last record", lastStr))
	_, _ = fmt.Fprintln(out)

	// Storage
	_, _ = fmt.Fprintln(out, "  "+tui.KeyValue("Storage", stats.StoragePath))
	if info, err := os.Stat(stats.StoragePath); err == nil {
		_, _ = fmt.Fprintln(out, "  "+tui.KeyValue("Modified", info.ModTime().Format("2006-01-02 15:04:05")))
	}

	// Config
	cfgFile := stats.ConfigFile
	if cfgFile == "" {
		cfgFile = tui.Subtle.Render("(using defaults)")
	}
	_, _ = fmt.Fprintln(out, "  "+tui.KeyValue("Config", cfgFile))

	return nil
}

// statsBar renders a simple ASCII bar proportional to count/total.
func statsBar(count, total, width int) string {
	if total == 0 || width == 0 {
		return strings.Repeat("░", width)
	}
	filled := count * width / total
	if filled < 0 {
		filled = 0
	}
	if filled > width {
		filled = width
	}
	return tui.Success.Render(strings.Repeat("█", filled)) +
		tui.Subtle.Render(strings.Repeat("░", width-filled))
}
