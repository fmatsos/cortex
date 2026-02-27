package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
	pkgjson "github.com/cortex-ai/cortex-ai/pkg/json"
	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get [id]",
	Short: "Get a memory by ID",
	Long: `Get a specific memory by its ID.

Examples:
  cortex get abc123
  cortex get abc123 --json`,
	Args: cobra.ExactArgs(1),
	RunE: runGet,
}

var getJSON bool

func init() {
	getCmd.Flags().BoolVar(&getJSON, "json", false, "Output as JSON")

	rootCmd.AddCommand(getCmd)
}

func runGet(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	id := args[0]

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

	m, err := svc.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get memory: %w", err)
	}

	if getJSON {
		return outputGetJSON(cmd, m)
	}
	return outputGetText(cmd, m)
}

func outputGetJSON(cmd *cobra.Command, m *memory.Memory) error {
	jsonBytes, err := pkgjson.MarshalMemory(m, true)
	if err != nil {
		return fmt.Errorf("failed to marshal memory: %w", err)
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), string(jsonBytes))
	return nil
}

func outputGetText(cmd *cobra.Command, m *memory.Memory) error {
	lines := [][2]string{
		{"ID", m.ID},
		{"Level", tui.FormatLevel(string(m.Level))},
		{"Tags", tui.FormatTags(m.Tags)},
		{"Created", m.CreatedAt.Format(time.RFC3339)},
		{"Updated", m.UpdatedAt.Format(time.RFC3339)},
	}

	if len(m.MergedFrom) > 0 {
		lines = append(lines, [2]string{"Merged from", strings.Join(m.MergedFrom, ", ")})
	}

	if m.Obsolete {
		lines = append(lines, [2]string{"Status", tui.Warning.Render("obsolete")})
	}

	lines = append(lines, [2]string{"Content", "\n" + m.Content})

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.RenderDetail(m.Title, lines))
	return nil
}
