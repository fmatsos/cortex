import { CONFIG_KEYS } from "./config";

/** `cortex --help`; the agent is shown its allowed lines (backends/policy.ts). */
export const HELP = `cortex — second brain

  cortex add <url|file|-> [--note "why I keep this"] [--via freedium (then archive.ph, Wayback)] [--dry-run]
  cortex inbox [--dry-run]   (add on inbox/: urls.txt and files; successful entries leave it)
  cortex search "<query>" [--in wiki|raw] [--json] [--limit N]
  cortex index
  cortex new <Source|Concept|Entity|Synthesis> "<title>" [--force]   (creates the page per page_path, status: draft; prints its path; --force: a near title, by hand only)
  cortex lint [--json]
  cortex log [--limit N] [--json] [--kind k]     (the journal, newest first; 20 entries by default)
  cortex log add <add|ingest|query|lint|update> "<text>" [--source <raw id>]… [--page <wiki/….md>]…
  cortex queue [--kind k] [--json]               (what needs a human decision: synthesis, merge, contradiction, split, review)
  cortex queue done|dismiss|apply <n>            (closes entry n; apply: merge, split, synthesis and contradiction entries)
  cortex maintain merge [--apply] [--limit N]   (two pages on the same subject become one; without --apply it only lists; judge uncertain: queue)
  cortex maintain split [--apply] [--limit N]   (a long or multi-subject page is cut into pages; without --apply it only lists; judge uncertain: queue)
  cortex maintain synthesize [--apply] [--limit N]   (writes the synthesis pages the queue asks for; without --apply it only lists; judge uncertain: proposal in the queue)
  cortex compile <id…> | --pending [--batch]   (interactive by default; --batch: pages as draft)
  cortex compile … --pipeline [--fresh] [--keep-state]   (client openai: cortex runs fixed steps, the model only infers; --fresh ignores the saved state in .cortex/pipeline/)
  cortex ask "<question>" [--file] [--interactive]
  cortex export [--out <folder>]                (the wiki as an interactive HTML site; default: .cortex/site)
  cortex ls [--type T] [--json]                (the wiki pages, by title)
  cortex show <path|raw id|title>              (prints a page or a source)
  cortex related <path|title> [--limit N] [--json]
  cortex links [--write] [--json]              (mentions of a concept or entity not linked yet, with their reasons; --write links them)
  cortex doctor                                (system tools present or missing)
  cortex --version
  cortex upgrade [--check]                     (compiled binary: installs the latest GitHub release)
  cortex mcp                                   (stdio MCP server: search, get, related, lint, add, log, queue)
  cortex schema [--write]                      (the schema the agent follows; --write rewrites it into CLAUDE.md or AGENTS.md)
  cortex config init [claude|codex|opencode|openai] | lint | get [key] | set <key> <value> | remove <key>
                                               (keys: ${CONFIG_KEYS.join(", ")})

Agent: cortex.json (client claude|codex|opencode|openai, model, effort). Without a client:
$CORTEX_AGENT (interactive, default "claude"), $CORTEX_AGENT_BATCH (default "claude -p").

Root: $CORTEX_ROOT, otherwise the first parent folder that contains cortex.json.`;
