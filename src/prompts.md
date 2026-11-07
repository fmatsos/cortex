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
Apply the INGEST workflow of {{agentFile}} to the source {{source}} ({{agentFile}} is already in your context: do not read it). Its Source page cites it in the frontmatter with exactly `sources: [{ id: {{id}}, resource: {{source}} }]`.{{candidates}}

## compile-batch
Non-interactive mode: nobody will approve your presentation; write directly, with every page created or modified in status: draft. Do not touch the status of the raw source: the CLI handles it.

## compile-prepared
The CLI already created the Source page {{page}}: its type, title, status, sources, generated stamp and note callout (when there is a note) are set, keep them as they are. In the frontmatter, add only its description and 1 to {{maxTags}} tags. In the body, after the note callout, write in Markdown: a summary paragraph, 3 to 7 key points as a list, and the links to the concept and entity pages it touches; never put them in the frontmatter. Tags already in use: {{tags}}; add a new tag only if none of them fits. Once you are done, cortex itself runs `cortex index` and writes the Ingest entry of the journal: you have nothing to do for either.

## compile-interactive
Do not touch the status of the raw source: the CLI handles it.

## ask
Apply the QUERY workflow of {{agentFile}} to the question: « {{question}} » ({{agentFile}} is already in your context: do not read it).

## ask-file
Store the answer in a page created by cortex new Synthesis "<title>" (status: draft), add the Query entry to the journal (cortex log add query "…" --page wiki/syntheses/….md) and run cortex index.

## ask-read
Do not modify any file: only answer. If the answer deserves a synthesis, say so in one line (rerun with --file).

## mcp-instructions
Cortex: wiki in {{language}} under wiki/, raw sources under raw/. Search the wiki first; an answer found only in raw/ is a gap to compile.
