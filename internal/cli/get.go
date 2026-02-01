package cli

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
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
	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)

	_, _ = fmt.Fprintf(w, "ID:\t%s\n", m.ID)
	_, _ = fmt.Fprintf(w, "Title:\t%s\n", m.Title)
	_, _ = fmt.Fprintf(w, "Types:\t%v\n", m.Types)
	if len(m.Tags) > 0 {
		_, _ = fmt.Fprintf(w, "Tags:\t%s\n", strings.Join(m.Tags, ", "))
	}
	if len(m.Metadata) > 0 {
		_, _ = fmt.Fprintf(w, "Metadata:\t%s\n", formatMetadata(m.Metadata))
	}
	_, _ = fmt.Fprintf(w, "Created:\t%s\n", m.CreatedAt.Format(time.RFC3339))
	_, _ = fmt.Fprintf(w, "Updated:\t%s\n", m.UpdatedAt.Format(time.RFC3339))
	_, _ = fmt.Fprintf(w, "Obsolete:\t%v\n", m.Obsolete)

	_ = w.Flush()

	out := cmd.OutOrStdout()
	_, _ = fmt.Fprintln(out)
	_, _ = fmt.Fprintln(out, "Content:")
	_, _ = fmt.Fprintln(out, m.Content)

	return nil
}

func formatMetadata(metadata map[string]string) string {
	pairs := make([]string, 0, len(metadata))
	for k, v := range metadata {
		pairs = append(pairs, fmt.Sprintf("%s=%s", k, v))
	}
	sort.Strings(pairs)
	return strings.Join(pairs, ", ")
}
