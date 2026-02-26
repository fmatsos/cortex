package tui

import (
	"os"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// workDoneMsg signals the background work goroutine has finished.
type workDoneMsg struct{ err error }

// spinnerModel is a minimal BubbleTea model that shows an animated spinner
// while a background function runs, then quits automatically on completion.
type spinnerModel struct {
	spinner spinner.Model
	label   string
	done    bool
	err     error
	work    func() tea.Msg
}

func (m spinnerModel) Init() tea.Cmd {
	// Start both the spinner animation tick and the background work in parallel.
	return tea.Batch(m.spinner.Tick, m.work)
}

func (m spinnerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case workDoneMsg:
		m.done = true
		m.err = msg.err
		return m, tea.Quit
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m spinnerModel) View() string {
	if m.done {
		if m.err != nil {
			return Error.Render("✗") + " " + m.label + "\n"
		}
		return Success.Render("✓") + " " + m.label + "\n"
	}
	return m.spinner.View() + " " + m.label + "\n"
}

// RunWithSpinner runs fn while displaying an animated spinner on stderr.
// If stderr is not an interactive terminal the function is executed directly
// without any spinner overhead.
func RunWithSpinner(label string, fn func() error) error {
	if !IsStderrTerminal() {
		return fn()
	}

	s := spinner.New()
	s.Spinner = spinner.MiniDot
	s.Style = SpinnerStyle

	m := spinnerModel{
		spinner: s,
		label:   label,
		work: func() tea.Msg {
			return workDoneMsg{err: fn()}
		},
	}

	p := tea.NewProgram(m, tea.WithOutput(os.Stderr))
	finalModel, err := p.Run()
	if err != nil {
		return err
	}
	return finalModel.(spinnerModel).err
}

// IsInteractive returns true if stdin is connected to an interactive terminal.
// Used to decide whether to show interactive forms.
func IsInteractive() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

// IsStderrTerminal returns true if stderr is connected to an interactive terminal.
func IsStderrTerminal() bool {
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
