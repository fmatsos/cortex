package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
)

// CreateFormInput holds the values collected by the interactive create form.
type CreateFormInput struct {
	Title   string
	Content string
	Level   string
	Tags    string
}

// RunCreateForm launches an interactive Huh form that collects the fields
// required to create a memory. The form is presented only when running in an
// interactive terminal; callers should guard with IsInteractive() first.
func RunCreateForm(input *CreateFormInput) error {
	if input.Level == "" {
		input.Level = "episodic" // sensible default pre-selection
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Title").
				Placeholder("Short descriptive title (min 3 chars)").
				Value(&input.Title).
				Validate(func(s string) error {
					if len(strings.TrimSpace(s)) < 3 {
						return fmt.Errorf("title must be at least 3 characters")
					}
					return nil
				}),

			huh.NewSelect[string]().
				Title("Memory Level").
				Description("Choose the appropriate memory layer").
				Options(
					huh.NewOption("episodic  – historical events and decisions", "episodic"),
					huh.NewOption("semantic  – permanent knowledge and patterns", "semantic"),
					huh.NewOption("working   – session-scoped temporary context", "working"),
				).
				Value(&input.Level),

			huh.NewText().
				Title("Content").
				Description("Press Alt+Enter or Esc then Tab to proceed").
				Placeholder("Detailed memory content (min 10 chars)").
				Lines(5).
				Value(&input.Content).
				Validate(func(s string) error {
					if len(strings.TrimSpace(s)) < 10 {
						return fmt.Errorf("content must be at least 10 characters")
					}
					return nil
				}),

			huh.NewInput().
				Title("Tags (optional)").
				Description("Comma-separated list of tags").
				Placeholder("tag1, tag2, tag3").
				Value(&input.Tags),
		),
	)

	return form.Run()
}
