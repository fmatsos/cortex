package cli

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/cli/output"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/spf13/cobra"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new memory",
	Long: `Create a new memory with a title, content, and one or more types.

Types can be combined: solution, issue, analysis, rule, or any.

Examples:
  cortex create --title "JWT Fix" --type solution --content "How to refresh JWT tokens"
  cortex create --title "Auth Bug" --type issue,solution --content "..." --tags auth,jwt`,
	RunE: runCreate,
}

var (
	createTitle   string
	createContent string
	createTypes   []string
	createTags    []string
	createOutput  string
)

func init() {
	createCmd.Flags().StringVarP(&createTitle, "title", "t", "", "Memory title (required)")
	createCmd.Flags().StringVar(&createContent, "content", "", "Memory content (required)")
	createCmd.Flags().StringSliceVar(&createTypes, "type", nil, "Memory types (required, can be combined): solution,issue,analysis,rule,any")
	createCmd.Flags().StringSliceVar(&createTags, "tags", nil, "Memory tags")
	createCmd.Flags().StringVar(&createOutput, "output", "text", "Output format (text|json)")

	_ = createCmd.MarkFlagRequired("title")
	_ = createCmd.MarkFlagRequired("type")
	_ = createCmd.MarkFlagRequired("content")

	rootCmd.AddCommand(createCmd)
}

func runCreate(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

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

	// Parse memory types
	var types []memory.MemoryType
	for _, t := range createTypes {
		if !memory.IsValidType(t) {
			return fmt.Errorf("invalid type: %s", t)
		}
		types = append(types, memory.MemoryType(t))
	}

	// Create memory
	input := memory.CreateInput{
		Title:   createTitle,
		Content: createContent,
		Types:   types,
		Tags:    createTags,
	}

	m, err := svc.Create(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to create memory: %w", err)
	}

	// Output
	if createOutput == "json" {
		out := output.CreateOutput{
			ID:      m.ID,
			Title:   m.Title,
			Types:   m.Types,
			Created: m.CreatedAt,
		}
		jsonBytes, _ := json.MarshalIndent(out, "", "  ")
		fmt.Println(string(jsonBytes))
	} else {
		fmt.Printf("Memory created: %s\n", m.ID)
		fmt.Printf("Title: %s\n", m.Title)
		fmt.Printf("Types: %v\n", m.Types)
	}

	return nil
}
