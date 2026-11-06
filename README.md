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

You pick the sources, ask the questions and review the pages. Your agent does the bookkeeping: it summarizes, links, updates and flags contradictions. Claude Code, Codex, opencode and any OpenAI-compatible API (Ollama, llama.cpp, OpenRouter…) are supported. Cortex calls an LLM only in that last mode, where it runs the agent loop itself. It captures sources, runs the mechanical checks, publishes the wiki and keeps the agent confined to `wiki/`.

> [!NOTE]
> Cortex is a personal project. The CLI messages are in English; the exported site UI is in English or French (it follows `language`). The agent schema is in English, and the wiki language is a setting (`language`).

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

- [Bun](https://bun.sh) 1.4.3 or later, unless you install the standalone binary (it includes Bun).
- One agent CLI on your `PATH`: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`), [Codex](https://github.com/openai/codex) (`codex`) or [opencode](https://opencode.ai) (`opencode`). Or no CLI at all: an OpenAI-compatible endpoint, local or remote (client `openai`).
- On Linux, [bubblewrap](https://github.com/containers/bubblewrap) (`apt install bubblewrap`), used to confine the agent. On macOS, `sandbox-exec` ships with the system.
- Optionally, `pdftotext` (poppler-utils), to import PDFs.

## Installation

Three ways, same features. Pick one.

| | Download | Needs Bun | Updated with |
|---|---|---|---|
| Standalone binary | ~53 MB (~113 MB on disk) | no | `cortex upgrade` |
| `cortex.js` | ~1.2 MB (~3.6 MB on disk) | yes | `cortex upgrade` |
| From the sources | clone + ~175 MB of dependencies | yes | `git pull && bun install` |

**Standalone binary** (Linux x64, macOS arm64). Nothing else to install:

```sh
os=$(uname -s | tr A-Z a-z); arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
curl -fsSL "https://github.com/fmatsos/cortex/releases/latest/download/cortex-$os-$arch.gz" | gunzip > ~/.local/bin/cortex
chmod +x ~/.local/bin/cortex
```

**`cortex.js`**, if Bun is already on your machine. One JavaScript file, run by your Bun, on any platform Bun supports:

```sh
curl -fsSL https://github.com/fmatsos/cortex/releases/latest/download/cortex.js.gz | gunzip > ~/.local/bin/cortex
chmod +x ~/.local/bin/cortex
```

**From the sources**, to hack on cortex:

```sh
git clone https://github.com/fmatsos/cortex.git
cd cortex
bun install --omit optional   # ~175 MB, without the agent binaries
bun link                      # puts `cortex` on your PATH
```

`bun link` makes the `cortex` command point to your clone, so a `git pull` updates it.

**Updates.** `cortex upgrade --check` compares your version with the latest release; `cortex upgrade` installs it. It only accepts a release whose checksums are signed with the cortex release key. **First export.** The binary and `cortex.js` carry the sources of the HTML site but not its dependencies: the first `cortex export` of each version installs them in `~/.cache/cortex/` (network needed once, ~165 MB; older versions are removed).

## Quick start

A wiki is any directory that contains a `cortex.json`. Cortex finds it by walking up from the current directory to the nearest `cortex.json`, or uses `$CORTEX_ROOT`.

```sh
mkdir -p ~/notes/{raw,wiki,inbox} && cd ~/notes && git init
cortex config init claude             # cortex.json + CLAUDE.md (codex or opencode: AGENTS.md)
cortex config set language English    # the language your wiki is written in

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
| `cortex inbox [--dry-run]` | Runs `add` on everything in `inbox/`. `urls.txt` holds one `<url> [note…]` per line, a `*.url` file holds one such line. Any other file is added, with an optional note in `<name>.note`. Successful entries leave the inbox. |
| `cortex search "<query>" [--in wiki\|raw] [--json] [--limit N]` | BM25 search. |
| `cortex index` | Regenerates `wiki/index.md` and `wiki/log.md`. |
| `cortex new <Source\|Concept\|Entity\|Synthesis> "<title>" [--force]` | Creates `wiki/<type>/<uuid>.md` as a `draft` and prints its path. Refuses a title that already exists, and a near title of the same type (same words, or one word more): `--force` creates it anyway, by hand only (refused to an agent). |
| `cortex lint [--json]` | Runs the mechanical checks. Exits with code 1 on errors. |
| `cortex links [--write] [--json]` | Pages that mention a concept or entity (its `title` or `aliases`) without linking to it. A suggestion needs the name as whole words in the prose, a name that is not a common word in the wiki (often linked where it appears), and a shared tag, source or close vocabulary. Same wiki, same suggestions; each comes with its reasons. `--write` turns the first mention into the link; `compile` does it on its own for the links that involve a page it wrote. |
| `cortex log [--limit N] [--json] [--kind k]` | Reads the journal, newest first. |
| `cortex log add <kind> "<text>" [--source <id>]… [--page <path>]…` | Appends a journal entry (`add`, `ingest`, `query`, `lint` or `update`). |
| `cortex compile <id…> \| --pending [--batch]` | Runs the ingest workflow, one agent session per source. Sessions are interactive by default. With `--batch`, no one validates and pages are written as `draft`. |
| `cortex ask "<question>" [--file] [--interactive]` | Answers from the wiki, read-only. `--file` stores the answer in `wiki/syntheses/`. |
| `cortex export [--out <dir>]` | Builds the static site (default `.cortex/site`). The output directory is emptied first. |
| `cortex mcp` | Starts an MCP server on stdio. |
| `cortex schema [--write]` | Prints the agent schema, or rewrites `CLAUDE.md` / `AGENTS.md` with it. |
| `cortex config init [client] \| lint \| get [key] \| set <key> <value> \| remove <key>` | Manages `cortex.json` (`cortex help` lists the keys; an invalid key or value is rejected with what is allowed). `init` also writes the agent schema. |

### Choosing the agent

Without configuration, Cortex stays agent-agnostic:

- interactive sessions run `$CORTEX_AGENT` (default `claude`);
- batch runs and `ask` run `$CORTEX_AGENT_BATCH` (default `claude -p`, which reads the prompt on stdin).

Naming a client in `cortex.json` lets Cortex drive that agent through its SDK or API, and block writes outside `wiki/` *before* they happen:

```sh
cortex config init
cortex config set client codex   # claude | codex | opencode | openai
cortex config set effort high    # low…max for Claude, minimal…xhigh, max, ultra or persistent for Codex, a model variant for opencode
```

Local model, or any OpenAI-compatible API: client `openai`. Cortex runs the agent loop itself, and every tool call goes through the same guard as Claude's (writes limited to `wiki/`, shell limited to `cortex`). When the model is done, Cortex sends back the `cortex lint` errors of its pages (and, for `compile`, a missing Source page) for up to two correction turns. This client runs in batch only (`compile --batch`, `ask`).

> [!IMPORTANT]
> The model must support tool calling. Claude, Codex and opencode read and write files on their own; an OpenAI-compatible API only provides the model, so Cortex offers it tools (read a page, write under `wiki/`, run `cortex index`…) and the model decides when to call them. Many small local models do not support tool calling, or handle it poorly: Ollama then returns an error, or the model answers in plain text and `compile` writes no page. Pick a model tagged **tools** in the [Ollama catalog](https://ollama.com/search?c=tools) (Qwen 3, Llama 3.1 and later…).

```sh
cortex config set client openai
cortex config set model qwen3:8b                            # required
cortex config set base_url http://localhost:11434/v1        # default: $OPENAI_BASE_URL, else Ollama on localhost
cortex config set effort none                               # thinking off (Qwen3…): much faster; other values go as reasoning_effort
export OPENAI_API_KEY=…                                     # if the endpoint needs one (OpenRouter…); never in cortex.json, and only sent to $OPENAI_BASE_URL (or a base_url equal to it)
```

### The agent schema

The schema is what your agent follows: the rules, the page format and the ingest, query and lint workflows. It ships with the CLI ([`src/schema.md`](src/schema.md)). `cortex config init` writes it where the chosen client loads it on its own: `CLAUDE.md` for Claude Code (or no client), `AGENTS.md` for Codex and opencode. An existing file is never overwritten.

| Key | Effect |
|---|---|
| `language` | Fills the wiki language into the schema (default `English`). |
| `schema` | Path, relative to the wiki root, of your own Markdown schema, used instead of the built-in one. `{{language}}` works there too. |
| `fetch_timeout` | Seconds before fetching a URL gives up (default `30`). With `--via`, each mirror gets that much. |
| `max_tags` | Most tags on a page an agent creates (default `4`). Beyond it, `compile --batch` keeps the tags already in use first. |

```sh
cortex schema           # prints the effective schema
cortex schema --write   # rewrites CLAUDE.md or AGENTS.md, after a CLI update or a config change
```

### Naming and folder structure

Two templates in `cortex.json` decide where Cortex puts what it creates. `/` makes subfolders.

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

The interface follows `language` in `cortex.json`: French when it says French (`French`, `Français`, `fr`), English otherwise (the default). Visitors can switch between English and Français with the selector next to the theme; that changes the labels only, never the wiki content.

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
| `src/schema.md` | The built-in agent schema. |
| `docs/DESIGN.md` | Architecture and design decisions. |
| `assets/logo/` | The logo, as SVG and PNG. |

## License

[MIT](LICENSE) © Franck Matsos
