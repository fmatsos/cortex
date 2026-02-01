package schemas

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMemoryTemplateFromFile_YAML(t *testing.T) {
	tmpDir := t.TempDir()
	yamlFile := filepath.Join(tmpDir, "memory.yaml")

	yamlContent := `frontmatter:
  include_id: false
  include_dates: true
  date_format: "2006-01-02"
body: "# {{.Title}}\n\n{{.Content}}"
`

	if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	cfg, err := LoadMemoryTemplateFromFile(yamlFile)
	if err != nil {
		t.Fatalf("LoadMemoryTemplateFromFile failed: %v", err)
	}

	if cfg.Body != "# {{.Title}}\n\n{{.Content}}" {
		t.Errorf("Expected body to be '# {{.Title}}\\n\\n{{.Content}}', got %q", cfg.Body)
	}

	if cfg.Frontmatter == nil {
		t.Fatal("Expected frontmatter to be set")
	}

	if cfg.Frontmatter.IncludeID == nil {
		t.Error("Expected include_id to be set")
	} else if *cfg.Frontmatter.IncludeID {
		t.Error("Expected include_id to be false")
	}

	if cfg.Frontmatter.IncludeDates == nil {
		t.Error("Expected include_dates to be set")
	} else if !*cfg.Frontmatter.IncludeDates {
		t.Error("Expected include_dates to be true")
	}

	if cfg.Frontmatter.DateFormat != "2006-01-02" {
		t.Errorf("Expected date_format to be '2006-01-02', got %q", cfg.Frontmatter.DateFormat)
	}
}

func TestLoadMemoryTemplateFromFile_JSON(t *testing.T) {
	tmpDir := t.TempDir()
	jsonFile := filepath.Join(tmpDir, "memory.json")

	jsonContent := `{
  "frontmatter": {
    "include_id": true,
    "include_metadata": false
  },
  "body": "{{.Content}}"
}`

	if err := os.WriteFile(jsonFile, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	cfg, err := LoadMemoryTemplateFromFile(jsonFile)
	if err != nil {
		t.Fatalf("LoadMemoryTemplateFromFile failed: %v", err)
	}

	if cfg.Body != "{{.Content}}" {
		t.Errorf("Expected body to be '{{.Content}}', got %q", cfg.Body)
	}

	if cfg.Frontmatter == nil {
		t.Fatal("Expected frontmatter to be set")
	}

	if cfg.Frontmatter.IncludeID == nil {
		t.Error("Expected include_id to be set")
	} else if !*cfg.Frontmatter.IncludeID {
		t.Error("Expected include_id to be true")
	}

	if cfg.Frontmatter.IncludeMetadata == nil {
		t.Error("Expected include_metadata to be set")
	} else if *cfg.Frontmatter.IncludeMetadata {
		t.Error("Expected include_metadata to be false")
	}
}

func TestLoadMemoryTemplateFromFile_TMPL(t *testing.T) {
	tmpDir := t.TempDir()
	tmplFile := filepath.Join(tmpDir, "memory.tmpl")

	tmplContent := "## {{.Title}}\n\n{{.Content}}"

	if err := os.WriteFile(tmplFile, []byte(tmplContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	cfg, err := LoadMemoryTemplateFromFile(tmplFile)
	if err != nil {
		t.Fatalf("LoadMemoryTemplateFromFile failed: %v", err)
	}

	if cfg.Body != tmplContent {
		t.Errorf("Expected body to be %q, got %q", tmplContent, cfg.Body)
	}

	// Check that defaults are set for frontmatter
	if cfg.Frontmatter == nil {
		t.Fatal("Expected frontmatter to be set with defaults")
	}

	if cfg.Frontmatter.IncludeID == nil {
		t.Error("Expected include_id to be set")
	} else if !*cfg.Frontmatter.IncludeID {
		t.Error("Expected include_id to be true (default)")
	}

	if cfg.Frontmatter.IncludeDates == nil {
		t.Error("Expected include_dates to be set")
	} else if !*cfg.Frontmatter.IncludeDates {
		t.Error("Expected include_dates to be true (default)")
	}

	if cfg.Frontmatter.IncludeMetadata == nil {
		t.Error("Expected include_metadata to be set")
	} else if !*cfg.Frontmatter.IncludeMetadata {
		t.Error("Expected include_metadata to be true (default)")
	}
}

func TestLoadSynthesisTemplateFromFile_YAML(t *testing.T) {
	tmpDir := t.TempDir()
	yamlFile := filepath.Join(tmpDir, "synthesis.yaml")

	yamlContent := `header: "# {{.Intent}}"
footer: "---"
learnings_section:
  title: "## Learnings"
  item_template: "### {{.Title}}"
  content_preview_length: 200
`

	if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	cfg, err := LoadSynthesisTemplateFromFile(yamlFile)
	if err != nil {
		t.Fatalf("LoadSynthesisTemplateFromFile failed: %v", err)
	}

	if cfg.Header != "# {{.Intent}}" {
		t.Errorf("Expected header to be '# {{.Intent}}', got %q", cfg.Header)
	}

	if cfg.Footer != "---" {
		t.Errorf("Expected footer to be '---', got %q", cfg.Footer)
	}

	if cfg.LearningsSection == nil {
		t.Fatal("Expected learnings_section to be set")
	}

	if cfg.LearningsSection.Title != "## Learnings" {
		t.Errorf("Expected learnings title to be '## Learnings', got %q", cfg.LearningsSection.Title)
	}

	if cfg.LearningsSection.ContentPreviewLength != 200 {
		t.Errorf("Expected preview length to be 200, got %d", cfg.LearningsSection.ContentPreviewLength)
	}
}

func TestLoadSynthesisTemplateFromFile_TMPL_Unsupported(t *testing.T) {
	tmpDir := t.TempDir()
	tmplFile := filepath.Join(tmpDir, "synthesis.tmpl")

	if err := os.WriteFile(tmplFile, []byte("content"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err := LoadSynthesisTemplateFromFile(tmplFile)
	if err == nil {
		t.Error("Expected error for .tmpl format in synthesis template, got nil")
	}
}

func TestLoadMemoryTemplateFromFile_InvalidExtension(t *testing.T) {
	tmpDir := t.TempDir()
	invalidFile := filepath.Join(tmpDir, "memory.txt")

	if err := os.WriteFile(invalidFile, []byte("content"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err := LoadMemoryTemplateFromFile(invalidFile)
	if err == nil {
		t.Error("Expected error for invalid extension, got nil")
	}
}

func TestValidateMemoryTemplateFile(t *testing.T) {
	tmpDir := t.TempDir()
	yamlFile := filepath.Join(tmpDir, "memory.yaml")

	yamlContent := `body: "# {{.Title}}\n\n{{.Content}}"`

	if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	result, err := ValidateMemoryTemplateFile(yamlFile)
	if err != nil {
		t.Fatalf("ValidateMemoryTemplateFile failed: %v", err)
	}

	if !result.Valid {
		t.Errorf("Expected template to be valid, got errors: %v", result.Errors)
	}
}

func TestValidateMemoryTemplateFile_InvalidTemplate(t *testing.T) {
	tmpDir := t.TempDir()
	yamlFile := filepath.Join(tmpDir, "memory.yaml")

	// Invalid Go template syntax
	yamlContent := `body: "{{.Title"`

	if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	result, err := ValidateMemoryTemplateFile(yamlFile)
	if err != nil {
		t.Fatalf("ValidateMemoryTemplateFile failed: %v", err)
	}

	if result.Valid {
		t.Error("Expected template to be invalid")
	}

	if len(result.Errors) == 0 {
		t.Error("Expected validation errors, got none")
	}
}

func TestLoadMarkdownTemplateFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	yamlFile := filepath.Join(tmpDir, "markdown.yaml")

	yamlContent := `memory:
  body: "{{.Content}}"
synthesis:
  header: "# {{.Intent}}"
`

	if err := os.WriteFile(yamlFile, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	cfg, err := LoadMarkdownTemplateFromFile(yamlFile)
	if err != nil {
		t.Fatalf("LoadMarkdownTemplateFromFile failed: %v", err)
	}

	if cfg.Memory == nil {
		t.Fatal("Expected memory config to be set")
	}

	if cfg.Memory.Body != "{{.Content}}" {
		t.Errorf("Expected memory body to be '{{.Content}}', got %q", cfg.Memory.Body)
	}

	if cfg.Synthesis == nil {
		t.Fatal("Expected synthesis config to be set")
	}

	if cfg.Synthesis.Header != "# {{.Intent}}" {
		t.Errorf("Expected synthesis header to be '# {{.Intent}}', got %q", cfg.Synthesis.Header)
	}
}
