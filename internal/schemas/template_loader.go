// Package schemas provides embedded JSON schemas for MCP tools and CLI output.
package schemas

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"gopkg.in/yaml.v3"
)

// LoadMemoryTemplateFromFile loads a memory template from a file.
// Supports .json, .yaml, .yml, and .tmpl formats.
func LoadMemoryTemplateFromFile(filePath string) (*config.MemoryTemplateConfig, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var cfg config.MemoryTemplateConfig

	switch ext {
	case ".json":
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	case ".tmpl":
		// For .tmpl files, treat the entire content as the body template
		cfg.Body = string(data)
		// Use default frontmatter config
		includeTrue := true
		cfg.Frontmatter = &config.FrontmatterTemplateConfig{
			IncludeID:       &includeTrue,
			IncludeDates:    &includeTrue,
			IncludeMetadata: &includeTrue,
			DateFormat:      "2006-01-02T15:04:05Z07:00",
		}
	default:
		return nil, fmt.Errorf("unsupported file extension: %s (use .json, .yaml, .yml, or .tmpl)", ext)
	}

	return &cfg, nil
}

// LoadSynthesisTemplateFromFile loads a synthesis template from a file.
// Supports .json, .yaml, and .yml formats.
func LoadSynthesisTemplateFromFile(filePath string) (*config.SynthesisTemplateConfig, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var cfg config.SynthesisTemplateConfig

	switch ext {
	case ".json":
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	case ".tmpl":
		return nil, fmt.Errorf(".tmpl format not supported for synthesis templates (use .json or .yaml)")
	default:
		return nil, fmt.Errorf("unsupported file extension: %s (use .json, .yaml, or .yml)", ext)
	}

	return &cfg, nil
}

// LoadMarkdownTemplateFromFile loads a complete markdown template from a file.
// Supports .json, .yaml, and .yml formats.
func LoadMarkdownTemplateFromFile(filePath string) (*config.MarkdownTemplateConfig, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var cfg config.MarkdownTemplateConfig

	switch ext {
	case ".json":
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported file extension: %s (use .json, .yaml, or .yml)", ext)
	}

	return &cfg, nil
}

// ValidateMemoryTemplateFile validates a memory template file.
func ValidateMemoryTemplateFile(filePath string) (*ValidationResult, error) {
	cfg, err := LoadMemoryTemplateFromFile(filePath)
	if err != nil {
		return nil, err
	}

	result := &ValidationResult{Valid: true}
	validateMemoryTemplate(cfg, result)
	return result, nil
}

// ValidateSynthesisTemplateFile validates a synthesis template file.
func ValidateSynthesisTemplateFile(filePath string) (*ValidationResult, error) {
	cfg, err := LoadSynthesisTemplateFromFile(filePath)
	if err != nil {
		return nil, err
	}

	result := &ValidationResult{Valid: true}
	validateSynthesisTemplate(cfg, result)
	return result, nil
}
