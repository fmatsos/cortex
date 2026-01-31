package json

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

func TestToMemoryJSON(t *testing.T) {
	mem := &memory.Memory{
		ID:        "test-id-123",
		Title:     "Test Memory",
		Content:   "This is test content.",
		Types:     []memory.MemoryType{memory.MemoryTypeSolution, memory.MemoryTypeAnalysis},
		Tags:      []string{"go", "testing"},
		CreatedAt: time.Date(2024, 1, 15, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2024, 1, 15, 12, 0, 0, 0, time.UTC),
		Obsolete:  false,
		Metadata: map[string]string{
			"author": "tester",
		},
	}

	mj := ToMemoryJSON(mem)

	if mj.ID != mem.ID {
		t.Errorf("ID = %q, want %q", mj.ID, mem.ID)
	}
	if mj.Title != mem.Title {
		t.Errorf("Title = %q, want %q", mj.Title, mem.Title)
	}
	if mj.Content != mem.Content {
		t.Errorf("Content = %q, want %q", mj.Content, mem.Content)
	}
	if len(mj.Types) != len(mem.Types) {
		t.Errorf("Types length = %d, want %d", len(mj.Types), len(mem.Types))
	}
	if mj.Types[0] != "solution" {
		t.Errorf("Types[0] = %q, want %q", mj.Types[0], "solution")
	}
}

func TestMemoryJSONToMemory(t *testing.T) {
	tests := []struct {
		name        string
		json        MemoryJSON
		wantErr     bool
		errContains string
	}{
		{
			name: "valid memory json",
			json: MemoryJSON{
				ID:        "test-id",
				Title:     "Test Memory",
				Content:   "Content here",
				Types:     []string{"solution"},
				Tags:      []string{"test"},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			},
			wantErr: false,
		},
		{
			name: "valid with multiple types",
			json: MemoryJSON{
				Title:   "Multi-type Memory",
				Content: "Content",
				Types:   []string{"issue", "solution", "analysis"},
			},
			wantErr: false,
		},
		{
			name: "missing title",
			json: MemoryJSON{
				Content: "Content",
				Types:   []string{"solution"},
			},
			wantErr:     true,
			errContains: "title is required",
		},
		{
			name: "missing types",
			json: MemoryJSON{
				Title:   "No Types",
				Content: "Content",
				Types:   []string{},
			},
			wantErr:     true,
			errContains: "at least one type is required",
		},
		{
			name: "invalid type",
			json: MemoryJSON{
				Title:   "Invalid Type",
				Content: "Content",
				Types:   []string{"invalid"},
			},
			wantErr:     true,
			errContains: "invalid type",
		},
		{
			name: "generates ID when missing",
			json: MemoryJSON{
				Title:   "No ID",
				Content: "Content",
				Types:   []string{"any"},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mem, err := tt.json.ToMemory()

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

			if mem.Title != tt.json.Title {
				t.Errorf("Title = %q, want %q", mem.Title, tt.json.Title)
			}

			// Check ID generation
			if tt.json.ID == "" && mem.ID == "" {
				t.Error("ID should be generated when not provided")
			}
			if tt.json.ID == "" && len(mem.ID) != 36 {
				t.Errorf("Generated ID should be UUID format, got length %d", len(mem.ID))
			}
		})
	}
}

func TestExportMemory(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-export-test")
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

	var mj MemoryJSON
	if err := json.Unmarshal(content, &mj); err != nil {
		t.Fatalf("failed to parse exported JSON: %v", err)
	}

	if mj.ID != mem.ID {
		t.Errorf("ID = %q, want %q", mj.ID, mem.ID)
	}
	if mj.Title != mem.Title {
		t.Errorf("Title = %q, want %q", mj.Title, mem.Title)
	}
	if len(mj.Types) != len(mem.Types) {
		t.Errorf("Types length = %d, want %d", len(mj.Types), len(mem.Types))
	}
}

func TestImportFile(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-import-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test JSON file
	testJSON := MemoryJSON{
		ID:      "import-test-id",
		Title:   "Import Test",
		Content: "This is imported content.",
		Types:   []string{"issue", "solution"},
		Tags:    []string{"imported"},
		Metadata: map[string]string{
			"source": "test",
		},
	}

	jsonBytes, _ := json.MarshalIndent(testJSON, "", "  ")
	testFile := filepath.Join(tmpDir, "test.json")
	if err := os.WriteFile(testFile, jsonBytes, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Import
	importer := NewImporter()
	mem, err := importer.ImportFile(testFile)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// Verify memory
	if mem.ID != testJSON.ID {
		t.Errorf("ID = %q, want %q", mem.ID, testJSON.ID)
	}
	if mem.Title != testJSON.Title {
		t.Errorf("Title = %q, want %q", mem.Title, testJSON.Title)
	}
	if len(mem.Types) != 2 {
		t.Errorf("Types count = %d, want 2", len(mem.Types))
	}
	if len(mem.Tags) != 1 || mem.Tags[0] != "imported" {
		t.Errorf("Tags = %v, want [imported]", mem.Tags)
	}
}

func TestImportFileWithoutID(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-import-noid-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test file without ID
	testJSON := MemoryJSON{
		Title:   "No ID Memory",
		Content: "Content without ID.",
		Types:   []string{"any"},
	}

	jsonBytes, _ := json.Marshal(testJSON)
	testFile := filepath.Join(tmpDir, "noid.json")
	if err := os.WriteFile(testFile, jsonBytes, 0644); err != nil {
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
	tmpDir, err := os.MkdirTemp("", "cortex-json-roundtrip-test")
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
	if imported.Content != original.Content {
		t.Errorf("Content mismatch:\ngot: %q\nwant: %q", imported.Content, original.Content)
	}
	if len(imported.Types) != len(original.Types) {
		t.Errorf("Types count mismatch: got %d, want %d", len(imported.Types), len(original.Types))
	}
	if len(imported.Tags) != len(original.Tags) {
		t.Errorf("Tags count mismatch: got %d, want %d", len(imported.Tags), len(original.Tags))
	}
	if len(imported.Metadata) != len(original.Metadata) {
		t.Errorf("Metadata count mismatch: got %d, want %d", len(imported.Metadata), len(original.Metadata))
	}
}

func TestExportSynthesis(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-synthesis-test")
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

	var synthesis SynthesisJSON
	if err := json.Unmarshal(content, &synthesis); err != nil {
		t.Fatalf("failed to parse synthesis JSON: %v", err)
	}

	if synthesis.Type != "synthesis" {
		t.Errorf("Type = %q, want %q", synthesis.Type, "synthesis")
	}
	if synthesis.Intent != "authentication patterns" {
		t.Errorf("Intent = %q, want %q", synthesis.Intent, "authentication patterns")
	}
	if len(synthesis.SourceMemories) != 2 {
		t.Errorf("SourceMemories count = %d, want 2", len(synthesis.SourceMemories))
	}
	if synthesis.SourceMemories[0].Score != 0.92 {
		t.Errorf("First score = %f, want 0.92", synthesis.SourceMemories[0].Score)
	}
}

func TestMarshalSearchResults(t *testing.T) {
	results := []*memory.SearchResult{
		{
			Memory: &memory.Memory{
				ID:      "test-1",
				Title:   "Test Memory 1",
				Content: "Content 1",
				Types:   []memory.MemoryType{memory.MemoryTypeSolution},
			},
			Score: 0.95,
		},
		{
			Memory: &memory.Memory{
				ID:      "test-2",
				Title:   "Test Memory 2",
				Content: "Content 2",
				Types:   []memory.MemoryType{memory.MemoryTypeIssue},
			},
			Score: 0.80,
		},
	}

	jsonBytes, err := MarshalSearchResults(results, false)
	if err != nil {
		t.Fatalf("MarshalSearchResults failed: %v", err)
	}

	var response struct {
		Count   int                `json:"count"`
		Results []SearchResultJSON `json:"results"`
	}

	if err := json.Unmarshal(jsonBytes, &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if response.Count != 2 {
		t.Errorf("Count = %d, want 2", response.Count)
	}
	if len(response.Results) != 2 {
		t.Errorf("Results length = %d, want 2", len(response.Results))
	}
	if response.Results[0].Score != 0.95 {
		t.Errorf("First score = %f, want 0.95", response.Results[0].Score)
	}
}

func TestMarshalMemories(t *testing.T) {
	memories := []*memory.Memory{
		{
			ID:      "test-1",
			Title:   "Test Memory 1",
			Content: "Content 1",
			Types:   []memory.MemoryType{memory.MemoryTypeSolution},
		},
		{
			ID:      "test-2",
			Title:   "Test Memory 2",
			Content: "Content 2",
			Types:   []memory.MemoryType{memory.MemoryTypeIssue},
		},
	}

	jsonBytes, err := MarshalMemories(memories, true)
	if err != nil {
		t.Fatalf("MarshalMemories failed: %v", err)
	}

	var response struct {
		Count    int          `json:"count"`
		Memories []MemoryJSON `json:"memories"`
	}

	if err := json.Unmarshal(jsonBytes, &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if response.Count != 2 {
		t.Errorf("Count = %d, want 2", response.Count)
	}
	if len(response.Memories) != 2 {
		t.Errorf("Memories length = %d, want 2", len(response.Memories))
	}
}

func TestImportBatch(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-batch-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create batch export file
	batch := BatchExportJSON{
		ExportedAt: time.Now(),
		Count:      2,
		Memories: []MemoryJSON{
			{
				ID:      "batch-1",
				Title:   "Batch Memory 1",
				Content: "Content 1",
				Types:   []string{"solution"},
			},
			{
				ID:      "batch-2",
				Title:   "Batch Memory 2",
				Content: "Content 2",
				Types:   []string{"issue"},
			},
		},
	}

	jsonBytes, _ := json.MarshalIndent(batch, "", "  ")
	batchFile := filepath.Join(tmpDir, "batch.json")
	if err := os.WriteFile(batchFile, jsonBytes, 0644); err != nil {
		t.Fatalf("failed to write batch file: %v", err)
	}

	// Import batch
	importer := NewImporter()
	memories, err := importer.ImportBatch(batchFile)
	if err != nil {
		t.Fatalf("batch import failed: %v", err)
	}

	if len(memories) != 2 {
		t.Errorf("imported memories count = %d, want 2", len(memories))
	}
	if memories[0].ID != "batch-1" {
		t.Errorf("first memory ID = %q, want %q", memories[0].ID, "batch-1")
	}
	if memories[1].ID != "batch-2" {
		t.Errorf("second memory ID = %q, want %q", memories[1].ID, "batch-2")
	}
}

func TestExpandGlob(t *testing.T) {
	// Create temp directory with test files
	tmpDir, err := os.MkdirTemp("", "cortex-json-glob-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test files
	for _, name := range []string{"test1.json", "test2.json", "other.md"} {
		if err := os.WriteFile(filepath.Join(tmpDir, name), []byte("{}"), 0644); err != nil {
			t.Fatalf("failed to create test file: %v", err)
		}
	}

	// Test glob
	matches, err := ExpandGlob(filepath.Join(tmpDir, "*.json"))
	if err != nil {
		t.Fatalf("ExpandGlob failed: %v", err)
	}

	if len(matches) != 2 {
		t.Errorf("matches count = %d, want 2", len(matches))
	}

	// Verify only .json files are matched
	for _, m := range matches {
		if filepath.Ext(m) != ".json" {
			t.Errorf("unexpected file extension in matches: %s", m)
		}
	}
}

func TestValidateFile(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "cortex-json-validate-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	tests := []struct {
		name    string
		content string
		wantErr bool
	}{
		{
			name:    "valid json",
			content: `{"title": "Test", "types": ["solution"], "content": "test"}`,
			wantErr: false,
		},
		{
			name:    "missing title",
			content: `{"types": ["solution"], "content": "test"}`,
			wantErr: true,
		},
		{
			name:    "missing types",
			content: `{"title": "Test", "content": "test"}`,
			wantErr: true,
		},
		{
			name:    "invalid json",
			content: `{invalid json}`,
			wantErr: true,
		},
	}

	importer := NewImporter()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testFile := filepath.Join(tmpDir, tt.name+".json")
			if err := os.WriteFile(testFile, []byte(tt.content), 0644); err != nil {
				t.Fatalf("failed to write test file: %v", err)
			}

			err := importer.ValidateFile(testFile)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateFile() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
