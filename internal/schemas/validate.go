// Package schemas provides embedded JSON schemas for MCP tools and CLI output.
package schemas

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"gopkg.in/yaml.v3"
)

// ValidationError represents a validation error with context.
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("%s: %s", e.Field, e.Message)
	}
	return e.Message
}

// ValidationResult contains the result of template validation.
type ValidationResult struct {
	Valid  bool
	Errors []ValidationError
}

// ValidateMarkdownTemplateFile validates a markdown template configuration file.
// Supports both JSON and YAML formats.
func ValidateMarkdownTemplateFile(filePath string) (*ValidationResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(filePath))

	var cfg config.MarkdownTemplateConfig

	switch ext {
	case ".json":
		if err := json.Unmarshal(data, &cfg); err != nil {
			return &ValidationResult{
				Valid: false,
				Errors: []ValidationError{
					{Message: fmt.Sprintf("invalid JSON: %s", err)},
				},
			}, nil
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return &ValidationResult{
				Valid: false,
				Errors: []ValidationError{
					{Message: fmt.Sprintf("invalid YAML: %s", err)},
				},
			}, nil
		}
	default:
		return nil, fmt.Errorf("unsupported file extension: %s (use .json, .yaml, or .yml)", ext)
	}

	return ValidateMarkdownTemplateConfig(&cfg), nil
}

// ValidateMarkdownTemplateConfig validates a MarkdownTemplateConfig struct.
func ValidateMarkdownTemplateConfig(cfg *config.MarkdownTemplateConfig) *ValidationResult {
	result := &ValidationResult{Valid: true}

	if cfg == nil {
		result.Valid = false
		result.Errors = append(result.Errors, ValidationError{
			Message: "template configuration is nil",
		})
		return result
	}

	// Validate memory template
	if cfg.Memory != nil {
		validateMemoryTemplate(cfg.Memory, result)
	}

	// Validate synthesis template
	if cfg.Synthesis != nil {
		validateSynthesisTemplate(cfg.Synthesis, result)
	}

	return result
}

func validateMemoryTemplate(mem *config.MemoryTemplateConfig, result *ValidationResult) {
	// Validate body template if provided
	if mem.Body != "" {
		if err := validateGoTemplate("memory.body", mem.Body); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, *err)
		}
	}

	// Validate frontmatter config
	if mem.Frontmatter != nil {
		validateFrontmatterConfig("memory.frontmatter", mem.Frontmatter, result)
	}
}

func validateSynthesisTemplate(syn *config.SynthesisTemplateConfig, result *ValidationResult) {
	// Validate header template
	if syn.Header != "" {
		if err := validateGoTemplate("synthesis.header", syn.Header); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, *err)
		}
	}

	// Validate footer template (may contain template syntax)
	if syn.Footer != "" {
		if err := validateGoTemplate("synthesis.footer", syn.Footer); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, *err)
		}
	}

	// Validate frontmatter config
	if syn.Frontmatter != nil {
		validateFrontmatterConfig("synthesis.frontmatter", syn.Frontmatter, result)
	}

	// Validate summary section
	if syn.SummarySection != nil {
		if syn.SummarySection.Title != "" {
			if err := validateGoTemplate("synthesis.summary_section.title", syn.SummarySection.Title); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, *err)
			}
		}
		if syn.SummarySection.Content != "" {
			if err := validateGoTemplate("synthesis.summary_section.content", syn.SummarySection.Content); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, *err)
			}
		}
	}

	// Validate learnings section
	if syn.LearningsSection != nil {
		if syn.LearningsSection.Title != "" {
			if err := validateGoTemplate("synthesis.learnings_section.title", syn.LearningsSection.Title); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, *err)
			}
		}
		if syn.LearningsSection.ItemTemplate != "" {
			if err := validateGoTemplate("synthesis.learnings_section.item_template", syn.LearningsSection.ItemTemplate); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, *err)
			}
		}
		if syn.LearningsSection.ContentPreviewLength < 0 {
			result.Valid = false
			result.Errors = append(result.Errors, ValidationError{
				Field:   "synthesis.learnings_section.content_preview_length",
				Message: "must be non-negative",
			})
		}
	}
}

func validateFrontmatterConfig(prefix string, fm *config.FrontmatterTemplateConfig, result *ValidationResult) {
	// Validate date format if provided
	if fm.DateFormat != "" {
		// Check if it's a valid Go time format by trying to use it
		// We just check for obviously invalid patterns
		if strings.Contains(fm.DateFormat, "{{") {
			result.Valid = false
			result.Errors = append(result.Errors, ValidationError{
				Field:   prefix + ".date_format",
				Message: "date_format should be a Go time format string, not a template",
			})
		}
	}
}

// templateFuncs provides template functions for validation
var templateFuncs = template.FuncMap{
	"title": func(s string) string { return s },
	"mul":   func(a, b float64) float64 { return a * b },
}

func validateGoTemplate(field, tmplStr string) *ValidationError {
	_, err := template.New(field).Funcs(templateFuncs).Parse(tmplStr)
	if err != nil {
		return &ValidationError{
			Field:   field,
			Message: fmt.Sprintf("invalid Go template: %s", err),
		}
	}
	return nil
}
