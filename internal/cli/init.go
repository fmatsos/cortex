package cli

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

const (
	cortexRulesMarkerStart = "<!-- cortex-rules-start -->"
	cortexRulesMarkerEnd   = "<!-- cortex-rules-end -->"
)

// cortexCLIRulesSection returns the Markdown block for CLI binary usage.
func cortexCLIRulesSection() string {
	return `## Cortex – Persistent Memory

**IMPORTANT: Always search Cortex memories BEFORE starting a task, and store what you learned AFTER completing it.**

### When to Use Cortex (REQUIRED)

Run ` + "`cortex`" + ` CLI commands proactively:

- **Before any non-trivial task** — run ` + "`cortex search`" + ` first to surface relevant context
- **After completing work** — store decisions, patterns, and findings
- **When making architectural decisions** — check for prior context
- **When debugging** — search for prior solutions to similar issues
- When the user mentions "remember", "store", "recall", or "what did we..."

### CLI Commands Reference

| Command | When to use |
|---------|-------------|
| ` + "`cortex search \"<query>\"`" + ` | Find relevant context before starting a task |
| ` + "`cortex create --title \"...\" --level <level> --content \"...\"`" + ` | Store new facts, decisions, or findings |
| ` + "`cortex list [--level <level>]`" + ` | Browse memories by level |
| ` + "`cortex get <id>`" + ` | Retrieve a specific memory by ID |
| ` + "`cortex delete <id>`" + ` | Permanently remove a memory |
| ` + "`cortex consolidate \"<synthesis>\" --level <level>`" + ` | Synthesise related memories into one |
| ` + "`cortex transfer-working`" + ` | Promote all working memories to episodic at session end |
| ` + "`cortex autoprune`" + ` | Remove duplicate and expired memories |

### Memory Levels

| Level | Use for | Retention |
|-------|---------|-----------|
| ` + "`working`" + ` | Session context, active tasks, debug notes | Until transferred |
| ` + "`episodic`" + ` | Bug fixes, decisions, incidents, meetings | 90 days (default) |
| ` + "`semantic`" + ` | Conventions, patterns, architecture, best practices | Permanent |

### Workflow

1. **Session start**: ` + "`cortex search \"<task topic>\"`" + ` to surface relevant context
2. **During work**: ` + "`cortex create`" + ` to capture key decisions and findings
3. **Session end**: ` + "`cortex transfer-working`" + ` to promote working memories to episodic`
}

// cortexMCPRulesSection returns the Markdown block for MCP tool usage.
func cortexMCPRulesSection() string {
	return `## Cortex – Persistent Memory

**IMPORTANT: Always search Cortex memories BEFORE starting a task, and store what you learned AFTER completing it.**

### When to Use Cortex (REQUIRED)

Invoke ` + "`cortex_*`" + ` MCP tools proactively:

- **Before any non-trivial task** — call ` + "`cortex_search`" + ` first to surface relevant context
- **After completing work** — store decisions, patterns, and findings
- **When making architectural decisions** — check for prior context
- **When debugging** — search for prior solutions to similar issues
- When the user mentions "remember", "store", "recall", or "what did we..."

### MCP Tools Reference

| Tool | When to call |
|------|--------------|
| ` + "`cortex_search`" + ` | Find relevant context before starting a task |
| ` + "`cortex_create`" + ` | Store new facts, decisions, or findings |
| ` + "`cortex_list`" + ` | Browse memories by level |
| ` + "`cortex_get`" + ` | Retrieve a specific memory by ID |
| ` + "`cortex_update_memory`" + ` | Fix or improve an existing memory |
| ` + "`cortex_mark_obsolete`" + ` | Retire outdated memories |
| ` + "`cortex_promote_memory`" + ` | Elevate working → episodic or episodic → semantic |
| ` + "`cortex_consolidate`" + ` | Synthesise related memories into one |
| ` + "`cortex_review_session`" + ` | End-of-session: review and promote working memories |
| ` + "`cortex_think_about_task_completion`" + ` | Post-task reflection checkpoint |
| ` + "`cortex_think_about_memory_maintenance`" + ` | Periodic memory health check |
| ` + "`cortex_choose_memory_layer`" + ` | Decide which level to store a new memory at |

### Memory Levels

| Level | Use for | Retention |
|-------|---------|-----------|
| ` + "`working`" + ` | Session context, active tasks, debug notes | Until transferred |
| ` + "`episodic`" + ` | Bug fixes, decisions, incidents, meetings | 90 days (default) |
| ` + "`semantic`" + ` | Conventions, patterns, architecture, best practices | Permanent |

### Workflow

1. **Session start**: ` + "`cortex_search`" + ` for context relevant to your task
2. **During work**: ` + "`cortex_create`" + ` to capture key decisions and findings
3. **Session end**: ` + "`cortex_review_session`" + ` to consolidate working memories`
}

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialise Cortex in the current project",
	Long: `Inject Cortex agent rules into AGENTS.md and/or CLAUDE.md.

By default, rules describe how to use the cortex CLI binary. Pass --mcp to
inject rules for MCP tool usage instead.

Use --skills and --hooks to also install skill files and session hook scripts.

If neither AGENTS.md nor CLAUDE.md exists in the current directory, AGENTS.md
is created. If CLAUDE.md is a symlink to AGENTS.md, it is not written separately.

Re-run with --force to update an existing Cortex rules section.

Examples:
  cortex init                    # CLI rules into AGENTS.md / CLAUDE.md
  cortex init --mcp              # MCP tool rules instead of CLI rules
  cortex init --skills           # rules + install skill files
  cortex init --hooks            # rules + install Claude Code hooks
  cortex init --skills --hooks   # rules + skills + hooks
  cortex init --force            # overwrite existing Cortex section`,
	RunE: runInit,
}

var (
	initForce  bool
	initMCP    bool
	initSkills bool
	initHooks  bool
)

func init() {
	initCmd.Flags().BoolVar(&initForce, "force", false, "Overwrite existing Cortex rules section")
	initCmd.Flags().BoolVar(&initMCP, "mcp", false, "Inject MCP tool rules instead of CLI binary rules")
	initCmd.Flags().BoolVar(&initSkills, "skills", false, "Also install Cortex agent skill files")
	initCmd.Flags().BoolVar(&initHooks, "hooks", false, "Also install Claude Code session hooks")
	rootCmd.AddCommand(initCmd)
}

func runInit(cmd *cobra.Command, _ []string) error {
	out := cmd.OutOrStdout()

	section := cortexCLIRulesSection()
	if initMCP {
		section = cortexMCPRulesSection()
	}

	targets := resolveInitTargets()

	_, _ = fmt.Fprintln(out, "Injecting Cortex rules...")
	for _, path := range targets {
		if err := injectCortexRules(cmd, path, section, initForce); err != nil {
			return fmt.Errorf("failed to update %s: %w", path, err)
		}
	}

	if initSkills {
		_, _ = fmt.Fprintln(out, "\nInstalling skills...")
		skillsInstallClaude = false
		skillsInstallCopilot = false
		skillsInstallGlobal = false
		skillsInstallForce = initForce
		if err := runSkillsInstall(cmd, nil); err != nil {
			return err
		}
	}

	if initHooks {
		_, _ = fmt.Fprintln(out, "\nInstalling hooks...")
		hooksInitClaude = false
		hooksInitCopilot = false
		hooksInitDir = ""
		hooksInitForce = initForce
		if err := runHooksInitClaude(cmd); err != nil {
			return err
		}
	}

	_, _ = fmt.Fprintln(out, "\nDone. Cortex is ready for this project.")
	return nil
}

// resolveInitTargets returns the list of files to inject Cortex rules into.
// - AGENTS.md is always included if it exists.
// - CLAUDE.md is included only if it exists and is NOT the same file as AGENTS.md.
// - If neither exists, AGENTS.md is returned (will be created).
func resolveInitTargets() []string {
	agentsExists := fileExistsInit("AGENTS.md")
	claudeExists := fileExistsInit("CLAUDE.md")

	if !agentsExists && !claudeExists {
		return []string{"AGENTS.md"}
	}

	var targets []string
	if agentsExists {
		targets = append(targets, "AGENTS.md")
	}
	if claudeExists && !isSameFileInit("CLAUDE.md", "AGENTS.md") {
		targets = append(targets, "CLAUDE.md")
	}
	return targets
}

// injectCortexRules appends (or replaces) the Cortex rules section in the given file.
func injectCortexRules(cmd *cobra.Command, filePath, sectionContent string, force bool) error {
	section := cortexRulesMarkerStart + "\n" + sectionContent + "\n" + cortexRulesMarkerEnd

	existing, err := os.ReadFile(filePath)
	if os.IsNotExist(err) {
		content := section + "\n"
		if writeErr := os.WriteFile(filePath, []byte(content), 0644); writeErr != nil {
			return fmt.Errorf("failed to create %s: %w", filePath, writeErr)
		}
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  create %s\n", filePath)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", filePath, err)
	}

	s := string(existing)
	startIdx := strings.Index(s, cortexRulesMarkerStart)
	endIdx := strings.Index(s, cortexRulesMarkerEnd)

	if startIdx >= 0 && endIdx >= 0 {
		if !force {
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  skip   %s (Cortex rules already present; use --force to update)\n", filePath)
			return nil
		}
		// Replace the existing section (including end marker).
		newContent := s[:startIdx] + section + s[endIdx+len(cortexRulesMarkerEnd):]
		if writeErr := os.WriteFile(filePath, []byte(newContent), 0644); writeErr != nil {
			return fmt.Errorf("failed to write %s: %w", filePath, writeErr)
		}
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  update %s\n", filePath)
		return nil
	}

	// Append section, ensuring a blank line separator.
	newContent := strings.TrimRight(s, "\n") + "\n\n" + section + "\n"
	if writeErr := os.WriteFile(filePath, []byte(newContent), 0644); writeErr != nil {
		return fmt.Errorf("failed to write %s: %w", filePath, writeErr)
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  write  %s\n", filePath)
	return nil
}

func fileExistsInit(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// isSameFileInit returns true when path a and b resolve to the same underlying file
// (handles symlinks via os.Stat).
func isSameFileInit(a, b string) bool {
	fiA, err := os.Stat(a)
	if err != nil {
		return false
	}
	fiB, err := os.Stat(b)
	if err != nil {
		return false
	}
	return os.SameFile(fiA, fiB)
}
