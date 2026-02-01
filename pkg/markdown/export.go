package markdown

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// Exporter exports memories to Markdown files
type Exporter struct {
	outputDir      string
	templateConfig *config.MarkdownTemplateConfig
}

// NewExporter creates a new Exporter with default templates
func NewExporter(outputDir string) *Exporter {
	return &Exporter{
		outputDir:      outputDir,
		templateConfig: config.DefaultMarkdownTemplateConfig(),
	}
}

// NewExporterWithConfig creates a new Exporter with custom template configuration
func NewExporterWithConfig(outputDir string, cfg *config.MarkdownTemplateConfig) *Exporter {
	tmplCfg := config.DefaultMarkdownTemplateConfig()
	if cfg != nil {
		tmplCfg = mergeTemplateConfig(tmplCfg, cfg)
	}
	return &Exporter{
		outputDir:      outputDir,
		templateConfig: tmplCfg,
	}
}

// mergeTemplateConfig merges user config into default config
func mergeTemplateConfig(base, override *config.MarkdownTemplateConfig) *config.MarkdownTemplateConfig {
	if override == nil {
		return base
	}

	result := *base

	// Merge memory config
	if override.Memory != nil {
		if result.Memory == nil {
			result.Memory = &config.MemoryTemplateConfig{}
		}
		if override.Memory.Body != "" {
			result.Memory.Body = override.Memory.Body
		}
		if override.Memory.Frontmatter != nil {
			if result.Memory.Frontmatter == nil {
				result.Memory.Frontmatter = &config.FrontmatterTemplateConfig{}
			}
			mergeFrontmatterConfig(result.Memory.Frontmatter, override.Memory.Frontmatter)
		}
	}

	// Merge synthesis config
	if override.Synthesis != nil {
		if result.Synthesis == nil {
			result.Synthesis = &config.SynthesisTemplateConfig{}
		}
		if override.Synthesis.Header != "" {
			result.Synthesis.Header = override.Synthesis.Header
		}
		if override.Synthesis.Footer != "" {
			result.Synthesis.Footer = override.Synthesis.Footer
		}
		if override.Synthesis.Frontmatter != nil {
			if result.Synthesis.Frontmatter == nil {
				result.Synthesis.Frontmatter = &config.FrontmatterTemplateConfig{}
			}
			mergeFrontmatterConfig(result.Synthesis.Frontmatter, override.Synthesis.Frontmatter)
		}
		if override.Synthesis.SummarySection != nil {
			if result.Synthesis.SummarySection == nil {
				result.Synthesis.SummarySection = &config.SectionTemplateConfig{}
			}
			if override.Synthesis.SummarySection.Title != "" {
				result.Synthesis.SummarySection.Title = override.Synthesis.SummarySection.Title
			}
			if override.Synthesis.SummarySection.Content != "" {
				result.Synthesis.SummarySection.Content = override.Synthesis.SummarySection.Content
			}
		}
		if override.Synthesis.LearningsSection != nil {
			if result.Synthesis.LearningsSection == nil {
				result.Synthesis.LearningsSection = &config.LearningsTemplateConfig{}
			}
			if override.Synthesis.LearningsSection.Title != "" {
				result.Synthesis.LearningsSection.Title = override.Synthesis.LearningsSection.Title
			}
			if override.Synthesis.LearningsSection.ItemTemplate != "" {
				result.Synthesis.LearningsSection.ItemTemplate = override.Synthesis.LearningsSection.ItemTemplate
			}
			if override.Synthesis.LearningsSection.ContentPreviewLength > 0 {
				result.Synthesis.LearningsSection.ContentPreviewLength = override.Synthesis.LearningsSection.ContentPreviewLength
			}
		}
	}

	return &result
}

// mergeFrontmatterConfig merges frontmatter config
func mergeFrontmatterConfig(base, override *config.FrontmatterTemplateConfig) {
	if override.IncludeID != nil {
		base.IncludeID = override.IncludeID
	}
	if override.IncludeDates != nil {
		base.IncludeDates = override.IncludeDates
	}
	if override.IncludeMetadata != nil {
		base.IncludeMetadata = override.IncludeMetadata
	}
	if override.DateFormat != "" {
		base.DateFormat = override.DateFormat
	}
}

// templateFuncs provides template functions
var templateFuncs = template.FuncMap{
	"title": toTitleCase,
	"mul":   func(a, b float64) float64 { return a * b },
}

// ExportMemory exports a single memory to a Markdown file
// Returns the path of the exported file
func (e *Exporter) ExportMemory(m *memory.Memory) (string, error) {
	if m == nil {
		return "", fmt.Errorf("memory is nil")
	}

	// Ensure output directory exists
	if err := os.MkdirAll(e.outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	// Convert memory types to string slice
	types := make([]string, len(m.Types))
	for i, t := range m.Types {
		types[i] = string(t)
	}

	// Build frontmatter
	fm := &Frontmatter{
		ID:        m.ID,
		Title:     m.Title,
		Types:     types,
		Tags:      m.Tags,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
		Obsolete:  m.Obsolete,
		Metadata:  m.Metadata,
	}

	// Format frontmatter
	fmStr, err := FormatFrontmatter(fm)
	if err != nil {
		return "", fmt.Errorf("failed to format frontmatter: %w", err)
	}

	// Build full content
	content := fmStr + "\n" + m.Content

	// Write to file
	filename := fmt.Sprintf("%s.md", m.ID)
	filepath := filepath.Join(e.outputDir, filename)

	if err := os.WriteFile(filepath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return filepath, nil
}

// ExportAll exports all memories to separate files
// Returns the paths of all exported files
func (e *Exporter) ExportAll(memories []*memory.Memory) ([]string, error) {
	if len(memories) == 0 {
		return nil, nil
	}

	var paths []string
	for _, m := range memories {
		path, err := e.ExportMemory(m)
		if err != nil {
			return paths, fmt.Errorf("failed to export memory %s: %w", m.ID, err)
		}
		paths = append(paths, path)
	}

	return paths, nil
}

// SynthesisData represents data passed to synthesis templates
type SynthesisData struct {
	Intent  string
	Results []*memory.SearchResult
}

// LearningItemData represents data for a single learning item in template
type LearningItemData struct {
	Title   string
	Score   float64
	Preview string
}

// ExportSynthesis generates a synthesis document from search results
func (e *Exporter) ExportSynthesis(intent string, results []*memory.SearchResult) (string, error) {
	if len(results) == 0 {
		return "", fmt.Errorf("no results to synthesize")
	}

	// Ensure output directory exists
	if err := os.MkdirAll(e.outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	cfg := e.templateConfig.Synthesis

	// Build source memories list
	sources := make([]SourceMemory, len(results))
	for i, r := range results {
		sources[i] = SourceMemory{
			ID:    r.Memory.ID,
			Title: r.Memory.Title,
			Score: r.Score,
		}
	}

	// Build synthesis frontmatter
	fm := &SynthesisFrontmatter{
		Type:           "synthesis",
		Intent:         intent,
		GeneratedAt:    time.Now().UTC(),
		SourceMemories: sources,
	}

	// Format frontmatter
	fmStr, err := FormatSynthesisFrontmatter(fm)
	if err != nil {
		return "", fmt.Errorf("failed to format synthesis frontmatter: %w", err)
	}

	// Build synthesis body using templates
	var body strings.Builder

	// Header
	headerTmpl, err := template.New("header").Funcs(templateFuncs).Parse(cfg.Header)
	if err != nil {
		return "", fmt.Errorf("failed to parse header template: %w", err)
	}
	var headerBuf bytes.Buffer
	if err := headerTmpl.Execute(&headerBuf, SynthesisData{Intent: intent, Results: results}); err != nil {
		return "", fmt.Errorf("failed to execute header template: %w", err)
	}
	body.WriteString(headerBuf.String())
	body.WriteString("\n\n")

	// Summary section
	body.WriteString(cfg.SummarySection.Title)
	body.WriteString("\n\n")
	body.WriteString(cfg.SummarySection.Content)
	body.WriteString("\n\n")

	// Learnings section
	body.WriteString(cfg.LearningsSection.Title)
	body.WriteString("\n\n")

	itemTmpl, err := template.New("item").Funcs(templateFuncs).Parse(cfg.LearningsSection.ItemTemplate)
	if err != nil {
		return "", fmt.Errorf("failed to parse item template: %w", err)
	}

	previewLen := cfg.LearningsSection.ContentPreviewLength
	if previewLen <= 0 {
		previewLen = 500
	}

	for _, r := range results {
		preview := getContentPreview(r.Memory.Content, previewLen)
		var itemBuf bytes.Buffer
		if err := itemTmpl.Execute(&itemBuf, LearningItemData{
			Title:   r.Memory.Title,
			Score:   r.Score,
			Preview: preview,
		}); err != nil {
			return "", fmt.Errorf("failed to execute item template: %w", err)
		}
		body.WriteString(itemBuf.String())
		body.WriteString("\n\n")
	}

	// Footer
	body.WriteString(cfg.Footer)
	body.WriteString("\n")

	// Combine frontmatter and body
	content := fmStr + "\n" + body.String()

	// Write to file
	filename := fmt.Sprintf("synthesis-%s.md", sanitizeFilename(intent))
	filepath := filepath.Join(e.outputDir, filename)

	if err := os.WriteFile(filepath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write synthesis file: %w", err)
	}

	return filepath, nil
}

// toTitleCase converts a string to title case
func toTitleCase(s string) string {
	words := strings.Fields(s)
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(string(word[0])) + strings.ToLower(word[1:])
		}
	}
	return strings.Join(words, " ")
}

// getContentPreview returns a preview of the content
func getContentPreview(content string, maxLen int) string {
	if len(content) <= maxLen {
		return content
	}

	// Try to cut at a paragraph boundary
	preview := content[:maxLen]
	if lastPara := strings.LastIndex(preview, "\n\n"); lastPara > maxLen/2 {
		return preview[:lastPara] + "\n\n..."
	}

	// Otherwise cut at word boundary
	if lastSpace := strings.LastIndex(preview, " "); lastSpace > maxLen/2 {
		return preview[:lastSpace] + "..."
	}

	return preview + "..."
}

// sanitizeFilename removes or replaces characters that are invalid in filenames
func sanitizeFilename(s string) string {
	// Replace spaces with hyphens
	s = strings.ReplaceAll(s, " ", "-")
	// Remove characters that are problematic in filenames
	replacer := strings.NewReplacer(
		"/", "",
		"\\", "",
		":", "",
		"*", "",
		"?", "",
		"\"", "",
		"<", "",
		">", "",
		"|", "",
	)
	s = replacer.Replace(s)
	// Convert to lowercase
	s = strings.ToLower(s)
	// Limit length
	if len(s) > 50 {
		s = s[:50]
	}
	return s
}
