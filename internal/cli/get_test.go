package cli

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/spf13/cobra"
)

func TestOutputGetJSON_UsesDerivedTitleFallback(t *testing.T) {
	cmd := &cobra.Command{}
	buf := new(bytes.Buffer)
	cmd.SetOut(buf)

	m := &memory.Memory{
		ID:      "id-1",
		Title:   "",
		Content: "Derived title first line\nother content",
		Level:   memory.MemoryLevelWorking,
	}

	if err := outputGetJSON(cmd, m); err != nil {
		t.Fatalf("outputGetJSON() error = %v", err)
	}

	var payload struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	if payload.Title != "Derived title first line" {
		t.Fatalf("title = %q, want %q", payload.Title, "Derived title first line")
	}
}
