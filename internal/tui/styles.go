// Package tui provides shared styling, rendering helpers, spinner, and form
// utilities for the Cortex CLI using the Charm library suite.
package tui

import "github.com/charmbracelet/lipgloss"

// Adaptive color pairs for automatic light/dark terminal theme support.
var (
	colorPrimary  = lipgloss.AdaptiveColor{Light: "#874BFD", Dark: "#7D56F4"}
	colorWorking  = lipgloss.AdaptiveColor{Light: "#0066CC", Dark: "#5BC8F5"}
	colorEpisodic = lipgloss.AdaptiveColor{Light: "#B87333", Dark: "#F5B65B"}
	colorSemantic = lipgloss.AdaptiveColor{Light: "#2E7D32", Dark: "#73F59F"}
	colorSuccess  = lipgloss.AdaptiveColor{Light: "#2E7D32", Dark: "#73F59F"}
	colorError    = lipgloss.AdaptiveColor{Light: "#C62828", Dark: "#FF5252"}
	colorWarning  = lipgloss.AdaptiveColor{Light: "#B87333", Dark: "#F5B65B"}
	colorSubtle   = lipgloss.AdaptiveColor{Light: "#9999AA", Dark: "#6C6C7E"}
)

// Exported styles used by CLI commands and the renderer.
var (
	// Success, Error, Warning are used for status indicators.
	Success = lipgloss.NewStyle().Bold(true).Foreground(colorSuccess)
	Error   = lipgloss.NewStyle().Bold(true).Foreground(colorError)
	Warning = lipgloss.NewStyle().Foreground(colorWarning)
	Subtle  = lipgloss.NewStyle().Foreground(colorSubtle)
	Bold    = lipgloss.NewStyle().Bold(true)

	// Label is for key names in key-value output.
	Label = lipgloss.NewStyle().Bold(true).Foreground(colorSubtle)

	// Level styles use foreground-only color so display width equals text width.
	// This keeps table column alignment correct even when levels are styled.
	LevelWorking  = lipgloss.NewStyle().Bold(true).Foreground(colorWorking)
	LevelEpisodic = lipgloss.NewStyle().Bold(true).Foreground(colorEpisodic)
	LevelSemantic = lipgloss.NewStyle().Bold(true).Foreground(colorSemantic)

	// Score styles indicate similarity quality.
	ScoreHigh = lipgloss.NewStyle().Bold(true).Foreground(colorSuccess)
	ScoreMid  = lipgloss.NewStyle().Foreground(colorWarning)
	ScoreLow  = lipgloss.NewStyle().Foreground(colorSubtle)

	// Table styles applied via the table package StyleFunc.
	TableHeader = lipgloss.NewStyle().Bold(true).Foreground(colorPrimary)
	TableBorder = lipgloss.NewStyle().Foreground(colorSubtle)

	// DetailBox wraps single-item detail views (get, create success).
	DetailBox = lipgloss.NewStyle().
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(colorPrimary).
			Padding(0, 2).
			MarginTop(1).
			MarginBottom(1)

	// SectionTitle is used for headers within detail views and stats.
	SectionTitle = lipgloss.NewStyle().Bold(true).Foreground(colorPrimary)

	// SpinnerStyle colors the spinner animation frames.
	SpinnerStyle = lipgloss.NewStyle().Foreground(colorPrimary)
)
