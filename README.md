<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/cortex-mark-dark.svg">
    <img src="assets/logo/cortex-mark-light.svg" alt="Cortex logo" width="96">
  </picture>
</p>

<h1 align="center">Cortex</h1>

<p align="center"><strong>A second brain your coding agent maintains: read, linked, sourced.</strong></p>

<p align="center">
  <a href="https://github.com/fmatsos/cortex/actions/workflows/test.yml"><img src="https://github.com/fmatsos/cortex/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-black?logo=bun" alt="Runtime: Bun">
</p>

Cortex is a command-line tool for running a personal wiki that an LLM agent maintains. It implements the [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) on top of the [Open Knowledge Format (OKF v0.2)](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).

You pick the sources, ask the questions and review the pages. Your agent does the bookkeeping: it summarizes, links, updates and flags contradictions. Claude Code, Codex and opencode are supported. Cortex itself never calls an LLM. It captures sources, runs the mechanical checks, publishes the wiki and keeps the agent confined to `wiki/`.

> [!NOTE]
> Cortex is a personal project. The CLI messages and the agent schema ([`docs/CORTEX.md`](docs/CORTEX.md)) are currently in French, and wikis are written in French by default (change rule 7 of your `CORTEX.md` to switch).

## Features

- **Capture.** `cortex add` turns a URL, a PDF or stdin into an immutable Markdown source in `raw/`. Readable text is extracted, duplicates are detected, and every source carries a note on why you keep it.
- **Agent workflows.** Ingest (`cortex compile`) and query (`cortex ask`) run your agent in one session per source, interactively or in batch. Writes outside `wiki/` are blocked: through the agent SDK's controls, or through an OS sandbox (bubblewrap on Linux, `sandbox-exec` on macOS).
- **Sourced pages.** Each claim cites its source in a footnote. Pages track who generated them and who reviewed them (`generated`, `verified`).
- **Lint.** The mechanical checks report broken links, unsourced footnotes, orphan pages, stale or unreviewed pages, pending sources, likely duplicates and near-synonym tags.
- **Search.** `cortex search` uses BM25, searching the wiki first and then the raw sources.
- **MCP server.** External agents can search and read the wiki, and add sources, without ever writing to `wiki/`.
- **Static site.** `cortex export` publishes the wiki as an interactive site:
  - instant search with operators;
  - a graph of directed links;
  - tags, a journal and favorites;
  - light and dark themes;
  - offline reading on demand;
  - no server needed.

## Requirements

- [Bun](https://bun.sh) 1.4 or later.
- One agent CLI on your `PATH`: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`), [Codex](https://github.com/openai/codex) (`codex`) or [opencode](https://opencode.ai) (`opencode`).
- On Linux, [bubblewrap](https://github.com/containers/bubblewrap) (`apt install bubblewrap`), used to confine the agent. On macOS, `sandbox-exec` ships with the system.
- Optionally, `pdftotext` (poppler-utils), to import PDFs.

## Installation

```sh
git clone https://github.com/fmatsos/cortex.git
cd cortex
bun install --omit optional   # ~175 MB, without the agent binaries
bun link                      # puts `cortex` on your PATH
```

`bun link` makes the `cortex` command point to your clone, so a `git pull` updates it.

## Quick start

A wiki is any directory that contains a `CORTEX.md`. That file is the schema your agent follows: rules, page format and workflows. Cortex finds the wiki by walking up from the current directory to the nearest `CORTEX.md`, or uses `$CORTEX_ROOT`.

```sh
mkdir -p ~/notes/{raw,wiki,inbox} && cd ~/notes && git init
cp /path/to/cortex/docs/CORTEX.md .   # the reference schema; adapt it to taste
ln -s CORTEX.md CLAUDE.md             # optional: Claude Code loads it in any session (AGENTS.md for Codex)

cortex add https://example.org/article --note "Why I keep this"
cortex compile --pending              # one interactive agent session per pending source
cortex ask "What do my sources say about context rot?"
cortex export && bunx serve .cortex/site
```

The resulting layout:

```
raw/YYYY/MM/<uuid>/source.md # extracted sources, immutable (only `status` changes)
wiki/sources/<uuid>.md       # one Source page per raw source
wiki/concepts/<uuid>.md      # ideas
wiki/entities/<uuid>.md      # people, tools, projects, organizations
wiki/syntheses/<uuid>.md     # stored answers, comparisons, theses
wiki/index.md                # generated catalog
wiki/log.jsonl → wiki/log.md # append-only journal, and its generated view
```

By default, every source and page is named by a [UUID v7](https://www.rfc-editor.org/rfc/rfc9562#name-uuid-version-7) that Cortex generates (`cortex add`, `cortex new`). The names are unique with no possible collision, and they sort in creation order. Nobody types them: you find a page by its title, through the index or `cortex search`. Both the naming and the folder structure are [configurable](#naming-and-folder-structure).

## Usage

| Command | What it does |
|---|---|
| `cortex add <url\|file\|-> --note "…" [--dry-run]` | Captures a source into `raw/` with status `pending`, and logs it. Idempotent: an existing URL or content returns the existing id. |
| `cortex inbox [--dry-run]` | Runs `add` on everything in `inbox/`. `urls.txt` holds one `<url> [note…]` per line. Any other file is added, with an optional note in `<name>.note`. Successful entries leave the inbox. |
| `cortex search "<query>" [--in wiki\|raw] [--json] [--limit N]` | BM25 search. |
| `cortex index` | Regenerates `wiki/index.md` and `wiki/log.md`. |
| `cortex new <Source\|Concept\|Entity\|Synthesis> "<title>"` | Creates `wiki/<type>/<uuid>.md` as a `draft` and prints its path. Refuses a title that already exists. |
| `cortex lint [--json]` | Runs the mechanical checks. Exits with code 1 on errors. |
| `cortex log [--limit N] [--json] [--kind k]` | Reads the journal, newest first. |
| `cortex log add <kind> "<text>" [--source <id>]… [--page <path>]…` | Appends a journal entry (`add`, `ingest`, `query`, `lint` or `update`). |
| `cortex compile <id…> \| --pending [--batch]` | Runs the ingest workflow, one agent session per source. Sessions are interactive by default. With `--batch`, no one validates and pages are written as `draft`. |
| `cortex ask "<question>" [--file] [--interactive]` | Answers from the wiki, read-only. `--file` stores the answer in `wiki/syntheses/`. |
| `cortex export [--out <dir>]` | Builds the static site (default `.cortex/site`). The output directory is emptied first. |
| `cortex mcp` | Starts an MCP server on stdio. |
| `cortex config init \| lint \| get [key] \| set <key> <value> \| remove <key>` | Manages `config.json` (keys `client`, `model`, `effort`, `raw_path`, `page_path`). |

### Choosing the agent

Without configuration, Cortex stays agent-agnostic:

- interactive sessions run `$CORTEX_AGENT` (default `claude`);
- batch runs and `ask` run `$CORTEX_AGENT_BATCH` (default `claude -p`, which reads the prompt on stdin).

Naming a client in `config.json` at the wiki root lets Cortex drive that agent through its SDK or API, and block writes outside `wiki/` *before* they happen:

```sh
cortex config init
cortex config set client codex   # claude | codex | opencode
cortex config set effort high    # low…max for Claude, minimal…xhigh for Codex, a model variant for opencode
```

### Naming and folder structure

Two templates in `config.json` decide where Cortex puts what it creates. `/` makes subfolders.

| Key | Default | Meaning |
|---|---|---|
| `raw_path` | `{yyyy}/{mm}/{uuid}` | Folder of a source under `raw/`. Its last segment is the source id, unique across `raw/`. |
| `page_path` | `{type}/{uuid}` | Path of a page under `wiki/`, without `.md`. |

| Placeholder | Value |
|---|---|
| `{uuid}` | UUID v7: time-ordered, unique |
| `{yyyy}` `{mm}` `{dd}` `{hh}` `{mi}` `{ss}` | Creation date and time, local time |
| `{slug}` | Title in lowercase words joined by dashes, 50 characters at most |
| `{rand}` | 4 random characters `[a-z0-9]` |
| `{kind}` | `raw_path` only: `article`, `pdf`, `note`… |
| `{type}` | `page_path` only: `sources`, `concepts`, `entities` or `syntheses` |

```sh
cortex config set raw_path "{yyyy}{mm}{dd}-{rand}-{slug}"   # raw/20261104-k3xz-context-rot/
cortex config set page_path "{type}/{slug}"                 # wiki/concepts/context-rot.md
```

`cortex config` rejects an invalid template: an unknown placeholder, a character other than letters, digits, `.`, `_`, `-` and `/`, an empty or `..` segment, or a last segment with no placeholder. A name that is already taken gets `-2`, `-3`… appended. Existing files are never renamed: `cortex lint` warns about the ones that do not follow the current templates.

### MCP server

`cortex mcp` exposes the wiki to an external agent. The tools `search`, `get`, `related`, `lint` and `log` are read-only. `add` writes to `raw/` only and requires a `note`. Example with Claude Code:

```sh
claude mcp add cortex -e CORTEX_ROOT=/path/to/your/wiki -- cortex mcp
```

### Static site

`cortex export` reads `wiki/` only, so `raw/` is never published and sources link to their original URL. The result is a prerendered SvelteKit site, and you can serve it from any static file server, including under a sub-path:

```sh
bunx serve .cortex/site
python3 -m http.server -d .cortex/site
```

The search box (<kbd>Ctrl</kbd>+<kbd>K</kbd>, <kbd>⌘</kbd>+<kbd>K</kbd> or <kbd>/</kbd>) accepts these operators, which you can combine:

| Operator | Matches |
|---|---|
| `#tag` | pages with that tag |
| `type:concept` | pages of that type |
| `status:draft` | pages with that status |
| `is:fav` | your favorites |
| `is:unverified` | pages never reviewed |
| `"exact phrase"` | that exact phrase |
| `-word` | pages without that word |

Favorites live in each browser's `localStorage`.

## Development

```sh
bun test                                   # unit and integration tests
CORTEX_ROOT=/path/to/wiki bun test         # also runs the regression tests on a real wiki
cd site && CORTEX_SITE_DATA=/path/to/wiki/.cortex/site-data bunx --bun vite dev   # site dev server, after one export
```

| Path | Contents |
|---|---|
| `src/` | The CLI. `cortex.ts` is the entry point. `backends/` holds the agent clients. |
| `site/` | The SvelteKit app built by `cortex export`. It uses Svelte 5, Tailwind v4, shadcn-svelte components and force-graph. |
| `docs/DESIGN.md` | Architecture and design decisions (French). |
| `docs/CORTEX.md` | The reference agent schema to copy into a wiki. |
| `assets/logo/` | The logo, as SVG and PNG. |

## License

[MIT](LICENSE) © Franck Matsos
