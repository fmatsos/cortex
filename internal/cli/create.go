package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
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
	createCmd.Flags().StringVarP(&createTitle, "title", "t", "", "Memory title")
	createCmd.Flags().StringVarP(&createContent, "content", "c", "", "Memory content")
	createCmd.Flags().StringVarP(&createLevel, "level", "l", "", "Memory level: working, episodic, semantic")
	createCmd.Flags().StringVar(&createTags, "tags", "", "Comma-separated tags")
	createCmd.Flags().StringVar(&createSession, "session", "", "Session ID (required for working level)")
	createCmd.Flags().StringVar(&createSource, "source", "manual", "Source: manual, auto, llm")
	createCmd.Flags().BoolVar(&createJSON, "json", false, "Output as JSON")

	// Required flags are validated manually in RunE so we can launch the
	// interactive Huh form when the command is run without them in a TTY.
	rootCmd.AddCommand(createCmd)
}

func runCreate(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// If required fields are absent, launch the interactive Huh form when
	// running in an interactive terminal; otherwise surface a clear error.
	if createTitle == "" || createContent == "" || createLevel == "" {
		if !tui.IsInteractive() {
			return fmt.Errorf("--title, --content, and --level are required")
		}
		formInput := &tui.CreateFormInput{Level: createLevel}
		if err := tui.RunCreateForm(formInput); err != nil {
			return fmt.Errorf("form cancelled: %w", err)
		}
		createTitle = formInput.Title
		createContent = formInput.Content
		createLevel = formInput.Level
		if createTags == "" {
			createTags = formInput.Tags
		}
	}

	if !memory.IsValidLevel(createLevel) {
		return fmt.Errorf("invalid level: %s (must be working, episodic, or semantic)", createLevel)
	}

	// Auto-derive session ID for working memories.
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

	var tags []string
	if createTags != "" {
		for _, t := range strings.Split(createTags, ",") {
			tags = append(tags, strings.TrimSpace(t))
		}
	}

	input := memory.CreateInput{
		Title:     createTitle,
		Content:   createContent,
		Level:     memory.MemoryLevel(createLevel),
		Tags:      tags,
		SessionID: createSession,
		Source:    createSource,
	}

	var m *memory.Memory

	if err := tui.RunWithSpinner("Creating memory…", func() error {
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
		m, err = svc.Create(ctx, input)
		return err
	}); err != nil {
		return fmt.Errorf("failed to create memory: %w", err)
	}

	if createJSON {
		jsonBytes, _ := json.MarshalIndent(m, "", "  ")
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
		return nil
	}

	lines := [][2]string{
		{"ID", m.ID},
		{"Level", tui.FormatLevel(string(m.Level))},
	}
	if len(m.Tags) > 0 {
		lines = append(lines, [2]string{"Tags", strings.Join(m.Tags, ", ")})
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderDetail(m.Title, lines))
	return nil
}
