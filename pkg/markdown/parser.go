package markdown

import (
	"bytes"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	// FrontmatterDelimiter is the standard YAML frontmatter delimiter
	FrontmatterDelimiter = "---"
)

// ParseResult contains the parsed frontmatter and body content
type ParseResult struct {
	Frontmatter *Frontmatter
	Body        string
}

// ParseFrontmatter parses a Markdown file with YAML frontmatter
// Returns the frontmatter and the body content separately
func ParseFrontmatter(content []byte) (*ParseResult, error) {
	str := string(content)

	// Check if content starts with frontmatter delimiter
	if !strings.HasPrefix(str, FrontmatterDelimiter) {
		return nil, fmt.Errorf("file does not start with frontmatter delimiter '---'")
	}

	// Find the end of frontmatter
	rest := str[len(FrontmatterDelimiter):]
	endIndex := strings.Index(rest, "\n"+FrontmatterDelimiter)
	if endIndex == -1 {
		return nil, fmt.Errorf("missing closing frontmatter delimiter '---'")
	}

	// Extract YAML content (skip the leading newline if present)
	yamlContent := rest[:endIndex]
	yamlContent = strings.TrimPrefix(yamlContent, "\n")

	// Extract body (skip the closing delimiter and newlines)
	body := rest[endIndex+len("\n"+FrontmatterDelimiter):]
	body = strings.TrimPrefix(body, "\n")

	// Parse YAML frontmatter
	var fm Frontmatter
	decoder := yaml.NewDecoder(bytes.NewReader([]byte(yamlContent)))
	if err := decoder.Decode(&fm); err != nil {
		return nil, fmt.Errorf("failed to parse YAML frontmatter: %w", err)
	}

	return &ParseResult{
		Frontmatter: &fm,
		Body:        body,
	}, nil
}

// ParseSynthesisFrontmatter parses synthesis document frontmatter
func ParseSynthesisFrontmatter(content []byte) (*SynthesisFrontmatter, string, error) {
	str := string(content)

	// Check if content starts with frontmatter delimiter
	if !strings.HasPrefix(str, FrontmatterDelimiter) {
		return nil, "", fmt.Errorf("file does not start with frontmatter delimiter '---'")
	}

	// Find the end of frontmatter
	rest := str[len(FrontmatterDelimiter):]
	endIndex := strings.Index(rest, "\n"+FrontmatterDelimiter)
	if endIndex == -1 {
		return nil, "", fmt.Errorf("missing closing frontmatter delimiter '---'")
	}

	// Extract YAML content
	yamlContent := rest[:endIndex]
	yamlContent = strings.TrimPrefix(yamlContent, "\n")

	// Extract body
	body := rest[endIndex+len("\n"+FrontmatterDelimiter):]
	body = strings.TrimPrefix(body, "\n")

	// Parse YAML
	var fm SynthesisFrontmatter
	decoder := yaml.NewDecoder(bytes.NewReader([]byte(yamlContent)))
	if err := decoder.Decode(&fm); err != nil {
		return nil, "", fmt.Errorf("failed to parse synthesis frontmatter: %w", err)
	}

	return &fm, body, nil
}

// FormatFrontmatter formats a Frontmatter struct to YAML with delimiters
func FormatFrontmatter(fm *Frontmatter) (string, error) {
	var buf bytes.Buffer

	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)

	if err := encoder.Encode(fm); err != nil {
		return "", fmt.Errorf("failed to encode frontmatter: %w", err)
	}

	if err := encoder.Close(); err != nil {
		return "", fmt.Errorf("failed to close encoder: %w", err)
	}

	return FrontmatterDelimiter + "\n" + buf.String() + FrontmatterDelimiter + "\n", nil
}

// FormatSynthesisFrontmatter formats synthesis frontmatter to YAML with delimiters
func FormatSynthesisFrontmatter(fm *SynthesisFrontmatter) (string, error) {
	var buf bytes.Buffer

	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)

	if err := encoder.Encode(fm); err != nil {
		return "", fmt.Errorf("failed to encode synthesis frontmatter: %w", err)
	}

	if err := encoder.Close(); err != nil {
		return "", fmt.Errorf("failed to close encoder: %w", err)
	}

	return FrontmatterDelimiter + "\n" + buf.String() + FrontmatterDelimiter + "\n", nil
}
