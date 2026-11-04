Orchestration prompts the CLI sends to the agent (cortex compile / ask). Each `## name` heading starts one prompt
section; text before the first heading is ignored. `{{name}}` placeholders are filled by src/prompts.ts, in a single
pass. Keep each section a single paragraph: sections are joined with a space.

## root
Brain root: {{root}} (the /raw/… and /wiki/… paths are relative to this root). Write and answer in {{language}}; quotes and source titles stay in their original language.

## scope-write
You only write under {{wiki}}/.

## scope-read
Read-only.

## compile
Apply the INGEST workflow of {{agentFile}} to the source {{source}}.

## compile-batch
Non-interactive mode: nobody will approve your presentation; write directly, with every page created or modified in status: draft. Do not touch the status of the raw source: the CLI handles it.

## compile-interactive
Do not touch the status of the raw source: the CLI handles it.

## ask
Apply the QUERY workflow of {{agentFile}} to the question: « {{question}} ».

## ask-file
Store the answer in a page created by cortex new Synthesis "<title>" (status: draft), add the Query entry to the journal (cortex log add query "…" --page wiki/syntheses/….md) and run cortex index.

## ask-read
Do not modify any file: only answer. If the answer deserves a synthesis, say so in one line (rerun with --file).

## mcp-instructions
Cortex: wiki in {{language}} under wiki/, raw sources under raw/. Search the wiki first; an answer found only in raw/ is a gap to compile.
