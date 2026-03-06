package tui

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
	"github.com/charmbracelet/x/term"
)

// FormatLevel returns a colored memory level string.
// Uses foreground-only styling so display width equals text width, which keeps
// table alignment correct when rendered inside table cells.
func FormatLevel(level string) string {
	switch level {
	case "working":
		return LevelWorking.Render(level)
	case "episodic":
		return LevelEpisodic.Render(level)
	case "semantic":
		return LevelSemantic.Render(level)
	default:
		return level
	}
}

// FormatScore returns a score value colored by quality tier.
func FormatScore(score float64) string {
	s := fmt.Sprintf("%.2f", score)
	switch {
	case score >= 0.85:
		return ScoreHigh.Render(s)
	case score >= 0.65:
		return ScoreMid.Render(s)
	default:
		return ScoreLow.Render(s)
	}
}

// FormatTags returns a comma-separated tag string, or a subtle "none" hint.
func FormatTags(tags []string) string {
	if len(tags) == 0 {
		return Subtle.Render("none")
	}
	return strings.Join(tags, ", ")
}

// FormatStatus returns ✓ or ✗ styled appropriately.
func FormatStatus(ok bool) string {
	if ok {
		return Success.Render("✓")
	}
	return Error.Render("✗")
}

// SuccessMsg returns a styled success line (checkmark + message).
func SuccessMsg(msg string) string {
	return Success.Render("✓") + " " + msg
}

// ErrMsg returns a styled error line (X + message).
func ErrMsg(msg string) string {
	return Error.Render("✗") + " " + msg
}

// WarnMsg returns a styled warning line (! + message).
func WarnMsg(msg string) string {
	return Warning.Render("!") + " " + msg
}

// SkipMsg returns a styled skip line (- + message).
func SkipMsg(msg string) string {
	return Subtle.Render("-") + " " + msg
}

// KeyValue renders a styled key: value pair.
func KeyValue(key, value string) string {
	return Label.Render(key+":") + "  " + value
}

// SectionHeader renders a bold, colored section header string.
func SectionHeader(title string) string {
	return SectionTitle.Render(title)
}

// ShortID returns the first 8 characters of a UUID followed by "…".
func ShortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8] + "…"
}

// RenderTable renders rows as a bordered, styled table using lipgloss/table.
// Headers drive the column count. Row cells may contain ANSI-styled strings;
// lipgloss/table measures their display width correctly.
func RenderTable(headers []string, rows [][]string) string {
	t := table.New().
		BorderStyle(TableBorder).
		StyleFunc(func(row, col int) lipgloss.Style {
			if row == table.HeaderRow {
				return TableHeader
			}
			return lipgloss.NewStyle()
		}).
		Headers(headers...).
		Rows(rows...)
	return t.String()
}

// RenderDetail renders key-value pairs as a two-column table with a rounded border.
// The title (if non-empty) appears above the table in bold. Terminal width is detected
// automatically so that long values wrap within the value column; when running outside
// a terminal the table expands to fit its content.
func RenderDetail(title string, lines [][2]string) string {
	var sb strings.Builder

	sb.WriteString("\n")
	if title != "" {
		sb.WriteString(Bold.Render(title))
		sb.WriteString("\n")
	}

	rows := make([][]string, len(lines))
	for i, kv := range lines {
		rows[i] = []string{kv[0], kv[1]}
	}

	t := table.New().
		Border(lipgloss.RoundedBorder()).
		BorderStyle(lipgloss.NewStyle().Foreground(colorPrimary)).
		BorderColumn(true).
		StyleFunc(func(row, col int) lipgloss.Style {
			if col == 0 {
				return Label.Padding(0, 1)
			}
			return lipgloss.NewStyle().Padding(0, 1)
		}).
		Rows(rows...)

	if w, _, err := term.GetSize(os.Stdout.Fd()); err == nil && w > 0 {
		t = t.Width(w)
	}

	sb.WriteString(t.String())
	return sb.String()
}
