package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/consolidation"
	"github.com/cortex-ai/cortex-ai/internal/memory"
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
	consolidateLevel      string
	consolidateContent    string
	consolidateContext    string
	consolidateForce      bool
	consolidateOutput     string
	consolidateSessionID  string
	consolidateTags       []string
	consolidateSource     string
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

	// Validate level
	if !memory.IsValidLevel(consolidateLevel) {
		return fmt.Errorf("invalid level: %s (must be working|episodic|semantic)", consolidateLevel)
	}

	// Initialize embedder
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize consolidated storage
	store, err := initConsolidatedStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = store.Close() }()

	// Get config
	cfg := config.Global()

	// Create service
	svc := consolidation.NewService(store, embedder, &cfg.Consolidation)

	// Build context
	consolidationCtx := memory.ConsolidationContext{
		SessionID: consolidateSessionID,
		Timestamp: time.Now(),
		Source:    consolidateSource,
		Tags:      consolidateTags,
	}

	// Generate session ID if not provided
	if consolidationCtx.SessionID == "" {
		consolidationCtx.SessionID = uuid.New().String()
	}

	// Parse additional context if provided
	if consolidateContext != "" {
		var extraCtx memory.ConsolidationContext
		if err := json.Unmarshal([]byte(consolidateContext), &extraCtx); err != nil {
			return fmt.Errorf("invalid context JSON: %w", err)
		}
		// Merge extra context
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

	// Build input
	input := memory.ConsolidateInput{
		Synthesis: consolidateContent,
		Level:     memory.MemoryLevel(consolidateLevel),
		Context:   consolidationCtx,
		Force:     consolidateForce,
	}

	// Consolidate
	result, err := svc.Consolidate(ctx, input)
	if err != nil {
		return fmt.Errorf("consolidation failed: %w", err)
	}

	// Output
	if consolidateOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		fmt.Printf("Action: %s\n", result.Action)
		fmt.Printf("Memory ID: %s\n", result.MemoryID)
		if result.MergedWith != "" {
			fmt.Printf("Merged with: %s\n", result.MergedWith)
		}
		if result.Reason != "" {
			fmt.Printf("Reason: %s\n", result.Reason)
		}
	}

	return nil
}

// ListConsolidatedCmd lists consolidated memories
var listConsolidatedCmd = &cobra.Command{
	Use:   "list-consolidated",
	Short: "List consolidated memories by level",
	Long: `List consolidated memories filtered by memory level.

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

	// Initialize consolidated storage
	store, err := initConsolidatedStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = store.Close() }()

	// Get config
	cfg := config.Global()

	// Create service
	svc := consolidation.NewService(store, embedder, &cfg.Consolidation)

	// List memories
	var memories []*memory.ConsolidatedMemory
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

	// Output
	if listConsolidatedOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(memories, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		if len(memories) == 0 {
			fmt.Println("No consolidated memories found.")
			return nil
		}

		fmt.Printf("Found %d consolidated memories:\n\n", len(memories))
		for _, m := range memories {
			fmt.Printf("ID: %s\n", m.ID)
			fmt.Printf("Level: %s\n", m.Level)
			fmt.Printf("Content: %s\n", truncate(m.Content, 100))
			fmt.Printf("Session: %s\n", m.Context.SessionID)
			fmt.Printf("Created: %s\n", m.CreatedAt.Format(time.RFC3339))
			if len(m.Context.Tags) > 0 {
				fmt.Printf("Tags: %v\n", m.Context.Tags)
			}
			fmt.Println("---")
		}
	}

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

	// Initialize consolidated storage
	store, err := initConsolidatedStorage()
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

	// Output
	result := map[string]interface{}{
		"session_id":  transferSessionID,
		"transferred": transferred,
	}

	if transferOutput == "json" {
		jsonBytes, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		fmt.Printf("Transferred %d working memories to episodic level\n", transferred)
		fmt.Printf("Session: %s\n", transferSessionID)
	}

	return nil
}

// Helper function
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
