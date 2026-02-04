package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/pkg/session"
	"github.com/spf13/cobra"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new memory",
	Long: `Create a new memory with a title, content, and a memory level.

Levels: working, episodic, semantic.

Examples:
  cortex create --title "JWT Fix" --level semantic --content "How to refresh JWT tokens"
  cortex create --title "Auth Bug" --level episodic --content "..." --tags auth,jwt`,
	RunE: runCreate,
}

var (
	createTitle   string
	createContent string
	createLevel   string
	createTags    string
	createSession string
	createSource  string
	createJSON    bool
)

func init() {
	createCmd.Flags().StringVarP(&createTitle, "title", "t", "", "Memory title (required)")
	createCmd.Flags().StringVarP(&createContent, "content", "c", "", "Memory content (required)")
	createCmd.Flags().StringVarP(&createLevel, "level", "l", "", "Memory level: working, episodic, semantic (required)")
	createCmd.Flags().StringVar(&createTags, "tags", "", "Comma-separated tags")
	createCmd.Flags().StringVar(&createSession, "session", "", "Session ID (required for working level)")
	createCmd.Flags().StringVar(&createSource, "source", "manual", "Source: manual, auto, llm")
	createCmd.Flags().BoolVar(&createJSON, "json", false, "Output as JSON")

	_ = createCmd.MarkFlagRequired("title")
	_ = createCmd.MarkFlagRequired("content")
	_ = createCmd.MarkFlagRequired("level")

	rootCmd.AddCommand(createCmd)
}

func runCreate(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	if !memory.IsValidLevel(createLevel) {
		return fmt.Errorf("invalid level: %s (must be working, episodic, or semantic)", createLevel)
	}

	// Auto-derive session ID if needed
	if memory.MemoryLevel(createLevel) == memory.MemoryLevelWorking {
		cfg := config.Global()
		deriver := session.NewDeriver(&cfg.Session)
		derivedSession, err := deriver.DeriveOrUseProvided(ctx, createSession)
		if err != nil {
			return fmt.Errorf("failed to derive session ID: %w", err)
		}
		if derivedSession == "" {
			return fmt.Errorf("--session is required for working level (or enable session.auto_derive in config)")
		}
		createSession = derivedSession
	}

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

	var tags []string
	if createTags != "" {
		for _, t := range strings.Split(createTags, ",") {
			tags = append(tags, strings.TrimSpace(t))
		}
	}

	// Create memory
	input := memory.CreateInput{
		Title:     createTitle,
		Content:   createContent,
		Level:     memory.MemoryLevel(createLevel),
		Tags:      tags,
		SessionID: createSession,
		Source:    createSource,
	}

	m, err := svc.Create(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to create memory: %w", err)
	}

	// Output
	if createJSON {
		jsonBytes, _ := json.MarshalIndent(m, "", "  ")
		fmt.Println(string(jsonBytes))
		return nil
	}

	fmt.Printf("Created memory: %s\n", m.ID)
	fmt.Printf("  Title: %s\n", m.Title)
	fmt.Printf("  Level: %s\n", m.Level)
	if len(m.Tags) > 0 {
		fmt.Printf("  Tags: %v\n", m.Tags)
	}

	return nil
}
