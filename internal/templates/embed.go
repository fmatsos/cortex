// Package templates provides embedded templates for CLI output formatting.
package templates

import (
	"embed"
	"fmt"
	"io"
	"sync"
	"text/template"
)

//go:embed *.tmpl
var FS embed.FS

// templateCache stores parsed templates.
var templateCache = make(map[string]*template.Template)
var templateCacheMu sync.RWMutex

// Load loads and parses a template by name.
func Load(name string) (*template.Template, error) {
	templateCacheMu.RLock()
	if tmpl, ok := templateCache[name]; ok {
		templateCacheMu.RUnlock()
		return tmpl, nil
	}
	templateCacheMu.RUnlock()

	data, err := FS.ReadFile(name)
	if err != nil {
		return nil, fmt.Errorf("failed to read template %s: %w", name, err)
	}

	tmpl, err := template.New(name).Parse(string(data))
	if err != nil {
		return nil, fmt.Errorf("failed to parse template %s: %w", name, err)
	}

	templateCacheMu.Lock()
	templateCache[name] = tmpl
	templateCacheMu.Unlock()
	return tmpl, nil
}

// MustLoad loads a template or panics.
func MustLoad(name string) *template.Template {
	tmpl, err := Load(name)
	if err != nil {
		panic(err)
	}
	return tmpl
}

// Execute loads and executes a template with the given data.
func Execute(w io.Writer, name string, data any) error {
	tmpl, err := Load(name)
	if err != nil {
		return err
	}
	return tmpl.Execute(w, data)
}

// Available template names.
const (
	StatsTemplate     = "stats.txt.tmpl"
	ListTemplate      = "list.txt.tmpl"
	SearchTemplate    = "search.txt.tmpl"
	ConfigTemplate    = "config.txt.tmpl"
	SynthesisTemplate = "synthesis.md.tmpl"
)
