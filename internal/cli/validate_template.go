package cli

import (
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/schemas"
	"github.com/spf13/cobra"
)

var validateTemplateCmd = &cobra.Command{
	Use:   "validate-template <file>",
	Short: "Validate a custom template file",
	Long: `Validate a custom template file for memory or synthesis exports.
	
Supports multiple formats:
  - .yaml, .yml: Structured template configuration
  - .json: JSON template configuration
  - .tmpl: Plain Go template (for memory body only)

The validator checks:
  - File format and syntax
  - Go template syntax
  - Required fields
  - Type compatibility

Examples:
  cortex validate-template memory.yaml
  cortex validate-template synthesis.json
  cortex validate-template simple.tmpl
`,
	Args: cobra.ExactArgs(1),
	RunE: runValidateTemplate,
}

var (
	validateTemplateType string
)

func init() {
	validateTemplateCmd.Flags().StringVarP(&validateTemplateType, "type", "t", "auto", "Template type: auto, memory, synthesis, markdown")
	rootCmd.AddCommand(validateTemplateCmd)
}

func runValidateTemplate(cmd *cobra.Command, args []string) error {
	filePath := args[0]
	out := cmd.OutOrStdout()

	// Determine template type
	templateType := validateTemplateType
	if templateType == "auto" {
		// Auto-detect based on content or filename
		detectedType, err := detectTemplateType(filePath)
		if err != nil {
			return err
		}
		templateType = detectedType
	}

	var result *schemas.ValidationResult
	var err error

	switch templateType {
	case "memory":
		result, err = schemas.ValidateMemoryTemplateFile(filePath)
	case "synthesis":
		result, err = schemas.ValidateSynthesisTemplateFile(filePath)
	case "markdown":
		result, err = schemas.ValidateMarkdownTemplateFile(filePath)
	default:
		return fmt.Errorf("unknown template type: %s (use: memory, synthesis, markdown, or auto)", templateType)
	}

	if err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	if result.Valid {
		_, _ = fmt.Fprintf(out, "✓ Template is valid (%s)\n", templateType)
		_, _ = fmt.Fprintf(out, "  File: %s\n", filePath)
		return nil
	}

	// Print validation errors
	_, _ = fmt.Fprintf(out, "✗ Template validation failed (%s)\n", templateType)
	_, _ = fmt.Fprintf(out, "  File: %s\n\n", filePath)
	_, _ = fmt.Fprintln(out, "Errors:")
	for i, verr := range result.Errors {
		if verr.Field != "" {
			_, _ = fmt.Fprintf(out, "  %d. [%s] %s\n", i+1, verr.Field, verr.Message)
		} else {
			_, _ = fmt.Fprintf(out, "  %d. %s\n", i+1, verr.Message)
		}
	}

	return fmt.Errorf("template validation failed with %d error(s)", len(result.Errors))
}

func detectTemplateType(filePath string) (string, error) {
	// Try to load as markdown template first
	mdCfg, err := schemas.LoadMarkdownTemplateFromFile(filePath)
	if err == nil {
		// Check if it has both memory and synthesis sections
		if mdCfg.Memory != nil && mdCfg.Synthesis != nil {
			return "markdown", nil
		}
		if mdCfg.Synthesis != nil {
			return "synthesis", nil
		}
		if mdCfg.Memory != nil {
			return "memory", nil
		}
	}

	// Try to load as synthesis to check for synthesis-specific fields
	synthCfg, synthErr := schemas.LoadSynthesisTemplateFromFile(filePath)
	if synthErr == nil {
		// Check if it has synthesis-specific fields
		if synthCfg.Header != "" || synthCfg.Footer != "" ||
			synthCfg.LearningsSection != nil || synthCfg.SummarySection != nil {
			return "synthesis", nil
		}
	}

	// Try memory template
	memCfg, memErr := schemas.LoadMemoryTemplateFromFile(filePath)
	if memErr == nil {
		// Check if it has memory-specific fields
		if memCfg.Body != "" {
			return "memory", nil
		}
	}

	// Default based on which loader succeeded
	if synthErr == nil {
		return "synthesis", nil
	}
	if memErr == nil {
		return "memory", nil
	}

	return "", fmt.Errorf("failed to detect template type for %s: provide --type memory|synthesis|markdown", filePath)
}
