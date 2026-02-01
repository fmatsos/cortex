package cli

import (
	"os"

	"github.com/spf13/cobra"
)

var completionCmd = &cobra.Command{
	Use:   "completion [bash|zsh|fish|powershell]",
	Short: "Generate shell completion scripts",
	Long: `Generate shell completion scripts for Cortex.

To load completions:

Bash:
  $ source <(cortex completion bash)

  # To load completions for each session, execute once:
  # Linux:
  $ cortex completion bash > /etc/bash_completion.d/cortex
  # macOS:
  $ cortex completion bash > $(brew --prefix)/etc/bash_completion.d/cortex

Zsh:
  # If shell completion is not already enabled in your environment,
  # you will need to enable it. Execute once:
  $ echo "autoload -U compinit; compinit" >> ~/.zshrc

  # To load completions for each session, execute once:
  $ cortex completion zsh > "${fpath[1]}/_cortex"

  # You will need to start a new shell for this setup to take effect.

Fish:
  $ cortex completion fish | source

  # To load completions for each session, execute once:
  $ cortex completion fish > ~/.config/fish/completions/cortex.fish

PowerShell:
  PS> cortex completion powershell | Out-String | Invoke-Expression

  # To load completions for every new session, run:
  PS> cortex completion powershell > cortex.ps1
  # and source this file from your PowerShell profile.
`,
	DisableFlagsInUseLine: true,
	ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
	Args:                  cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
	RunE: func(cmd *cobra.Command, args []string) error {
		switch args[0] {
		case "bash":
			return rootCmd.GenBashCompletion(os.Stdout)
		case "zsh":
			return rootCmd.GenZshCompletion(os.Stdout)
		case "fish":
			return rootCmd.GenFishCompletion(os.Stdout, true)
		case "powershell":
			return rootCmd.GenPowerShellCompletionWithDesc(os.Stdout)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(completionCmd)
}
