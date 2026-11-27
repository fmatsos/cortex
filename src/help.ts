import { CONFIG_KEYS } from "./config";

/** `cortex --help`; the agent is shown its allowed lines (backends/policy.ts). */
export const HELP = `cortex — second brain

  cortex add <url|file|-> [--note "why I keep this"] [--via freedium (then archive.ph, Wayback)] [--linked-from <id>] [--dry-run]
  cortex inbox [--dry-run]   (add on inbox/: urls.txt and files; successful entries leave it)
  cortex search "<query>" [--in wiki|raw] [--json] [--limit N] [--space a,b|all]   (--space a,b or all: several spaces, one fused list)
  cortex index
  cortex new <Source|Concept|Entity|Synthesis> "<title>" [--force]   (creates the page per page_path, status: draft; prints its path; --force: a near title, by hand only)
  cortex lint [--json]
  cortex log [--limit N] [--json] [--kind k]     (the journal, newest first; 20 entries by default)
  cortex log add <add|ingest|query|lint|update> "<text>" [--source <raw id>]… [--page <wiki/….md>]…
  cortex compile <id…> | --pending [--batch]   (interactive by default; --batch: pages as draft)
  cortex ask "<question>" [--file] [--interactive]
  cortex export [--out <folder>]                (the wiki as an interactive HTML site; default: .cortex/site)
  cortex serve [--port <n>] [--sync]            (serves the site, pages can be marked reviewed from it as $CORTEX_REVIEWER,
                                               and the phone share target under /share/ (shares → inbox/ → sources);
                                               --sync: git pull before, commit and push after; default port 8080;
                                               site_ask in cortex.json: the site's assistant, questions about the wiki;
                                               a multi-space instance: every space under /s/<name>/, a signed-in person
                                               creates a private one from the site (needs auth); --space <name>: only that one)
  cortex share                                 (the share target alone, without serve: each share committed to inbox/ and
                                               pushed to the checkout's git remote, any host; env SHARE_PORT)
  cortex ls [--type T] [--json]                (the wiki pages, by title)
  cortex show <path|raw id|title>              (prints a page or a source)
  cortex related <path|title> [--limit N] [--json]
  cortex links [--write] [--json]              (mentions of a concept or entity not linked yet, with their reasons; --write links them)
  cortex doctor                                (system tools present or missing; the remote wiki reachable, its version)
  cortex --version
  cortex upgrade [--check]                     (compiled binary: installs the latest GitHub release)
  cortex mcp                                   (stdio MCP server: search, get, related, lint, add, log)
  cortex schema [--write]                      (the schema the agent follows; --write rewrites it into CLAUDE.md or AGENTS.md)
  cortex space list | add <name> [--repo <git url>] [--schema notes] | migrate <name>
                                               (spaces: isolated wikis under spaces/<name>/, sharing cortex.json; add --repo clones one
                                               into its own git repository; migrate moves a wiki/ + raw/ at the root into a space)
  cortex config init [claude|codex|opencode|openai] | lint | get [key] | set <key> <value> | remove <key>
                                               (keys: ${CONFIG_KEYS.join(", ")})

Agent: cortex.json (client claude|codex|opencode|openai, model, effort); --model <name> / --effort <level> override
them for one command (bare model name: an opencode provider/model keeps its provider). Without a client:
$CORTEX_AGENT (interactive, default "claude"), $CORTEX_AGENT_BATCH (default "claude -p").

  cortex remote add <name> <user@host> [--port N] [--identity <key>] | remove <name> | default <name> | list
                                               (remote wikis, in ~/.config/cortex/remotes.json; the first one added is the default;
                                               --identity: the ssh private key for that wiki, no ~/.ssh/config needed)

Root: $CORTEX_ROOT, otherwise the first parent folder that contains cortex.json, otherwise the default remote wiki.
With a spaces/ folder there, the root is one space: the one you are in, else --space <name>, $CORTEX_SPACE, default_space,
the only one. The agent of a space writes only its wiki/ and cannot read the other spaces (nor search them).
--wiki <name> (or $CORTEX_WIKI) sends the command to that remote wiki over ssh, even inside a local one. Through a
remote wiki: serve, share, export, inbox and compile are refused; config only reads; ask runs the host's agent.`;
