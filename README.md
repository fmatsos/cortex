<p align="center">
  <img src="design/brand/cortex-mark.svg" alt="Cortex" width="128">
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

- **Capture.** `cortex add` turns a URL, a PDF or stdin into an immutable Markdown source in `raw/`. Readable text is extracted, duplicates are detected, and a source can carry a note on why you keep it (optional).
- **Agent workflows.** Ingest (`cortex compile`) and query (`cortex ask`) run your agent in one session per source, interactively or in batch. Writes outside `wiki/` are blocked: through the agent SDK's controls, or through an OS sandbox (bubblewrap on Linux, `sandbox-exec` on macOS).
- **Sourced pages.** Each claim cites its source in a footnote. Pages track who generated them and who reviewed them (`generated`, `verified`).
- **Lint.** The mechanical checks report broken links, unsourced footnotes, orphan pages, stale or unreviewed pages, pending sources, likely duplicates and near-synonym tags.
- **Search.** `cortex search` is hybrid: BM25 over the words (accents ignored), title fragments (a typo in a title still finds the page) and, with [`embed`](#hybrid-search) configured, vectors by meaning, fused by reciprocal rank, one result per page with the extract of its best section. The index lives in `.cortex/search.db` and only changed files are read again; wiki first, then the raw sources.
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
| Standalone binary | ~72 MB (~162 MB on disk) | no | `cortex upgrade` |
| `cortex.js` | ~2.5 MB (~5.7 MB on disk) | yes | `cortex upgrade` |
| From the sources | clone + ~470 MB of dependencies | yes | `git pull && bun install` |

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

**Updates.** `cortex upgrade --check` compares your version with the latest release; `cortex upgrade` installs it. It only accepts a release whose checksums are signed with the cortex release key. **First export.** The binary and `cortex.js` carry the sources of the HTML site but not its dependencies: the first `cortex export` of each version installs them in `~/.cache/cortex/` (network needed once, ~175 MB on disk, of which ~45 MB for the local embedding model's ONNX runtime; older versions are removed). Once installed, what the run never loads is deleted: the ONNX runtime of the other platforms, source maps, type declarations and the packages' own tests; `onnxruntime-web`, which only browsers use, is replaced by an empty package (`overrides` in `package.json`) and is not fetched at all.

## Quick start

A wiki is any directory that contains a `cortex.json`. Cortex finds it by walking up from the current directory to the nearest `cortex.json`, or uses `$CORTEX_ROOT`. One instance can also hold several isolated wikis: see [Spaces](#spaces).

```sh
mkdir -p ~/notes/{raw,wiki,inbox} && cd ~/notes && git init
cortex config init claude             # cortex.json + CLAUDE.md (codex or opencode: AGENTS.md)
cortex config set language English    # the language your wiki is written in

cortex add https://example.org/article --note "Why I keep this"
cortex compile --pending              # one interactive agent session per pending source
cortex ask "What do my sources say about context rot?"
cortex export && bunx serve .cortex/site
```

### The note: optional, worth writing

`--note` (the note field of the share app, the rest of the line in `inbox/urls.txt`, a `<name>.note` file) says **why you keep a source**. Cortex never requires it. Write it whenever you can, even in a few words, because it is the only place your intent is recorded:

- **It sets the angle of the Source page.** The agent reads the note before the source and summarizes it for that reason: the same article gives a different page when kept "for the benchmark method" than "as a counterexample to X". Without a note, the agent picks the angle from the content and from what the wiki already holds.
- **It stays visible.** It is copied verbatim into a "Note personnelle" callout at the top of the Source page, in Obsidian and on the exported site, so you see later why that page exists.
- **It is searchable.** `cortex search` indexes it with the source: you find a source by your own words, not only by its author's.
- **It follows the links.** The pages a social post links to, captured with it, carry the post's note.

A useful note names a use, not a feeling: "compare with our retry policy" or "source for the Kubernetes cost synthesis" help the agent; "interesting" or "to read" don't.

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
| `cortex add <url\|file\|-> [--note "…"] [--as note\|resource] [--via freedium] [--dry-run]` | Captures a source into `raw/` with status `pending`, and logs it. Idempotent: an existing URL or content returns the existing id. Posts from X, Bluesky, Mastodon and LinkedIn are read through their public data, and the pages they link to are captured too, as sources tied to the post (`linked` / `linked_from`), through Freedium, then archive.ph and the Wayback Machine, when paywalled. `--via freedium` reads the URL itself through that same chain. `--linked-from <id>` ties the source to one already in `raw/` that it was found in (a newsletter and the pages it points to) the same way, both ways. |
| `cortex inbox [--dry-run]` | Runs `add` on everything in `inbox/`. `urls.txt` holds one `<url> [note…]` per line, a `*.url` file holds one such line. Any other file is added, with an optional note in `<name>.note` and an optional origin URL in `<name>.origin` (the file is the content, the URL is kept as the source's `url` and not fetched). Successful entries leave the inbox. The [Chrome extension](extension/README.md) sends the page you are looking at (paywalled or login-walled content included) to the share app this way. |
| `cortex search "<query>" [--in wiki\|raw] [--json] [--limit N] [--space a,b\|all]` | Hybrid search: words, title typos and, if `embed` is set, meaning (see [Hybrid search](#hybrid-search)). `--json` adds `match` (`lexical`, `semantic` or `both`). `--space a,b` or `all`: several [spaces](#spaces) at once. |
| `cortex index` | Regenerates `wiki/index.md` and `wiki/log.md`. |
| `cortex new <Source\|Concept\|Entity\|Synthesis> "<title>" [--force]` | Creates `wiki/<type>/<uuid>.md` as a `draft` and prints its path. Refuses a title that already exists, a near title of the same type (same words, or one word more) and, with [`embed`](#the-agent-schema) (and ideally `judge`), a page of the same type that covers the same subject: `--force` creates it anyway, by hand only (refused to an agent). A close page that is not refused is listed as a warning. |
| `cortex lint [--json]` | Runs the mechanical checks. Exits with code 1 on errors. |
| `cortex links [--write] [--json]` | Pages that mention a concept or entity (its `title` or `aliases`) without linking to it. A suggestion needs the name as whole words in the prose, a name that is not a common word in the wiki (often linked where it appears), and a shared tag, source or close vocabulary. Same wiki, same suggestions; each comes with its reasons. `--write` turns the first mention into the link; `compile` does it on its own, only for the pages it touched and the mentions of the pages it created. |
| `cortex log [--limit N] [--json] [--kind k]` | Reads the journal, newest first. |
| `cortex log add <kind> "<text>" [--source <id>]… [--page <path>]…` | Appends a journal entry (`add`, `ingest`, `query`, `lint` or `update`). |
| `cortex compile <id…> \| --pending [--batch]` | Runs the ingest workflow, one agent session per source. Sessions are interactive by default. With `--batch`, no one validates and pages are written as `draft`. |
| `cortex ask "<question>" [--file] [--interactive] [--space a,b\|all]` | Answers from the wiki, read-only. `--file` stores the answer in `wiki/syntheses/`. `--space a,b` (or `all`): reads several spaces of the instance (never with `--file`: see [Asking several spaces](#asking-several-spaces)). |
| `cortex export [--out <dir>]` | Builds the static site (default `.cortex/site`). The output directory is emptied first. |
| `cortex mcp` | Starts an MCP server on stdio. |
| `cortex schema [--write]` | Prints the agent schema, or rewrites `CLAUDE.md` / `AGENTS.md` with it. |
| `cortex space list \| add <name> [--repo <url>] [--content resources,notes] \| set <name> [--content …] \| migrate <name>` | Manages the [spaces](#spaces) of an instance. |
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
| `schema` | Path, relative to the instance root (the folder holding `cortex.json`), of your own Markdown schema, used instead of the built-in ones. `{{language}}` works there too. A space can have its own (`spaces.<name>.schema`); either one overrides what the space's `content` would pick. |
| `fetch_timeout` | Seconds before fetching a URL gives up (default `30`). With `--via`, each mirror gets that much. |
| `parser.social.external_link.limit` | Pages a social post links to that `cortex add` also captures, as sources tied to the post (default `5`, `0` = links not followed). Each one is compiled in its own agent session. `parser.social.<network>.external_link.limit` (`x`, `bluesky`, `mastodon`, `linkedin`) overrides it for one network. Example: `{ "parser": { "social": { "external_link": { "limit": 2 }, "linkedin": { "external_link": { "limit": 0 } } } } }`. |
| `parser.social.linkedin` | Selectors LinkedIn is read with outside its JSON-LD, to update when LinkedIn changes its page: `card` (link card), `activity_text`, `activity_author`, `activity_images` (activity page), `shortlink` (destination link on the lnkd.in interstitial), `carousel` (attribute holding the carousel's JSON). Each key is optional, defaults in `src/social/linkedin.ts`. Example: `{ "parser": { "social": { "linkedin": { "card": "a.card" } } } }`. |
| `embed` | Vectors for the hybrid search; absent = off (words only). `{ "provider": "openai" \| "local", "model": …, "dims": …, "base_url": …, "threads": … }`, every key optional. Without `provider`, a server speaking the OpenAI `POST <base_url>/embeddings` API (llama.cpp with Qwen3-Embedding…), `qwen3-embed`, 256 dimensions: a config written before `provider` existed keeps working unchanged. `"provider": "local"` runs `Xenova/multilingual-e5-small` inside cortex. Details, thresholds and deployment: [Hybrid search](#hybrid-search). |
| `site_ask` | The assistant of the site `cortex serve` hosts: a conversation about the wiki in a panel docked on the right (a drawer on a small screen), opened by its header button or Ctrl+I, kept from page to page; search and questions stay apart (a query phrased as a question offers "Ask the assistant" in the palette, Enter only searches); absent = off, since each question spends tokens; needs a client (`site_ask.client`, else `client`), so the model and the tools are under control. `{ "client": …, "model": …, "effort": …, "base_url": …, "history_turns": … }`, every key optional: `client` lets the questions use another client than compiling (e.g. `openai` on a pay-per-use API while compiling stays on a subscription); `model` defaults to `haiku` (claude) or `gpt-6-luna` (codex), otherwise `model` when the client is the global one (required for `openai`); `effort` is not sent unless set here (the global one is for compiling); `base_url` (openai client) defaults to `$CORTEX_ASK_BASE_URL`, else the openai client's. The key goes in `$CORTEX_ASK_API_KEY`, only ever sent to `$CORTEX_ASK_BASE_URL` (or a `site_ask.base_url` equal to it), so it never mixes with `$OPENAI_API_KEY` (embeddings…). The agent answers read-only and cites the pages it used. With a `judge`, each page the search finds (`judge.ask_candidates`, 16) is judged alone against the question; the pages at `ask_retained` (0.5) or more are given to the agent in full and listed under the answer, those from `ask_related` (0.3) are named as related; the same question retains the same pages (the scores are kept in `.cortex/judge.db`, shared with the search's ranking: see `judge`; a call that fails leaves its page out, the pages judged count). Without a judge, or when it fails, the agent gets the search hits up front (BM25 fused with `embed` when configured). The site sends the earlier turns of the conversation with each question (the server keeps none): the last `history_turns` exchanges (a question and its answer; default 10, or the limit of the client's provider when it defines one), and the panel warns once the conversation has reached that depth (the number comes from the `x-ask-history-turns` header of the `/api/ask` probe). With the `openai` and `claude` clients the agent also gets a `render_blocks` tool to lay out its answer with the site's components (callout, table, steps, tabs, key facts, key pages), each block checked against its schema before it is accepted; the other clients answer in Markdown. One question at a time; give your reverse proxy a read timeout of a minute or more. |
| `auth` | User accounts of the site `cortex serve` hosts (see [User accounts](#user-accounts)); absent = no sign-in, the site works as before. `{ "public_urls": ["https://cortex.example"], "oidc": { "label": "Authelia", "issuer": …, "client_id": …, "groups": […] }, "github": { "client_id": …, "allow": [<numeric ids>] }, "google": { "client_id": …, "allow": ["<e-mails>"] } }`. Each provider is active only when configured **and** its secret is in the environment (`$CORTEX_OIDC_CLIENT_SECRET`, `$CORTEX_GITHUB_CLIENT_SECRET`, `$CORTEX_GOOGLE_CLIENT_SECRET`: never in this file, which is versioned). |
| `review` | Review notion on the site: « never reviewed » and « to review again » marks, the `is:verified` / `is:unverified` / `is:review` filters and facets, the reviewer in the page details, the « Mark as reviewed » button, the footer count and the read-only review queue (`/review/`, validation stays on each page). `true` to turn it on; absent = off, and none of it reaches the exported site. |
| `drafts` | Draft status on the site: the draft mark, the `status:draft` filter and facet. `true` to turn it on; absent = off, draft pages are shown as stable. |
| `judge` | A System One model that answers yes/no and choice questions at `POST <base_url>/systemone`: TypeSafe's hosted Jev, or d3-mini behind llama.cpp; absent = off. `{ "base_url": …, "model": "d3-mini" }`, every key optional. `base_url`: its own, else `$CORTEX_JEV_BASE_URL` (key in `$CORTEX_JEV_API_KEY`, sent only there), else as for `embed`. `model`: default `$CORTEX_JEV_MODEL`, else `d3-mini`. The former `CORTEX_JUDGE_*` names (`CORTEX_JUDGE_BASE_URL`, `CORTEX_JUDGE_API_KEY`, ...) are still read when the new one is absent, with a one-time deprecation warning; the new name wins if both are set, and an old key is only sent with the old URL (or with the new one when no old URL is set). Settings that depend on the model, each from cortex.json, else `$CORTEX_JEV_<NAME>` (e.g. `CORTEX_JEV_ROUTE_YES`), else the default: `route_yes` (0.5) and `dup_yes` (0.7), the probabilities from which a page is suggested to `compile` or a new page refused; `route_candidates` (10) and `dup_candidates` (5), the pages offered to the judge; `route_chars` (1500), the characters of the source it reads; `ask_retained` (0.5), `ask_related` (0.3) and `ask_candidates` (16) for the site's questions (see `site_ask`); `search_retained` (0.5), `search_related` (0.3, never above `search_retained`: checked by `cortex config lint`, and lowered at run time otherwise) and `search_candidates` (20) for the judged ranking of the site's search (`GET /api/search?judge=1`, below); `concurrency` (6), the simultaneous calls of one batch. Each page is judged in its own call (a batch in one call scored the same page 0.24 first and 0.75 last), and every score is kept in `.cortex/judge.db` as soon as it arrives, under the hash of the model, the question's wording, the normalized query (lowercase, spaces collapsed), the page and the text the judge reads of it: a page edited, or another model, is judged again; scores older than 30 days, and the oldest beyond 20,000, are forgotten. For Jev: `CORTEX_JEV_BASE_URL=https://api.typesafe.ai/v1`, `CORTEX_JEV_MODEL=jev-1.13.0`, `CORTEX_JEV_ROUTE_YES=0.65` (best F1 measured on a real wiki). Used by `cortex new` (does the new page duplicate one of the 5 closest pages by meaning? refused at probability 0.7) and by `compile` (the pages the source probably updates, listed in the agent's prompt). Needs `embed` for both. Server down or slow: one warning, then the same behaviour as without it (cosine alone for `new`, nothing for `compile`). The judge's endpoint is `judge.base_url`, else `$CORTEX_JEV_BASE_URL`; the key is optional and only in `$CORTEX_JEV_API_KEY` (sent to that URL alone, never read from cortex.json); in a batch of calls (the site's questions and search) one call that fails, or that gets an unusable answer, does not stop the others. |
| `site_spaces` | Who may create a space from the site (`POST /api/spaces`): `{ "create": "owners" }` (default: only people who already own a space) or `"anyone"` (any signed-in person: use it only when `auth` already limits who can sign in, as `github.allow`, `google.allow` and `oidc.groups` do). With `"owners"` the first owner is named from the command line, once that person has signed in: `cortex space member <name> add <e-mail or id> --role owner`. The site's `canCreate` follows the same rule. |
| `default_space` | The space used when none is chosen, in a multi-space instance (see [Spaces](#spaces)). |
| `spaces` | Per-space settings, by name: `{ "veille": { "repo": "<git url>" }, "pro": { "content": ["notes"] } }`. `repo` is written by `cortex space add --repo`. `content` is what the space holds: a non-empty list of `resources` and `notes` (default `["resources"]`, then left out), see [Resources and notes](#resources-and-notes). `schema` is a custom agent schema for the space, a path relative to the instance root (`cortex space add --schema <file>`). |
| `max_tags` | Most tags on a page an agent creates (default `4`). Beyond it, `compile --batch` keeps the tags already in use first. |

```sh
cortex schema           # prints the effective schema
cortex schema --write   # rewrites CLAUDE.md or AGENTS.md, after a CLI update or a config change
```

### Hybrid search

`cortex search`, the MCP `search` tool and the site's questions share one index, `.cortex/search.db` (SQLite, rebuilt on its own from `wiki/` and `raw/`; only the changed files are read again). A page is indexed as a whole and, for a wiki page, once more per `##` section (a passage). Three rankings are fused by reciprocal rank (k = 60, 60 candidates each):

- the **words**: FTS5, accents ignored, title weighted 4:1;
- the **title fragments**: trigrams, so `fermentaton` still finds « Fermentation lactique » (every word of the query must be in the title; a word of under 5 letters must match exactly);
- with `embed`, the **vectors**: the nearest pages and passages, 3 times as many drawn, then folded by page.

The result is one line per page, at its best rank, wiki before raw, with the extract of its best passage, also for a page found only by its meaning (`match`: `lexical`, `semantic` or `both`). `cortex index` (so every compile and every rebuild of `cortex serve`) embeds what is new or changed; an unchanged section keeps its vector when its page is edited (vectors are cached by `sha256(model + text)`). The `.cortex/embeddings.json` of earlier versions is ignored then deleted; the vectors are recomputed in the index.

```json
{ "embed": { "provider": "local" } }
```

| Key | Default | |
|---|---|---|
| `provider` | `openai` | `openai`: an OpenAI-compatible `/embeddings` server. `local`: the model runs in the cortex process. |
| `model` | `qwen3-embed` (`openai`), `Xenova/multilingual-e5-small` (`local`) | The prefixes and thresholds follow the model, not the provider. A model name containing `e5` gets `query: ` / `passage: `; any other the Qwen3 instruction on queries. |
| `dims` | 256 (Qwen3, truncated and renormalized), 384 (e5) | Size of the vectors. Changing it, like changing the model, makes the vectors again (until `cortex index` has run, the search is by words). |
| `base_url` | as the openai client | `openai` only (`$OPENAI_API_KEY` only goes to a URL the environment names). |
| `threads` | 4, or the number of cores if fewer | `local` only: ONNX threads. |

**Local model.** `multilingual-e5-small`, quantized (q8, 384 dimensions, French included). It is downloaded once (~120 MB) by `cortex index` or a `cortex serve` rebuild into `~/.cache/cortex/models` (`$CORTEX_MODEL_CACHE` to move it), never by a search or any other command. Cost: about 0.5 to 0.9 GB of memory while it runs, 3 to 5 s to load it in a one-shot `cortex search` (a `serve` or `mcp` process loads it once), and a few passages per second per thread to index, so the first index of a large wiki takes minutes and the next ones only embed what changed. The standalone binary carries the ONNX runtime (+18 MB on the download, see Installation), but `cortex serve` and `cortex export` of a binary or `cortex.js` run from the sources it unpacks, whose first-run install of dependencies is ~175 MB on disk, the ONNX runtime of its platform included (see Installation); a source install or `cortex.js` needs `bun install` to have fetched `@huggingface/transformers`.

**Never an error.** Model not downloaded (no network at the first index), runtime or extension missing, server down: the search answers by words only, with one warning (it names `"provider": "openai"` as the way out when the local model cannot run), and `cortex index` says how many sections it could not embed. The commands that work offline never start a download.

**Nearest neighbours.** With the sqlite-vec extension (`vec0`, cosine), loaded when the SQLite library accepts extensions (Linux binary, sources), the vectors are searched by SQLite; otherwise in JS over the stored vectors (about 16 ms for 10 000 vectors): same answers either way. `cortex doctor` reports which SQLite is used and whether sqlite-vec answers a query; `CORTEX_SQLITE_VEC=off` forces the JS path.

**Thresholds by model.** The cosines of a model have their own spread, so what `cortex new` (duplicate guard), `cortex related` and the vector ranking keep depends on it (`src/embed.ts`, `PROFILES`). Qwen3-Embedding is calibrated on a real French wiki (356 pages, 180 neighbour pairs labelled by hand, 163 distinct pages checked as new pages against 40 rewrites of existing ones): without a judge a new page is refused at a cosine of 0.90 (the closest distinct pages reach 0.88, paraphrases of a page 0.80 to 0.95: the cosine alone only catches near-copies, the judge does the rest), listed as close from 0.75, and `related` keeps pages from 0.70 (under it about half of the neighbours are unrelated). e5 packs its cosines high (unrelated French texts 0.72 to 0.87, same subject 0.82 to 0.88, paraphrase 0.89 to 0.96, near-duplicate 0.99): it refuses at 0.97 and warns at 0.90 (a text is compared as a `passage:`, like the stored vectors), and `related` and the vector ranking keep what is within a margin of the best score (0.04 and 0.05) over a floor of 0.80, instead of a fixed floor. These are first values from a small French corpus: `bun scripts/calibrate-embeddings.ts [wiki root]` (after `cortex index`) prints the distributions of your wiki to adjust them.

**Deployment order.** The schema of `cortex.json` is strict: a cortex that does not know `provider` or `threads` refuses the file. Install the new binary (or version) first, then add the keys to `cortex.json`. A wiki that already has `embed` without `provider` (Qwen3-Embedding through llama.cpp) needs nothing: it stays in server mode, with its model, and only its vectors are recomputed once (the index changed format). To move it to the local model, set `"provider": "local"` (and drop `base_url` and `model`), then run `cortex index`.

**macOS.** Apple's SQLite refuses extensions, so sqlite-vec is off by default and the JS path is used (nothing to do). To get sqlite-vec: `brew install sqlite`; cortex then finds Homebrew's library by itself (`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`, then `/usr/local/opt/sqlite/lib/libsqlite3.dylib`). `CORTEX_SQLITE_LIB=/path/to/libsqlite3.dylib` names another one and `CORTEX_SQLITE_LIB=system` forces the system's (no detection). Bun only honours it on macOS (on Linux the call succeeds and Bun keeps its own SQLite, which already loads extensions); `cortex doctor` says which SQLite is in use. It is an environment variable, not a `cortex.json` key, because the library has to be chosen before anything is read. A library that is missing or refused gives one warning and cortex goes on with the system's SQLite. The local model is tried on macOS and, if it cannot load, the search stays on words and says to use `"provider": "openai"`. **Not yet validated on the `macos-15` runner**: loading the ONNX runtime from the library the binary extracts to `~/.cache/cortex/native/`, the sqlite-vec `.dylib` with Homebrew's SQLite (a library of the wrong architecture may fall back to the system's SQLite without a warning), and the local model end to end. Bun unpacks the ONNX addon into `$TMPDIR` before loading it: where `$TMPDIR` is mounted `noexec`, point it at a folder that is not.

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
| `{kind}` | `raw_path` only: `article`, `social`, `pdf`, `note`… |
| `{type}` | `page_path` only: `sources`, `concepts`, `entities` or `syntheses` |

```sh
cortex config set raw_path "{yyyy}{mm}{dd}-{rand}-{slug}"   # raw/20261104-k3xz-context-rot/
cortex config set page_path "{type}/{slug}"                 # wiki/concepts/context-rot.md
```

`cortex config` rejects an invalid template: an unknown placeholder, a character other than letters, digits, `.`, `_`, `-` and `/`, an empty or `..` segment, or a last segment with no placeholder. A name that is already taken gets `-2`, `-3`… appended. Existing files are never renamed: `cortex lint` warns about the ones that do not follow the current templates.

### Reading paths

A reading path is an editorial itinerary: a goal, a few pages in order, and the reason to read each. It is written by hand, as a Markdown file in a `paths/` folder at the wiki root (next to `wiki/` and `raw/`). These files are not wiki pages: no command that reads `wiki/` sees them, only `cortex lint` and `cortex export`.

```md
---
title: Learn fermentation
goal: Understand the basics before reading the syntheses.
---
An optional introduction, in Markdown.

1. [Lactic fermentation](/wiki/concepts/lactic-fermentation.md): the mechanism everything else builds on.
2. [Brine](/wiki/entities/brine.md): the variable that matters most; it needs the page above.
```

The file name (`learn-fermentation.md`: lowercase letters, digits, dashes) is the address of the path. `title` and `goal` are required. Each step is an item of an ordered list that opens with a root-relative link to a wiki page (`/wiki/….md`, the same links as in the pages), then the reason, an inline Markdown text that may run over several lines; a `:` or a dash between the link and the reason is dropped. Text after the list is ignored.

`cortex lint` reports, against `paths/<name>.md`: an invalid front matter, a missing `title` or `goal`, a path with no step, a step that does not open with a link, a link to a page that does not exist (errors), a step with no reason and a page listed twice (warnings). `cortex export` publishes the valid ones, readable without WebGL or an account: `/paths/` lists them, `/paths/<name>/` shows one, and an article opened from a path (`?path=<name>` in its address) shows the step, the reason and "Previous / Next" links. A step on a missing page is dropped, a page named twice keeps its first step, and a wiki with no `paths/` folder has no path page link. The graph's Journey export can write its route as a draft in this format (`goal` left empty for you to write).

### Spaces

One `cortex.json`, one `.cortex/accounts.db` and one git repository can hold several isolated wikis, called spaces (a watch space, a work one, a personal one…). A space is a folder `spaces/<name>/` with its own `wiki/`, `raw/`, optional `paths/` and `inbox/`, and its own `.cortex/` (search index, judge scores…). The configuration is shared by the instance; only `repo` and `schema` can be set per space.

```
instance/
  cortex.json                 shared by all the spaces
  .cortex/accounts.db         one for the instance
  spaces/veille/{wiki,raw,.cortex}
  spaces/pro/{wiki,raw,.cortex}
```

An instance with a `spaces/` folder is multi-space; without one it works as always (`wiki/` and `raw/` at its root). In a multi-space instance, every command runs on one space, chosen in this order: the space whose folder you are in (or that `$CORTEX_ROOT` points into), `--space <name>`, `$CORTEX_SPACE`, `default_space` of `cortex.json`, the only space if there is one. Otherwise the command fails and lists the spaces. `--space` is kept when a command goes to a [remote wiki](#remote-wiki). The agents and the `serve` and `export` children Cortex starts stay in the space of the command.

```sh
cortex space add veille                  # spaces/veille/{wiki,raw}, with its index and journal
cortex space add pro --repo git@host:me/pro.git   # clones it into spaces/pro/, adds /spaces/pro/ to .gitignore, records it under spaces
cortex space list                        # * marks the default, "(own repo)" a space with its own .git
cortex space add pro --content notes --title "Work"   # a space of your own notes (see below); default: resources. Both: --content resources,notes; --title is its display name
cortex space migrate veille              # legacy wiki: moves wiki/, raw/, paths/, inbox/ and .cortex/ (except accounts.db) into spaces/veille/; the saved conversations, journeys and favorites of the accounts become that space's (run it again on an instance whose wiki already became a space: it then moves only those rows)
cortex --space pro search "context rot"
```

<a id="resources-and-notes"></a>**Resources and notes.** A space holds **resources** (external sources: URLs, PDFs, documents, compiled into linked pages: the watch), **notes** (your own writing: meetings, daily notes, appointments, docs), or both (`content`: `["resources"]` by default, `["notes"]`, or `["resources", "notes"]`). `content` picks the agent's schema: the default one for resources, the [notes schema](src/schema-notes.md) for notes (sources kept faithful: facts, decisions, dates, names, action items with their owner and due date; a meeting becomes a Source page linked to the people, projects and clients it concerns), and for both the default one followed by what is specific to notes. A `schema` of the space (or the global one) overrides all that. Each space has its own agent file (`CLAUDE.md` or `AGENTS.md` in `spaces/<name>/`), written by `cortex space add` and rewritten whenever the content changes (a hand-edited agent file is replaced, as by `cortex schema --write`).

`cortex add` records what a source is in its frontmatter (`content: resource` or `note`; the older `kind`, article, pdf, note…, is unchanged). Only some inputs name their kind: a URL, a PDF or a page captured from the browser (with its origin) is a **resource**. Any other input (stdin `-`, a local text or Markdown file, a typed share, the MCP `add` tool's `text`) takes what the space holds: a space with one content gets that content, and a space with both gets a **note**. `--as note|resource` (and the MCP `as` argument) overrides it for any input (a followed link is judged by itself). Unchecking a kind in a space means **no new addition of that kind and nothing deleted**: `cortex add` refuses a source of a kind the space does not hold (a URL in a notes space, an explicit `--as` of a kind it leaves out), with the reason, before fetching anything (`--dry-run` still reports what would happen); a share to a space (`/s/<name>/share/`) answers 409 with it for a link or a captured page in a notes space, a typed text is always taken; `cortex inbox`, the inbox of `serve` and `cortex compile --pending` skip such entries and say how many, leaving them where they are (a source with no `content`, all the earlier ones, is a resource). The pages already there stay readable and searchable. `cortex space list`, `GET /api/spaces` and the space's `GET /s/<name>/api/space` tell what each space holds. Only spaces have this check: a wiki at the root of an instance without `spaces/` takes everything. The export writes what the space holds (`content`) into the site data, so the home of a space of notes is prerendered as such (no flash of the resources home; a change of the content from the site queues a rebuild), and it marks the pages that come from notes: a page does when it cites at least one raw source and every one it cites is a note (`content: note`; the export publishes that fact, never the source). The home's "Recent notes" lists those pages, labelled as notes.

```sh
cortex space set pro --content resources,notes    # change it later (also rewrites the agent file)
echo "Call with Marie, Acme: budget approved, I send the quote by Friday 20" | cortex add - --space pro --note "call with Marie (Acme)"
cortex compile --space pro --pending     # or: cortex compile --space pro <id>
```

**Searching several spaces.** Only on request: `cortex search "context rot" --space veille,pro` (or `--space all`) searches each space with its own index, then fuses the rankings by reciprocal rank (k = 60, wiki before raw); each hit names its space (a prefix in the text output, a `space` field with `--json`). Every other command refuses a `--space` that names several spaces (`ask` takes it too: see [Asking several spaces](#asking-several-spaces)), and so does a search run from inside a space, as an agent is: it cannot read the others. The MCP `search` tool takes the same value in an optional `space` argument (`get` and `related` take one name, to open a hit of another space); without it, the server's own space. Through a [remote wiki](#remote-wiki) the MCP server starts at the instance (the space the call names, else `default_space`, stays the selected one), so the same argument works over ssh; a key whose forced command points `CORTEX_ROOT` into a space keeps the server confined to it. From the site, a signed-in visitor with several spaces gets a scope control on the search page: **This space** (the default), **All my spaces** or **Choose the spaces**; the results come grouped by space, and a hit opens in its own space (`GET /api/search?q=…&spaces=a,b|all`, at the root of the server: the site's own search, operators included and no judge, run in each requested space the visitor may see and fused by reciprocal rank like the CLI's, each hit carrying its `space`; a space they may not see, or that does not exist, is dropped without a word; more than one space, `all` included, is for a signed-in person, 401 otherwise; `Cache-Control: no-store`). A static export has no such control.

<a id="asking-several-spaces"></a>**Asking several spaces.** `cortex ask "who mentions the quokka?" --space veille,pro` (or `--space all`) lets the agent read those spaces together, read-only (never with `--file`: a page is written into one space). The agent runs from the instance and what it may read is the list of spaces the command was given, fixed by the code that starts it, never an option of the agent's own tools: the sandbox of every process it runs (the shell tool, the default engine, an interactive session) makes the instance read-only and hides every space that is not in the list (tmpfs on Linux, a file-read deny on macOS), along with `.cortex/archive/` and the accounts' database; the file tools of the SDK clients (`Read`, `Glob`, `Grep`) read inside `spaces/<name>/` of those spaces only, symbolic links resolved; and the tool pack has a `Search` that searches exactly those spaces (the same fused ranking as `cortex search --space`, each result naming its space, the path to read and the link to cite), as does `cortex search` run by the agent, bound to the list by its environment (`CORTEX_ASK_SPACES`, set by the process that starts the agent and its MCP server, which the agent cannot change: a name outside the list is refused, `all` means the list). Archived spaces are not in `spaces/` and never part of it; a read-only space is read like any other. The agent cites a page as a link `[title](/s/<space>/wiki/…md)`, with the space in the link: two spaces may hold a page of the same name. From inside a space the command is refused, as `search --space` is, and a remote wiki does not take it yet. On the site, **the assistant** has the same scope control as the search page (**This space**, **All my spaces**, **Choose the spaces**, for someone signed in with several spaces): `POST /s/<space>/api/ask` takes an extra `spaces` (a list of names, or `"all"`), each name checked with the visitor's access like the search across spaces (more than one space or `all`: signed in, else 401; a space they may not see, that does not exist or that is archived is dropped without a word; none left: 400); the conversation, its saved copy and its saved answers stay in the space where the question was asked. The answer's citations `/s/<space>/wiki/…` are drawn as links to those pages on their own sites and listed under the answer by space (`refs`: space, id, title); a citation of a page the question did not read, or with no space, is never a link. Two limits of the first version: the judge that retains pages for the site's questions (one call per page) is not used over several spaces, the agent starts from the fused search; and the answer has no display blocks (they name a page by its path in one space).

**One repository or several.** By default the instance's git repository holds all the spaces, and `serve --sync`, a remote wiki host and the other git steps commit only the files of the space they run on. A space cloned with `--repo` is its own repository (ignored by the instance's): git finds the nearest `.git`, so the same steps pull, commit and push into that repository. `migrate` uses `git mv` for what is tracked: commit the move afterwards.

**Isolation.** The agent of a space cannot reach the others. The file tools of the SDK clients are confined to the space's folder and write to its `wiki/` only. Everything that runs as a process (the shell tool, the default engine, interactive sessions) goes through `bwrap` on Linux or `sandbox-exec` on macOS: the whole instance (`cortex.json` and `.cortex/` included) is read-only except `spaces/<name>/wiki/`, and the other spaces are hidden, so they cannot be read. A `cortex --space <other>` run by the agent is refused: the folder it runs in decides.

**Serving the spaces.** On a multi-space instance one `cortex serve` serves every space (`--space <name>` serves just that one, at the root, as a single wiki). Each space is mounted under `/s/<name>/`: its own build of the site (exported with `CORTEX_SITE_BASE=/s/<name>`) and its own APIs (`/s/<name>/api/search`, `ask`, `verify`, `status`, and the person's saved `conversations`, `journeys` and `me/state` (their favorites in that space): page ids repeat from one space to the next, so each space keeps its own, behind the same visibility check), while the instance's routes stay at the root: sign-in and the account (`/api/auth/*`, `/api/me`, `/api/me/state` for the preferences of a legacy instance; one database for all the spaces), `GET`/`POST /api/spaces`, `POST /api/sync` (the CI's call: pulls and rebuilds every space) and the phone share target `/share/`, whose stable URL delivers to the default space; each space also has its own, `/s/<name>/share/` (its page, manifest and API under that prefix, behind the same visibility check, and the browser extension's server address takes it: `https://host/s/<name>`), which delivers into that space's `inbox/`. `/` redirects to the default space, or to the first one the visitor may see. **Old links keep working after `cortex space migrate`:** a `GET` of a root path that is a page (or a file) of the default space's site (`/wiki/<id>/`, `/tags/…`, `/search/?q=…`, `/graph/`, `/paths/…`, `/log/`, `/changes/`, `/account/`, `/help/`…) answers `301` to `/s/<default space>/<same path and query>` when the visitor may see that space (`default_space`, else the only space; `cache-control: no-store`, as the answer depends on who asks); a path that is no page of it, `/api/*` (the instance's, never a site's), and a default space the visitor may not see stay a plain 404. A browser that visited the site before the migration still holds its service worker (scope `/`, script `/service-worker.js`) and its caches, and a 404 would leave it serving the old root pages: the multi-space server answers that one URL with a worker that deletes the root site's caches, unregisters itself and reloads the pages it controlled (the spaces' own workers, `/s/<name>/service-worker.js` and their caches, are untouched). Every 404 under `/s/<name>/` leaves one line in the journal saying which branch answered (no such site, not allowed, the accounts' store failed, or not a file of the site). A legacy instance is served exactly as before, at the root. With `--sync` each space is pulled, committed and pushed from its own folder, so a space with its own repository uses it. Builds and the git steps run one at a time for the whole server, and so does the assistant (one question at a time).

**Who sees a space.** A space is `open` or `private` (kept in `.cortex/accounts.db`, table `spaces`; a space with no row is open, so an existing space needs no migration). An open space follows the rules of the site as any `cortex serve` (sign-in, when configured, only identifies people). A private space is visible to its members alone: its pages, its APIs and its entry in the listing answer 404 to anyone else, as if it did not exist. This never depends on who is left in the table: a private space whose members are all gone stays hidden, and so does one when `auth` is not configured (nobody can sign in to be a member) or when the accounts' store fails. A member is an `owner` or a plain `member`; owners administer the space (the last owner can be neither removed nor downgraded, and cannot delete their account while the space is live). A space nobody owns is administered from the command line:

```sh
cortex space list                                        # visibility and title of each space
cortex space set pro --visibility private --title "Work" # the title is only a display name: the slug (the folder, the URL) never changes
cortex space member pro add ada@example.org --role owner # an id or the e-mail of an account that signed in once; the role defaults to member
cortex space member pro remove ada@example.org           # without add/remove: lists the members
```

An accounts database from before this version is migrated when it is opened: its member rows become `owner`s and their spaces `private`, so nothing opens by the upgrade.

**Creating a space from the site.** When `auth` is configured, a signed-in person gets a space switcher in the header (when there is more than one space to choose from, or when they can create one) and a "Spaces" section on their account page: it lists the spaces they can open and creates a new one from a name (lowercase letters, digits and dashes, 40 at most) and what it holds (`POST /api/spaces { name, title?, content? }`: `content` a non-empty list of `resources` and `notes`, default `["resources"]`, recorded in `cortex.json` unless it is the default; the API accepts no schema, never a path). The space is created like `cortex space add` does, it is private and its creator is its owner (who may create one: see `site_spaces`), and with `--sync` its `wiki/`, `raw/` and agent file (and `cortex.json` when the content is not the default) are committed and pushed (`cortex space add <name> --sync` does the same from the command line, except for a space cloned with `--repo`, which is its own repository's); the person lands on its site once its first build is served. A name already taken (or archived) answers 409, a visitor who is not signed in 401, a request from another origin or without `auth` configured 403: nothing is created for them. A space backed by its own git repository is never created from the web (a web request must not clone an arbitrary URL): use `cortex space add <name> --repo <git url>` on the server.

**Administering a space.** Owners administer a space from the site through `/s/<name>/api/space` (404 to anyone who is not a member, 403 to a member who is not an owner on anything that changes, a same-origin request for every change). `GET` gives `{ name, title, visibility, read_only, content, custom_schema, storage, members: [{ id, name, role }], you }` (`content`: what the space holds; `custom_schema`: a schema of the space or a global one overrides it; `storage`: `instance` or `own repo`); `PATCH { title?, visibility?, read_only?, content? }` changes the display title, the states and the content (which rewrites the agent file and, with `--sync`, commits it with `cortex.json`) (the slug is the folder, the URL, the config key and the browser's storage key: it never changes); `PATCH /members/<id> { role }` and `DELETE /members/<id>` manage the people, always leaving an owner. `GET`, `POST { role? }` and `DELETE /invites/<id>` manage invitations: a link `/s/<name>/account/invite/?token=<token>` for a single person, valid 7 days, stored hashed, never e-mailed and never matched to an e-mail. Its page is the site's own (the `account/invite` route of the space's build, in the site's languages): the server answers it before the visibility check, for a valid token only (an unknown, used, expired or other space's token answers 404 like any page of a space the visitor may not see), `no-store` and `Referrer-Policy: no-referrer`; it asks the person to sign in, then `POST /api/invites/<token>/accept` (signed in, same origin) makes them a member with the invited role and they go into the space. A browser that holds a valid invitation is also lent the site's shell of that space (`/_app/…`, icons, fonts: no page, no data and no API) through a short-lived (15 minutes), `HttpOnly`, path-scoped cookie that is checked against the invitation on every request, so it stops working once the link is used; the rest of a private space stays a 404. The earlier form of the link, `/s/<name>/invite/<token>`, redirects there.

**Read-only.** A space can be made read-only, independently of its visibility and of archiving (`cortex space set <name> --read-only true`, or `PATCH /s/<name>/api/space { "read_only": true }` by an owner; `GET /api/spaces` and the space's `GET` tell). It stays visible and searchable as its visibility says, and nothing writes to its `wiki/` or `raw/` any more: the CLI refuses `add`, `new`, `index`, `inbox`, `compile`, `log add`, `links --write`, `ask --file` and `schema --write` up front (a `--dry-run` of `add` or `inbox` writes nothing and goes through), the MCP `add` tool refuses, the agent never runs in write mode (a `compile` is refused before it starts, and so is its tool server), and `serve` answers 409 with the reason to a review (`POST /api/verify`, whose `HEAD` probe answers 409 too, so the site can say the space is read-only instead of offering the button) and to a share (`POST /share/api`), and leaves what waits in `inbox/` where it is. The assistant (read mode), the search, the graph and the person's own saved conversations, journeys and favorites are not writes to the space and keep working. A store that cannot be read refuses writes rather than letting one through.

**Archiving.** `POST /s/<name>/api/space/archive { "confirm": "<name>" }` (the typed confirmation must equal the name) is the web's only way to remove a space, and it deletes nothing: the folder moves to `.cortex/archive/<name>-<yyyymmdd-hhmmss>/`, out of `spaces/`, so the space is no longer served (404 like any missing space), listed nor searched. Its people, visibility and title stay in the accounts, `default_space` is cleared if it was this one, with `--sync` the move is committed, and the name stays taken (`POST /api/spaces` and `cortex space add` answer 409 / refuse until it is restored). A space with its own git repository is refused (409): work that is not pushed could be lost, use `cortex space archive <name>` on the server (a running `serve` keeps serving it until restarted). `GET /api/spaces/archived` lists the archived spaces the signed-in person owns (`name`, `title`, `content`, `archived_at`); `POST /api/spaces/<name>/restore` (an owner, same origin; 404 to anyone else, 409 when a space of that name exists) puts the latest copy back, rebuilds its site and brings its people back (`default_space` is not restored). From the command line: `cortex space archive <name> [--sync]`, `cortex space restore <name> [--sync]`, `cortex space list --archived`.

### Wiki status

`/maintenance/` on the exported site summarizes, for the owner, what to look at: pages nothing links to (Source pages excepted), links to pages that do not exist, raw sources not compiled yet (`status: pending`), and pages to look at again (deprecated, past `stale_after`, or, with `review`, modified more than 180 days ago and not reviewed since). The definitions are those of `cortex lint`, computed at the export date (`SOURCE_DATE_EPOCH` if set), so the export stays reproducible. Each block says what it means and which command to run (`cortex compile --pending`, `cortex links`, `cortex lint`). The page is read-only and starts nothing. Raw sources stay private: only their count is published, never a title.

### MCP server

`cortex mcp` exposes the wiki to an external agent. The tools `search`, `get`, `related`, `lint` and `log` are read-only. `add` writes to `raw/` only, with an optional `note`. Example with Claude Code:

```sh
claude mcp add cortex -e CORTEX_ROOT=/path/to/your/wiki -- cortex mcp
```

### Remote wiki

On a machine without the wiki, the CLI can send each command over SSH to the `cortex` of the host that keeps it. That host runs it in its own checkout, pulls before and commits and pushes after. Nothing of the wiki is written locally.

```sh
cortex remote add perso runner@wiki-host --identity ~/.ssh/id_cortex   # once; the first remote added is the default
cortex search "context rot"                    # runs on wiki-host
claude mcp add cortex -- cortex mcp            # Claude Code on this machine, the wiki over there
```

`--identity` names the key for that wiki (ssh gets `-i <key> -o IdentitiesOnly=yes`); without it, ssh uses your `~/.ssh/config` and default keys, so `<user@host>` may also be a `Host` alias. A local wiki (`$CORTEX_ROOT`, a parent folder holding `cortex.json`) still comes first; `--wiki <name>` or `$CORTEX_WIKI` picks a remote one explicitly. `cortex add ./file.pdf` sends the file along. `serve`, `share`, `export`, `inbox` and `compile` are refused through a remote wiki, and `config` only reads. `ask` runs the agent on the wiki host: its agent CLI must be installed and logged in there. `cortex doctor` checks that the host answers and runs the same minor version.

On the host, give each machine's key a forced command, so that it can run nothing but cortex, in that checkout:

```
restrict,pty,command="CORTEX_ROOT=/srv/cortex/cli /usr/local/bin/cortex remote-exec" ssh-ed25519 AAAA… laptop
```

Commands run one at a time per checkout. A failed or interrupted command never loses what it wrote. When a push conflicts, the commit goes to a `cortex/pending-…` branch of the remote. See [docs/REMOTE-PLAN.md](docs/REMOTE-PLAN.md).

### Two ways to publish the site

The site is one SvelteKit app, fully prerendered: no page is rendered on a server. Two commands publish it, and the browser works out which one it is talking to.

- **`cortex export`** writes the static site to `.cortex/site` (or `--out`). Drop the folder on any file host: neither Bun nor Cortex runs there.
- **`cortex serve [--port N] [--sync]`** (needs `$CORTEX_REVIEWER`, port `8080` by default) builds the same site (a child `cortex export`, so the server stays responsive while it builds), serves it itself, and adds the `/api/*` routes (search by meaning and the judge's ranking, assistant, accounts, conversations, journeys, build status, `verify`, `sync`) and the phone share target under `/share/`. It rebuilds after every change it makes or is told about (a review, an inbox or share entry, `POST /api/sync`), into the other of two folders (`.cortex/serve/a` and `b`), then swaps when the child has finished successfully: requests keep the previous build until the new one is ready, and a failed build changes nothing (one line in the journal). Requests that arrive while a build runs share the one build that follows, and the journal tells how long each build took and how many requests it served. A caller of `POST /api/sync` or `verify` gets its answer when the request is accepted, not when the site is rebuilt; `GET /api/status` tells whether a build is running or waiting, and the site shows a small dot beside its mark meanwhile, then offers a reload (never done by itself) once the new build is served. A complete build left by a previous run is served as soon as `serve` starts (marked by `.cortex/serve/<a|b>.done`), the rebuild following in the background; the very first start still waits for its first build. The page embeddings are refreshed after the swap, never before it. With `--sync`, the wiki is a git checkout: it pulls before a write, commits and pushes after it. Search by meaning and the judge's ranking (`GET /api/search`, with the operators of the search bar) exist in `serve` only: the static site searches keywords in the browser.

The browser only asks what is there. A missing `/api/auth/methods` (404 on a static host) or an empty provider list means no accounts; a `HEAD /api/ask` that does not answer `204` means no assistant; `/api/verify` is probed the same way, and `/api/status` once (a 404 or a network failure ends the probing). What is missing is hidden, so the same site works in both modes.

| Feature | `cortex export` | `cortex serve` |
|---|---|---|
| Pages, graph and map, journeys (a route from page to page) | yes | yes |
| Keyword search with operators, in the browser | yes | yes |
| Offline reading (service worker) | yes | yes |
| Export a journey as Markdown | yes | yes |
| Preferences and favorites | this browser (`localStorage`) | this browser, or synchronised with your account (`auth`) |
| Search by meaning (`embed`) and ranked by the judge (`judge`) | no (keywords only) | yes: `GET /api/search` |
| Assistant | no | with `site_ask` |
| Accounts, saved conversations and journeys | no | with `auth` |
| « Mark as reviewed » | no | with `review` |
| Phone share target (`/share/`) | no | yes |
| Git sync of the wiki | no | with `--sync` |
| Rebuilt on change | no (run `export` again) | yes, with a small « updating » dot on the site while it builds |

In `serve`, every dynamic feature turns on only when its key is in `cortex.json`: a `serve` with neither `site_ask` nor `auth` behaves like the static site, plus the automatic rebuild.

Choose `export` to publish on a host you do not run yourself, or when nothing needs to write back. Choose `serve` when the site should follow the wiki on its own, or when you want the assistant, accounts, reviews or the share target.

### User accounts

`cortex serve` can keep a personal space for each person who signs in: preferences (theme, language, favorites), saved assistant conversations (resume, export as Markdown, delete) and saved graph journeys. Cortex never handles a password: it sends the browser to an identity provider and takes back an identity `(provider, subject)`. Without a sign-in the site works as before (preferences stay in the browser), and the static site (`cortex export`) has no `/api/*` at all, so the front end simply shows no account menu there.

Three providers, each active only when it is configured **and** its secret is in the environment:

- **`oidc`**: any OpenID Connect provider (the target is Authelia, itself backed by LDAP/Active Directory). `groups` (optional) lists the groups, in the `groups` claim, of whom the person must be in at least one; when the issuer keeps `groups` out of the ID token (Authelia's default), the userinfo endpoint is asked. The ID token must be signed with RS256 (the usual default).
- **`github`**: OAuth2. `allow` is a list of **numeric GitHub user ids** (a login can be renamed and taken over, so logins are not accepted); find an id with `curl https://api.github.com/users/<login>` (the `id` field). A refused sign-in logs the id it saw.
- **`google`**: OpenID Connect. `allow` is a list of e-mail addresses; the account's e-mail must be verified (`email_verified`).

An empty `allow` or `groups` list is refused by `cortex config lint` (it would let nobody in): leave the provider out instead. No two providers are ever merged: the same e-mail address on GitHub and on Google is two accounts.

```json
{
  "auth": {
    "public_urls": ["https://cortex.matsos.arpa", "https://cortex.home.matsos.cloud"],
    "oidc": { "label": "Authelia", "issuer": "https://auth.matsos.arpa", "client_id": "cortex", "groups": ["app-cortex"] },
    "github": { "client_id": "Iv1.…", "allow": [12345] },
    "google": { "client_id": "….apps.googleusercontent.com", "allow": ["x@gmail.com"] }
  }
}
```

**Deployment order: first publish and install the version of cortex that knows `auth`, and only then add `auth` to the wiki's `cortex.json`** (the schema is strict: an older cortex that meets an unknown key refuses to start `serve`). Put the secrets in the environment of the service, never in `cortex.json`:

```sh
CORTEX_OIDC_CLIENT_SECRET=…   CORTEX_GITHUB_CLIENT_SECRET=…   CORTEX_GOOGLE_CLIENT_SECRET=…
```

- **`public_urls`** (required with a provider): the origins the site is reached at, one per domain (`https://host[:port]`, no path). `serve` sits behind proxies and only sees plain http, so the redirect URI and the page the person lands on are built from this list, never from `Host` or the request's scheme. A login uses the entry whose host matches the request (its `Origin`, else `X-Forwarded-Host`, else `Host`; make the proxy forward the original host), else the first one. The `Secure` flag of the cookies follows the entry's scheme (`https`). The API lives at the root of the server: `CORTEX_SITE_BASE` only affects the static export, so there is no sub-path support here.
- **Redirect URIs to declare at each provider**, for every public URL: `<public_url>/api/auth/callback/oidc`, `<public_url>/api/auth/callback/github`, `<public_url>/api/auth/callback/google`. A GitHub OAuth App takes a single callback URL (a GitHub App takes several, or use one public URL); Google only accepts redirect URIs on a public domain over https.
- **Session**: a random 32-byte token, only its SHA-256 is stored; 14 days from the last use (renewed at most once a day); cookie `HttpOnly`, `SameSite=Lax` (`Strict` would drop it on the way back from the provider), `Path=/`, `Secure` and named `__Host-cortex_session` under an https public URL. Signing out deletes the session. The state, nonce and PKCE verifier of a login are kept in the database (single use, 10 minutes) and tied to the browser by a short-lived cookie restricted to the callback path.
- **Every state-changing request** (POST, PUT, PATCH, DELETE) of these routes needs an `Origin` header that is one of the `public_urls` origins; account responses are never cached (`Cache-Control: no-store`, and the service worker never touches `/api/*`).
- **Storage**: SQLite file `.cortex/accounts.db` of the wiki root, outside the build folders `serve` swaps and not versioned (`serve --sync` commits `raw/` and `wiki/` only; make sure `.cortex/` is in the wiki's `.gitignore`). Back it up if the accounts matter. Every row of user data carries its `user_id`; another person's data answers 404.

Declaring the client in Authelia (`configuration.yml`; the secret is the digest from `authelia crypto hash generate pbkdf2`, its plain value goes in `$CORTEX_OIDC_CLIENT_SECRET`):

```yaml
identity_providers:
  oidc:
    authorization_policies:
      cortex:
        default_policy: 'deny'
        rules:
          - policy: 'one_factor'
            subject: 'group:app-cortex'
    claims_policies:            # optional: puts groups in the ID token (Cortex also reads them from userinfo)
      cortex:
        id_token: ['groups', 'email', 'email_verified', 'preferred_username', 'name']
    clients:
      - client_id: 'cortex'
        client_name: 'Cortex'
        client_secret: '$pbkdf2-sha512$310000$…'
        public: false
        authorization_policy: 'cortex'
        claims_policy: 'cortex'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://cortex.matsos.arpa/api/auth/callback/oidc'
          - 'https://cortex.home.matsos.cloud/api/auth/callback/oidc'
        scopes: ['openid', 'profile', 'email', 'groups']
        response_types: ['code']
        grant_types: ['authorization_code']
        token_endpoint_auth_method: 'client_secret_basic'
        access_token_signed_response_alg: 'none'
        userinfo_signed_response_alg: 'none'
```

The routes (JSON; `401` without a session on `/api/me*`, `/api/conversations*`, `/api/journeys*`). The site's header menu and its `/account/` page use them (preferences are synchronised; conversations and journeys are listed, renamed and deleted there):

| Route | |
|---|---|
| `GET /api/auth/methods` | `{ providers: [{ id, label }] }` (empty when nothing is configured; the route is absent on a static site) |
| `GET /api/auth/login/:provider?return=/path` | redirects to the provider; `return` is a path of the site (anything else becomes `/`) |
| `GET /api/auth/callback/:provider` | opens the session, redirects to `return`; a refusal or an error redirects there with `?auth=refused` or `?auth=error`, never with a detail (the server log has it) |
| `POST /api/auth/logout` | deletes the session |
| `GET /api/me`, `DELETE /api/me` | `{ id, name, email, provider }`; delete the account and everything under it |
| `GET /api/me/state`, `PUT /api/me/state` | the preferences: a JSON object of at most 64 KB, replaced as a whole (`Last-Modified` tells when) |
| `GET /api/conversations?q=` | `{ conversations: [{ id, title, exchanges, created_at, updated_at }] }`, newest first, `q` filters titles and questions |
| `POST /api/conversations` | `{ title?, turns: [{ question, answer, pages?, at? }] }`: 1 to 200 exchanges, 1,000,000 characters at most, title up to 120 (default: the first question) |
| `GET`, `PUT`, `DELETE /api/conversations/:id` | `PUT` takes `{ title?, turns? }` |
| `GET /api/status` | `{ building, since?, last? }`, no account needed, `Cache-Control: no-store` (`HEAD` answers `204`; `404` on a static site). `building` is true while a rebuild runs or waits (the quiet time before it, or one more build queued behind the running one); `since` (ISO date) is when the server became busy, only while building; `last` is `{ at, ok, ms }` of the latest build ended since this process started (`ok: false`: the build failed and the previous site is still served), absent before the first. It becomes `building: false` once the new site is served. The site probes it at load, every 30 s while the tab is visible and every 3 s while `building`, never in a hidden tab or offline. |
| `GET /api/search?q=&limit=&judge=1` | (In a multi-space instance, at the root: `GET /api/search?q=&spaces=a,b\|all`, see "Searching several spaces" above; under `/s/<name>/` this one.)  The site's search by meaning, no account needed, `Cache-Control: no-store` (`HEAD` answers `204`; `404` on a static site). `q` (1 to 500 characters) takes the operators of the search bar (`#tag`, `type:`, `status:`, `is:`, `"phrases"`, `-exclusions`, `OR`, groups, in English or French: the site's own parser), `limit` 20 by default, 50 at most. The words go through the hybrid search of `wiki/` (words, title typos, meaning when `embed` is set), then the operators filter the hits as they filter the site's pages (a plain word query keeps the pages found by meaning alone; as soon as the query has a group or an `OR`, it is Boolean and read literally, as in the site: its top-level free words must also be in the page, accents and case ignored, so `chien (lasagnes OR type:source)` is « chien » AND the group); `is:fav` is the browser's own list and is ignored (`ignored: ["is:fav"]`; removed from the query, a negated group that holds it is dropped whole, so that the browser applies it to the hits); a query with operators only lists the pages by title (`match: "filter"`). Answer `{ hits: [{ id, path, title, type, extract, match, score }], judged: false }`: `id` is the site's page id, `match` is `lexical`, `semantic`, `both` or `filter`, `score` is the hybrid score (higher is better; follow the order of the list). With `judge=1` and a [`judge`](#the-agent-schema), the best `judge.search_candidates` hits that passed the operators are each judged against the free text of the query, and the answer is `{ hits: [{ …, relevance, group }], judged: true, model, unjudged }`: `group` is `retained` (`search_retained` or more), `related` (from `search_related`), `other` (judged below), or `unjudged` (past the candidates, or its call failed: one failure never cancels the others); order: retained then related by decreasing relevance, then the rest in the hybrid order. Not judged, `judged: false` and a `reason`: `not-configured`, `no-text` (operators only), `no-hits`, `unavailable` (no call succeeded). One judged search at a time (`429` otherwise), same origin only. |
| `POST /api/ask/render` | `{ answers: [Markdown] }` (up to 200, 1,000,000 characters in all; same origin only, needs `site_ask`) → `{ answers: [{ segments, cited }] }`: the saved answers drawn again as `/api/ask` draws them, so the panel can resume a conversation (no model involved) |
| `GET /api/journeys`, `POST /api/journeys` | `{ title?, route: [page ids] }`: 1 to 500 ids, default title « Voyage : <first page> → <last page> » |
| `GET`, `PUT`, `DELETE /api/journeys/:id` | `PUT` takes `{ title?, route? }` |

### Static site

`cortex export` reads `wiki/` (and the reading paths of `paths/`), so `raw/` is never published and sources link to their original URL. The result is a prerendered SvelteKit site, and you can serve it from any static file server, including under a sub-path:

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
| `src/schema-notes.md` | The built-in schema for spaces of notes; its parts marked `notes:begin` / `notes:end` are what a space of both adds to the default one. |
| `docs/DESIGN.md` | Architecture and design decisions. |
| `assets/logo/` | The logo, as SVG and PNG. |

## License

[MIT](LICENSE) © Franck Matsos
