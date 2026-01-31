package markdown

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

func TestParseFrontmatter(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantTitle   string
		wantTypes   []string
		wantBody    string
		wantErr     bool
		errContains string
	}{
		{
			name: "valid frontmatter with all fields",
			content: `---
id: test-id-123
title: Test Memory
type:
  - solution
  - analysis
tags:
  - go
  - testing
obsolete: false
---

This is the body content.`,
			wantTitle: "Test Memory",
			wantTypes: []string{"solution", "analysis"},
			wantBody:  "This is the body content.",
			wantErr:   false,
		},
		{
			name: "minimal frontmatter",
			content: `---
title: Minimal Memory
type:
  - any
---

Body.`,
			wantTitle: "Minimal Memory",
			wantTypes: []string{"any"},
			wantBody:  "Body.",
			wantErr:   false,
		},
		{
			name:        "missing opening delimiter",
			content:     "title: Test\n---\nBody",
			wantErr:     true,
			errContains: "does not start with frontmatter",
		},
		{
			name:        "missing closing delimiter",
			content:     "---\ntitle: Test\n",
			wantErr:     true,
			errContains: "missing closing frontmatter",
		},
		{
			name: "empty body",
			content: `---
title: No Body
type:
  - rule
---
`,
			wantTitle: "No Body",
			wantTypes: []string{"rule"},
			wantBody:  "",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseFrontmatter([]byte(tt.content))

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
				} else if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %q", tt.errContains, err.Error())
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result.Frontmatter.Title != tt.wantTitle {
				t.Errorf("title = %q, want %q", result.Frontmatter.Title, tt.wantTitle)
			}

			if len(result.Frontmatter.Types) != len(tt.wantTypes) {
				t.Errorf("types length = %d, want %d", len(result.Frontmatter.Types), len(tt.wantTypes))
			}

			if strings.TrimSpace(result.Body) != strings.TrimSpace(tt.wantBody) {
				t.Errorf("body = %q, want %q", result.Body, tt.wantBody)
			}
		})
	}
}

func TestValidateFrontmatter(t *testing.T) {
	tests := []struct {
		name        string
		frontmatter *Frontmatter
		wantErr     bool
		errContains string
	}{
		{
			name: "valid frontmatter",
			frontmatter: &Frontmatter{
				Title: "Valid Memory",
				Types: []string{"solution"},
			},
			wantErr: false,
		},
		{
			name: "valid with multiple types",
			frontmatter: &Frontmatter{
				Title: "Multi-type Memory",
				Types: []string{"issue", "solution", "analysis"},
			},
			wantErr: false,
		},
		{
			name: "missing title",
			frontmatter: &Frontmatter{
				Title: "",
				Types: []string{"solution"},
			},
			wantErr:     true,
			errContains: "title is required",
		},
		{
			name: "missing types",
			frontmatter: &Frontmatter{
				Title: "No Types",
				Types: []string{},
			},
			wantErr:     true,
			errContains: "at least one type is required",
		},
		{
			name: "invalid type",
			frontmatter: &Frontmatter{
				Title: "Invalid Type",
				Types: []string{"invalid"},
			},
			wantErr:     true,
			errContains: "invalid type",
		},
		{
			name: "whitespace-only title",
			frontmatter: &Frontmatter{
				Title: "   ",
				Types: []string{"any"},
			},
			wantErr:     true,
			errContains: "title is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFrontmatter(tt.frontmatter)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
				} else if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %q", tt.errContains, err.Error())
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestExportMemory(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-export-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	exporter := NewExporter(tmpDir)

	mem := &memory.Memory{
		ID:      "test-export-id",
		Title:   "Export Test",
		Content: "This is test content.\n\n## Section\n\nMore content.",
		Types:   []memory.MemoryType{memory.MemoryTypeSolution},
		Tags:    []string{"test", "export"},
		Metadata: map[string]string{
			"author": "tester",
		},
		CreatedAt: time.Date(2024, 1, 15, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2024, 1, 15, 10, 0, 0, 0, time.UTC),
		Obsolete:  false,
	}

	// Export
	path, err := exporter.ExportMemory(mem)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatalf("exported file does not exist: %s", path)
	}

	// Read and verify content
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	contentStr := string(content)

	// Check frontmatter
	if !strings.Contains(contentStr, "id: test-export-id") {
		t.Error("exported file missing id")
	}
	if !strings.Contains(contentStr, "title: Export Test") {
		t.Error("exported file missing title")
	}
	if !strings.Contains(contentStr, "- solution") {
		t.Error("exported file missing type")
	}
	if !strings.Contains(contentStr, "- test") {
		t.Error("exported file missing tags")
	}

	// Check body
	if !strings.Contains(contentStr, "This is test content.") {
		t.Error("exported file missing body content")
	}
}

func TestImportFile(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-import-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test file
	testContent := `---
id: import-test-id
title: Import Test
type:
  - issue
  - solution
tags:
  - imported
metadata:
  source: test
---

This is imported content.

## Analysis

Some analysis here.
`
	testFile := filepath.Join(tmpDir, "test.md")
	if err := os.WriteFile(testFile, []byte(testContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Import
	importer := NewImporter()
	mem, err := importer.ImportFile(testFile)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// Verify memory
	if mem.ID != "import-test-id" {
		t.Errorf("ID = %q, want %q", mem.ID, "import-test-id")
	}
	if mem.Title != "Import Test" {
		t.Errorf("Title = %q, want %q", mem.Title, "Import Test")
	}
	if len(mem.Types) != 2 {
		t.Errorf("Types count = %d, want 2", len(mem.Types))
	}
	if len(mem.Tags) != 1 || mem.Tags[0] != "imported" {
		t.Errorf("Tags = %v, want [imported]", mem.Tags)
	}
	if !strings.Contains(mem.Content, "This is imported content.") {
		t.Error("Content missing expected text")
	}
}

func TestImportFileWithoutID(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-import-noid-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test file without ID
	testContent := `---
title: No ID Memory
type:
  - any
---

Content without ID.
`
	testFile := filepath.Join(tmpDir, "noid.md")
	if err := os.WriteFile(testFile, []byte(testContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Import
	importer := NewImporter()
	mem, err := importer.ImportFile(testFile)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// Verify ID was generated
	if mem.ID == "" {
		t.Error("ID should be generated when not provided")
	}
	// UUID format check (simple)
	if len(mem.ID) != 36 {
		t.Errorf("Generated ID should be UUID format, got length %d", len(mem.ID))
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-roundtrip-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Original memory
	original := &memory.Memory{
		ID:      "roundtrip-test-id",
		Title:   "Round Trip Test",
		Content: "This content should survive the round trip.\n\n## Code\n\n```go\nfunc test() {}\n```",
		Types:   []memory.MemoryType{memory.MemoryTypeAnalysis, memory.MemoryTypeRule},
		Tags:    []string{"roundtrip", "test"},
		Metadata: map[string]string{
			"key1": "value1",
			"key2": "value2",
		},
		CreatedAt: time.Date(2024, 1, 15, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2024, 1, 15, 12, 0, 0, 0, time.UTC),
		Obsolete:  false,
	}

	// Export
	exporter := NewExporter(tmpDir)
	path, err := exporter.ExportMemory(original)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	// Import
	importer := NewImporter()
	imported, err := importer.ImportFile(path)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// Compare (excluding Embedding which is not exported)
	if imported.ID != original.ID {
		t.Errorf("ID mismatch: got %q, want %q", imported.ID, original.ID)
	}
	if imported.Title != original.Title {
		t.Errorf("Title mismatch: got %q, want %q", imported.Title, original.Title)
	}
	if strings.TrimSpace(imported.Content) != strings.TrimSpace(original.Content) {
		t.Errorf("Content mismatch:\ngot: %q\nwant: %q", imported.Content, original.Content)
	}
	if len(imported.Types) != len(original.Types) {
		t.Errorf("Types count mismatch: got %d, want %d", len(imported.Types), len(original.Types))
	}
	if len(imported.Tags) != len(original.Tags) {
		t.Errorf("Tags count mismatch: got %d, want %d", len(imported.Tags), len(original.Tags))
	}
}

func TestValidateTypes(t *testing.T) {
	tests := []struct {
		name    string
		types   []string
		wantErr bool
	}{
		{"single valid", []string{"solution"}, false},
		{"multiple valid", []string{"issue", "solution", "analysis"}, false},
		{"all valid types", []string{"solution", "issue", "analysis", "rule", "any"}, false},
		{"empty", []string{}, true},
		{"invalid type", []string{"invalid"}, true},
		{"mixed valid invalid", []string{"solution", "invalid"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTypes(tt.types)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTypes() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestExportSynthesis(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-synthesis-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	exporter := NewExporter(tmpDir)

	results := []*memory.SearchResult{
		{
			Memory: &memory.Memory{
				ID:      "mem-1",
				Title:   "First Memory",
				Content: "First memory content about authentication.",
				Types:   []memory.MemoryType{memory.MemoryTypeSolution},
			},
			Score: 0.92,
		},
		{
			Memory: &memory.Memory{
				ID:      "mem-2",
				Title:   "Second Memory",
				Content: "Second memory content about tokens.",
				Types:   []memory.MemoryType{memory.MemoryTypeAnalysis},
			},
			Score: 0.85,
		},
	}

	path, err := exporter.ExportSynthesis("authentication patterns", results)
	if err != nil {
		t.Fatalf("synthesis export failed: %v", err)
	}

	// Read and verify content
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read synthesis file: %v", err)
	}

	contentStr := string(content)

	// Check frontmatter
	if !strings.Contains(contentStr, "type: synthesis") {
		t.Error("synthesis file missing type")
	}
	if !strings.Contains(contentStr, "intent: authentication patterns") {
		t.Error("synthesis file missing intent")
	}

	// Check body
	if !strings.Contains(contentStr, "Authentication Patterns - Synthesis") {
		t.Error("synthesis file missing title")
	}
	if !strings.Contains(contentStr, "First Memory") {
		t.Error("synthesis file missing first memory reference")
	}
	if !strings.Contains(contentStr, "score: 0.92") {
		t.Error("synthesis file missing first memory score")
	}
}
