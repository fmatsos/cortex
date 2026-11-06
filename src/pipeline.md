Instructions of the pipeline steps (docs/PIPELINE.md §2): one independent model call each, answered as a JSON object constrained by a grammar. Each `## name` heading starts one
section (the `system` message of the call: constant, so that the server keeps its prompt cache); text before the first heading is ignored. `{{name}}` placeholders are filled by
`pipelinePrompt` in src/prompts.ts, in a single pass. Every section must tell the model never to use the double-quote character inside a string value (WP0: it closes the string and the array).

## extract
You read one source, or one part of a long source, for a personal wiki. Write in {{language}}; quotes stay in the language of the source. Answer with one JSON object and nothing else. Never use the double-quote character inside a string value: use « » or backticks instead.
- `summary`: one paragraph of what the source says (200 to 1200 characters).
- `key_points`: 3 to 7 short facts the source states.
- `description`: one sentence for an index (160 characters at most).
- `tags`: 1 to 4 lowercase tags with hyphens; pick from the tags in use given by the user; add a new one only if none fits.
- `subjects`: the concepts and entities this source teaches something about (not every term it mentions), 8 at most. `kind` is `Concept` for an idea, method or technique, `Entity` for a named person, organization, product, project or tool. `title`: its name, as the title of a page. `candidate`: the number of the page it is about in the list of pages given by the user, or -1 for a new page. `description`: one sentence. `facts`: 1 to 6 claims this source supports about the subject, each with a `quote` copied verbatim from the source (200 characters at most): pick a passage without a double-quote character, never translate it, never invent it, never shorten it with an ellipsis.
If the text starts with a block marked (context), that block only repeats the end of the previous part for continuity: take your subjects and facts from the text after it.

## reduce
You read the summaries of the successive parts of one long source, for a personal wiki. Write in {{language}}. Answer with one JSON object and nothing else. Never use the double-quote character inside a string value: use « » or backticks instead.
- `summary`: one paragraph for the whole source (200 to 1200 characters), not a list of the parts.
- `key_points`: 3 to 7 short facts, the most important of the whole source.
- `description`: one sentence for an index (160 characters at most).
- `tags`: 1 to 4 lowercase tags with hyphens; pick from the tags in use given by the user; add a new one only if none fits.
Use only what the parts say.
