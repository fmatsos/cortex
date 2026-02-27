package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/consolidation"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
	"github.com/cortex-ai/cortex-ai/pkg/session"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

var consolidateCmd = &cobra.Command{
	Use:   "consolidate",
	Short: "Consolidate information into memory",
	Long: `Consolidate a synthesis into the memory system.

Memory levels:
  working   - Temporary session-scoped memory (auto-deleted after session)
  episodic  - Historical events, decisions, incidents
  semantic  - General knowledge, architecture, conventions

Examples:
  cortex consolidate --level working --content "Current task: implementing auth" --session mySession
  cortex consolidate --level episodic --content "Fixed critical bug in payment system"
  cortex consolidate --level semantic --content "API endpoints follow RESTful conventions"`,
	RunE: runConsolidate,
}

var (
	consolidateLevel     string
	consolidateContent   string
	consolidateContext   string
	consolidateForce     bool
	consolidateOutput    string
	consolidateSessionID string
	consolidateTags      []string
	consolidateSource    string
)

func init() {
	consolidateCmd.Flags().StringVarP(&consolidateLevel, "level", "l", "", "Memory level: working|episodic|semantic (required)")
	consolidateCmd.Flags().StringVar(&consolidateContent, "content", "", "Content to consolidate (required)")
	consolidateCmd.Flags().StringVar(&consolidateContext, "context", "", "Context JSON (optional)")
	consolidateCmd.Flags().BoolVarP(&consolidateForce, "force", "f", false, "Bypass duplicate check")
	consolidateCmd.Flags().StringVarP(&consolidateOutput, "output", "o", "text", "Output format (text|json)")
	consolidateCmd.Flags().StringVar(&consolidateSessionID, "session", "", "Session ID (auto-generated if not provided)")
	consolidateCmd.Flags().StringSliceVar(&consolidateTags, "tags", nil, "Tags for the memory")
	consolidateCmd.Flags().StringVar(&consolidateSource, "source", "manual", "Source: manual|auto|llm")

	_ = consolidateCmd.MarkFlagRequired("level")
	_ = consolidateCmd.MarkFlagRequired("content")

	rootCmd.AddCommand(consolidateCmd)
}

func runConsolidate(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	if !memory.IsValidLevel(consolidateLevel) {
		return fmt.Errorf("invalid level: %s (must be working|episodic|semantic)", consolidateLevel)
	}

	cfg := config.Global()

	consolidationCtx := memory.MemoryContext{
		SessionID: consolidateSessionID,
		Timestamp: time.Now(),
		Source:    consolidateSource,
		Tags:      consolidateTags,
	}

	if consolidationCtx.SessionID == "" {
		deriver := session.NewDeriver(&cfg.Session)
		derivedSession, err := deriver.DeriveOrUseProvided(ctx, "")
		if err == nil && derivedSession != "" {
			consolidationCtx.SessionID = derivedSession
		} else {
			consolidationCtx.SessionID = uuid.New().String()
		}
	}

	if consolidateContext != "" {
		var extraCtx memory.MemoryContext
		if err := json.Unmarshal([]byte(consolidateContext), &extraCtx); err != nil {
			return fmt.Errorf("invalid context JSON: %w", err)
		}
		if extraCtx.TaskID != "" {
			consolidationCtx.TaskID = extraCtx.TaskID
		}
		if extraCtx.Author != "" {
			consolidationCtx.Author = extraCtx.Author
		}
		if len(extraCtx.Tags) > 0 {
			consolidationCtx.Tags = append(consolidationCtx.Tags, extraCtx.Tags...)
		}
		if len(extraCtx.RelatedMemories) > 0 {
			consolidationCtx.RelatedMemories = extraCtx.RelatedMemories
		}
	}

	input := memory.ConsolidateInput{
		Synthesis: consolidateContent,
		Level:     memory.MemoryLevel(consolidateLevel),
		Context:   consolidationCtx,
		Force:     consolidateForce,
	}

	var result *memory.ConsolidateResult

	if err := tui.RunWithSpinner("Consolidating memory…", func() error {
		embedder, err := initEmbedder()
		if err != nil {
			return fmt.Errorf("failed to initialize embedder: %w", err)
		}

		store, err := initStorage()
		if err != nil {
			return fmt.Errorf("failed to initialize storage: %w", err)
		}
		defer func() { _ = store.Close() }()

		svc := consolidation.NewService(store, embedder, &cfg.Consolidation)
		result, err = svc.Consolidate(ctx, input)
		return err
	}); err != nil {
		return fmt.Errorf("consolidation failed: %w", err)
	}

	if consolidateOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(result, "", "  ")
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	actionStyle := tui.Success
	if result.Action == "merged" {
		actionStyle = tui.Warning
	}

	lines := [][2]string{
		{"Action", actionStyle.Render(result.Action)},
		{"Memory ID", result.MemoryID},
	}
	if result.MergedWith != "" {
		lines = append(lines, [2]string{"Merged with", result.MergedWith})
	}
	if result.Reason != "" {
		lines = append(lines, [2]string{"Reason", tui.Subtle.Render(result.Reason)})
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderDetail("Consolidation Result", lines))
	return nil
}

// ListConsolidatedCmd lists memories by level
var listConsolidatedCmd = &cobra.Command{
	Use:   "list-consolidated",
	Short: "List memories by level",
	Long: `List memories filtered by memory level.

Examples:
  cortex list-consolidated --level working
  cortex list-consolidated --level episodic
  cortex list-consolidated --level semantic --json`,
	RunE: runListConsolidated,
}

var (
	listConsolidatedLevel  string
	listConsolidatedOutput string
)

func init() {
	listConsolidatedCmd.Flags().StringVarP(&listConsolidatedLevel, "level", "l", "", "Memory level: working|episodic|semantic")
	listConsolidatedCmd.Flags().StringVarP(&listConsolidatedOutput, "output", "o", "text", "Output format (text|json)")

	rootCmd.AddCommand(listConsolidatedCmd)
}

func runListConsolidated(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Validate level if provided
	if listConsolidatedLevel != "" && !memory.IsValidLevel(listConsolidatedLevel) {
		return fmt.Errorf("invalid level: %s (must be working|episodic|semantic)", listConsolidatedLevel)
	}

	// Initialize embedder (needed for service)
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

	// Create service
	svc := consolidation.NewService(store, embedder, &cfg.Consolidation)

	// List memories
	var memories []*memory.Memory
	if listConsolidatedLevel == "" {
		// List all levels
		for _, level := range memory.ValidMemoryLevels {
			levelMemories, err := svc.List(ctx, level)
			if err != nil {
				continue
			}
			memories = append(memories, levelMemories...)
		}
	} else {
		memories, err = svc.List(ctx, memory.MemoryLevel(listConsolidatedLevel))
		if err != nil {
			return fmt.Errorf("failed to list memories: %w", err)
		}
	}

	if listConsolidatedOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(memories, "", "  ")
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	if len(memories) == 0 {
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render("No memories found."))
		return nil
	}

	rows := make([][]string, len(memories))
	for i, m := range memories {
		rows[i] = []string{
			tui.FormatLevel(string(m.Level)),
			tui.ShortID(m.ID),
			truncate(m.Content, 60),
			m.Context.SessionID,
			m.CreatedAt.Format("2006-01-02 15:04"),
		}
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderTable([]string{"LEVEL", "ID", "CONTENT", "SESSION", "CREATED"}, rows))
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.Subtle.Render(fmt.Sprintf("%d memor%s", len(memories), func() string {
		if len(memories) == 1 {
			return "y"
		}
		return "ies"
	}())))
	return nil
}

// TransferWorkingCmd transfers working memories to episodic
var transferWorkingCmd = &cobra.Command{
	Use:   "transfer-working",
	Short: "Transfer working memories to episodic level",
	Long: `Transfer all working memories for a session to episodic level.

This is typically called at the end of a session to preserve
temporary memories as historical records.

Examples:
  cortex transfer-working --session mySession`,
	RunE: runTransferWorking,
}

var (
	transferSessionID string
	transferOutput    string
)

func init() {
	transferWorkingCmd.Flags().StringVar(&transferSessionID, "session", "", "Session ID (required)")
	transferWorkingCmd.Flags().StringVarP(&transferOutput, "output", "o", "text", "Output format (text|json)")

	_ = transferWorkingCmd.MarkFlagRequired("session")

	rootCmd.AddCommand(transferWorkingCmd)
}

func runTransferWorking(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

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

	// Create service
	svc := consolidation.NewService(store, embedder, &cfg.Consolidation)

	// Transfer
	transferred, err := svc.TransferWorkingToEpisodic(ctx, transferSessionID)
	if err != nil {
		return fmt.Errorf("transfer failed: %w", err)
	}

	jsonResult := map[string]interface{}{
		"session_id":  transferSessionID,
		"transferred": transferred,
	}

	if transferOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(jsonResult, "", "  ")
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	lines := [][2]string{
		{"Transferred", tui.Success.Render(fmt.Sprintf("%d", transferred))},
		{"Session", transferSessionID},
	}
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderDetail("Transfer Complete", lines))
	return nil
}

// Helper function
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
