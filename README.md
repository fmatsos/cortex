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
| `cortex add <url\|file\|-> [--note "…"] [--via freedium] [--dry-run]` | Captures a source into `raw/` with status `pending`, and logs it. Idempotent: an existing URL or content returns the existing id. Posts from X, Bluesky, Mastodon and LinkedIn are read through their public data, and the pages they link to are captured too, as sources tied to the post (`linked` / `linked_from`), through Freedium, then archive.ph and the Wayback Machine, when paywalled. `--via freedium` reads the URL itself through that same chain. `--linked-from <id>` ties the source to one already in `raw/` that it was found in (a newsletter and the pages it points to) the same way, both ways. |
| `cortex inbox [--dry-run]` | Runs `add` on everything in `inbox/`. `urls.txt` holds one `<url> [note…]` per line, a `*.url` file holds one such line. Any other file is added, with an optional note in `<name>.note` and an optional origin URL in `<name>.origin` (the file is the content, the URL is kept as the source's `url` and not fetched). Successful entries leave the inbox. The [Chrome extension](extension/README.md) sends the page you are looking at (paywalled or login-walled content included) to the share app this way. |
| `cortex search "<query>" [--in wiki\|raw] [--json] [--limit N]` | Hybrid search: words, title typos and, if `embed` is set, meaning (see [Hybrid search](#hybrid-search)). `--json` adds `match` (`lexical`, `semantic` or `both`). |
| `cortex index` | Regenerates `wiki/index.md` and `wiki/log.md`. |
| `cortex new <Source\|Concept\|Entity\|Synthesis> "<title>" [--force]` | Creates `wiki/<type>/<uuid>.md` as a `draft` and prints its path. Refuses a title that already exists, a near title of the same type (same words, or one word more) and, with [`embed`](#the-agent-schema) (and ideally `judge`), a page of the same type that covers the same subject: `--force` creates it anyway, by hand only (refused to an agent). A close page that is not refused is listed as a warning. |
| `cortex lint [--json]` | Runs the mechanical checks. Exits with code 1 on errors. |
| `cortex links [--write] [--json]` | Pages that mention a concept or entity (its `title` or `aliases`) without linking to it. A suggestion needs the name as whole words in the prose, a name that is not a common word in the wiki (often linked where it appears), and a shared tag, source or close vocabulary. Same wiki, same suggestions; each comes with its reasons. `--write` turns the first mention into the link; `compile` does it on its own, only for the pages it touched and the mentions of the pages it created. |
| `cortex log [--limit N] [--json] [--kind k]` | Reads the journal, newest first. |
| `cortex log add <kind> "<text>" [--source <id>]… [--page <path>]…` | Appends a journal entry (`add`, `ingest`, `query`, `lint` or `update`). |
| `cortex compile <id…> \| --pending [--batch]` | Runs the ingest workflow, one agent session per source. Sessions are interactive by default. With `--batch`, no one validates and pages are written as `draft`. |
| `cortex ask "<question>" [--file] [--interactive]` | Answers from the wiki, read-only. `--file` stores the answer in `wiki/syntheses/`. |
| `cortex export [--out <dir>]` | Builds the static site (default `.cortex/site`). The output directory is emptied first. |
| `cortex mcp` | Starts an MCP server on stdio. |
| `cortex schema [--write]` | Prints the agent schema, or rewrites `CLAUDE.md` / `AGENTS.md` with it. |
| `cortex space list \| add <name> [--repo <url>] \| migrate <name>` | Manages the [spaces](#spaces) of an instance. |
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
| `schema` | Path, relative to the instance root (the folder holding `cortex.json`), of your own Markdown schema, used instead of the built-in one. `{{language}}` works there too. |
| `fetch_timeout` | Seconds before fetching a URL gives up (default `30`). With `--via`, each mirror gets that much. |
| `parser.social.external_link.limit` | Pages a social post links to that `cortex add` also captures, as sources tied to the post (default `5`, `0` = links not followed). Each one is compiled in its own agent session. `parser.social.<network>.external_link.limit` (`x`, `bluesky`, `mastodon`, `linkedin`) overrides it for one network. Example: `{ "parser": { "social": { "external_link": { "limit": 2 }, "linkedin": { "external_link": { "limit": 0 } } } } }`. |
| `parser.social.linkedin` | Selectors LinkedIn is read with outside its JSON-LD, to update when LinkedIn changes its page: `card` (link card), `activity_text`, `activity_author`, `activity_images` (activity page), `shortlink` (destination link on the lnkd.in interstitial), `carousel` (attribute holding the carousel's JSON). Each key is optional, defaults in `src/social/linkedin.ts`. Example: `{ "parser": { "social": { "linkedin": { "card": "a.card" } } } }`. |
| `embed` | Vectors for the hybrid search; absent = off (words only). `{ "provider": "openai" \| "local", "model": …, "dims": …, "base_url": …, "threads": … }`, every key optional. Without `provider`, a server speaking the OpenAI `POST <base_url>/embeddings` API (llama.cpp with Qwen3-Embedding…), `qwen3-embed`, 256 dimensions: a config written before `provider` existed keeps working unchanged. `"provider": "local"` runs `Xenova/multilingual-e5-small` inside cortex. Details, thresholds and deployment: [Hybrid search](#hybrid-search). |
| `site_ask` | The assistant of the site `cortex serve` hosts: a conversation about the wiki in a panel docked on the right (a drawer on a small screen), opened by its header button or Ctrl+I, kept from page to page; search and questions stay apart (a query phrased as a question offers "Ask the assistant" in the palette, Enter only searches); absent = off, since each question spends tokens; needs a client (`site_ask.client`, else `client`), so the model and the tools are under control. `{ "client": …, "model": …, "effort": …, "base_url": …, "history_turns": … }`, every key optional: `client` lets the questions use another client than compiling (e.g. `openai` on a pay-per-use API while compiling stays on a subscription); `model` defaults to `haiku` (claude) or `gpt-6-luna` (codex), otherwise `model` when the client is the global one (required for `openai`); `effort` is not sent unless set here (the global one is for compiling); `base_url` (openai client) defaults to `$CORTEX_ASK_BASE_URL`, else the openai client's. The key goes in `$CORTEX_ASK_API_KEY`, only ever sent to `$CORTEX_ASK_BASE_URL` (or a `site_ask.base_url` equal to it), so it never mixes with `$OPENAI_API_KEY` (embeddings…). The agent answers read-only and cites the pages it used. With a `judge`, each page the search finds (`judge.ask_candidates`, 16) is judged alone against the question; the pages at `ask_retained` (0.5) or more are given to the agent in full and listed under the answer, those from `ask_related` (0.3) are named as related; the same question retains the same pages (the scores are kept in `.cortex/judge.db`, shared with the search's ranking: see `judge`; a call that fails leaves its page out, the pages judged count). Without a judge, or when it fails, the agent gets the search hits up front (BM25 fused with `embed` when configured). The site sends the earlier turns of the conversation with each question (the server keeps none): the last `history_turns` exchanges (a question and its answer; default 10, or the limit of the client's provider when it defines one), and the panel warns once the conversation has reached that depth (the number comes from the `x-ask-history-turns` header of the `/api/ask` probe). With the `openai` and `claude` clients the agent also gets a `render_blocks` tool to lay out its answer with the site's components (callout, table, steps, tabs, key facts, key pages), each block checked against its schema before it is accepted; the other clients answer in Markdown. One question at a time; give your reverse proxy a read timeout of a minute or more. |
| `auth` | User accounts of the site `cortex serve` hosts (see [User accounts](#user-accounts)); absent = no sign-in, the site works as before. `{ "public_urls": ["https://cortex.example"], "oidc": { "label": "Authelia", "issuer": …, "client_id": …, "groups": […] }, "github": { "client_id": …, "allow": [<numeric ids>] }, "google": { "client_id": …, "allow": ["<e-mails>"] } }`. Each provider is active only when configured **and** its secret is in the environment (`$CORTEX_OIDC_CLIENT_SECRET`, `$CORTEX_GITHUB_CLIENT_SECRET`, `$CORTEX_GOOGLE_CLIENT_SECRET`: never in this file, which is versioned). |
| `review` | Review notion on the site: « never reviewed » and « to review again » marks, the `is:verified` / `is:unverified` / `is:review` filters and facets, the reviewer in the page details, the « Mark as reviewed » button, the footer count and the read-only review queue (`/review/`, validation stays on each page). `true` to turn it on; absent = off, and none of it reaches the exported site. |
| `drafts` | Draft status on the site: the draft mark, the `status:draft` filter and facet. `true` to turn it on; absent = off, draft pages are shown as stable. |
| `judge` | A System One model that answers yes/no and choice questions at `POST <base_url>/systemone`: TypeSafe's hosted Jev, or d3-mini behind llama.cpp; absent = off. `{ "base_url": …, "model": "d3-mini" }`, every key optional. `base_url`: its own, else `$CORTEX_JEV_BASE_URL` (key in `$CORTEX_JEV_API_KEY`, sent only there), else as for `embed`. `model`: default `$CORTEX_JEV_MODEL`, else `d3-mini`. The former `CORTEX_JUDGE_*` names (`CORTEX_JUDGE_BASE_URL`, `CORTEX_JUDGE_API_KEY`, ...) are still read when the new one is absent, with a one-time deprecation warning; the new name wins if both are set, and an old key is only sent with the old URL (or with the new one when no old URL is set). Settings that depend on the model, each from cortex.json, else `$CORTEX_JEV_<NAME>` (e.g. `CORTEX_JEV_ROUTE_YES`), else the default: `route_yes` (0.5) and `dup_yes` (0.7), the probabilities from which a page is suggested to `compile` or a new page refused; `route_candidates` (10) and `dup_candidates` (5), the pages offered to the judge; `route_chars` (1500), the characters of the source it reads; `ask_retained` (0.5), `ask_related` (0.3) and `ask_candidates` (16) for the site's questions (see `site_ask`); `search_retained` (0.5), `search_related` (0.3, never above `search_retained`: checked by `cortex config lint`, and lowered at run time otherwise) and `search_candidates` (20) for the judged ranking of the site's search (`GET /api/search?judge=1`, below); `concurrency` (6), the simultaneous calls of one batch. Each page is judged in its own call (a batch in one call scored the same page 0.24 first and 0.75 last), and every score is kept in `.cortex/judge.db` as soon as it arrives, under the hash of the model, the question's wording, the normalized query (lowercase, spaces collapsed), the page and the text the judge reads of it: a page edited, or another model, is judged again; scores older than 30 days, and the oldest beyond 20,000, are forgotten. For Jev: `CORTEX_JEV_BASE_URL=https://api.typesafe.ai/v1`, `CORTEX_JEV_MODEL=jev-1.13.0`, `CORTEX_JEV_ROUTE_YES=0.65` (best F1 measured on a real wiki). Used by `cortex new` (does the new page duplicate one of the 5 closest pages by meaning? refused at probability 0.7) and by `compile` (the pages the source probably updates, listed in the agent's prompt). Needs `embed` for both. Server down or slow: one warning, then the same behaviour as without it (cosine alone for `new`, nothing for `compile`). The judge's endpoint is `judge.base_url`, else `$CORTEX_JEV_BASE_URL`; the key is optional and only in `$CORTEX_JEV_API_KEY` (sent to that URL alone, never read from cortex.json); in a batch of calls (the site's questions and search) one call that fails, or that gets an unusable answer, does not stop the others. |
| `default_space` | The space used when none is chosen, in a multi-space instance (see [Spaces](#spaces)). |
| `spaces` | Per-space settings, by name: `{ "veille": { "repo": "<git url>" } }`. `repo` is written by `cortex space add --repo`. |
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

One `cortex.json`, one `.cortex/accounts.db` and one git repository can hold several isolated wikis, called spaces (a watch space, a work one, a personal one…). A space is a folder `spaces/<name>/` with its own `wiki/`, `raw/`, optional `paths/` and `inbox/`, and its own `.cortex/` (search index, judge scores…). The configuration is shared by the instance; only `repo` can be set per space.

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
cortex space migrate veille              # legacy wiki: moves wiki/, raw/, paths/, inbox/ and .cortex/ (except accounts.db) into spaces/veille/
cortex --space pro search "context rot"
```

**One repository or several.** By default the instance's git repository holds all the spaces, and `serve --sync`, a remote wiki host and the other git steps commit only the files of the space they run on. A space cloned with `--repo` is its own repository (ignored by the instance's): git finds the nearest `.git`, so the same steps pull, commit and push into that repository. `migrate` uses `git mv` for what is tracked: commit the move afterwards.

**Isolation.** The agent of a space cannot reach the others. The file tools of the SDK clients are confined to the space's folder and write to its `wiki/` only. Everything that runs as a process (the shell tool, the default engine, interactive sessions) goes through `bwrap` on Linux or `sandbox-exec` on macOS: the whole instance (`cortex.json` and `.cortex/` included) is read-only except `spaces/<name>/wiki/`, and the other spaces are hidden, so they cannot be read. A `cortex --space <other>` run by the agent is refused: the folder it runs in decides.

**Serving the spaces.** On a multi-space instance one `cortex serve` serves every space (`--space <name>` serves just that one, at the root, as a single wiki). Each space is mounted under `/s/<name>/`: its own build of the site (exported with `CORTEX_SITE_BASE=/s/<name>`) and its own APIs (`/s/<name>/api/search`, `ask`, `verify`, `status`), while the instance's routes stay at the root: sign-in and the account (`/api/auth/*`, `/api/me*`, `/api/conversations*`, `/api/journeys*`, one database for all the spaces), `GET`/`POST /api/spaces`, `POST /api/sync` (the CI's call: pulls and rebuilds every space) and the phone share target `/share/`, which delivers to the default space. `/` redirects to the default space, or to the first one the visitor may see. A legacy instance is served exactly as before, at the root. With `--sync` each space is pulled, committed and pushed from its own folder, so a space with its own repository uses it. Builds and the git steps run one at a time for the whole server, and so does the assistant (one question at a time).

**Who sees a space.** A space with no member is open: the rules of the site apply to it as to any `cortex serve` (sign-in, when configured, only identifies people). A space with members is visible to them alone: its pages, its APIs and its entry in the listing answer 404 to anyone else, as if it did not exist. Members are kept in `.cortex/accounts.db` (table `space_members`), and deleting an account never opens a space. Without `auth` in `cortex.json`, every space is open. Signing in is done on the account page of a space the visitor can open (or at `/api/auth/login/<provider>?return=/`).

**Creating a space from the site.** When `auth` is configured, a signed-in person gets a space switcher in the header (when there is more than one space to choose from, or when they can create one) and a "Spaces" section on their account page: it lists the spaces they can open and creates a new one from a name (lowercase letters, digits and dashes, 40 at most). The space is created like `cortex space add` does, its only member is its creator (private by default), and with `--sync` its `wiki/` and `raw/` are committed and pushed; the person lands on its site once its first build is served. A name already taken answers 409, a visitor who is not signed in 401, a request from another origin or without `auth` configured 403: nothing is created for them. A space backed by its own git repository is never created from the web (a web request must not clone an arbitrary URL): use `cortex space add <name> --repo <git url>` on the server. Nothing in the site can add other members, rename or delete a space yet.

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
| `GET /api/search?q=&limit=&judge=1` | The site's search by meaning, no account needed, `Cache-Control: no-store` (`HEAD` answers `204`; `404` on a static site). `q` (1 to 500 characters) takes the operators of the search bar (`#tag`, `type:`, `status:`, `is:`, `"phrases"`, `-exclusions`, `OR`, groups, in English or French: the site's own parser), `limit` 20 by default, 50 at most. The words go through the hybrid search of `wiki/` (words, title typos, meaning when `embed` is set), then the operators filter the hits as they filter the site's pages (a plain word query keeps the pages found by meaning alone; as soon as the query has a group or an `OR`, it is Boolean and read literally, as in the site: its top-level free words must also be in the page, accents and case ignored, so `chien (lasagnes OR type:source)` is « chien » AND the group); `is:fav` is the browser's own list and is ignored (`ignored: ["is:fav"]`; removed from the query, a negated group that holds it is dropped whole, so that the browser applies it to the hits); a query with operators only lists the pages by title (`match: "filter"`). Answer `{ hits: [{ id, path, title, type, extract, match, score }], judged: false }`: `id` is the site's page id, `match` is `lexical`, `semantic`, `both` or `filter`, `score` is the hybrid score (higher is better; follow the order of the list). With `judge=1` and a [`judge`](#the-agent-schema), the best `judge.search_candidates` hits that passed the operators are each judged against the free text of the query, and the answer is `{ hits: [{ …, relevance, group }], judged: true, model, unjudged }`: `group` is `retained` (`search_retained` or more), `related` (from `search_related`), `other` (judged below), or `unjudged` (past the candidates, or its call failed: one failure never cancels the others); order: retained then related by decreasing relevance, then the rest in the hybrid order. Not judged, `judged: false` and a `reason`: `not-configured`, `no-text` (operators only), `no-hits`, `unavailable` (no call succeeded). One judged search at a time (`429` otherwise), same origin only. |
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
| `docs/DESIGN.md` | Architecture and design decisions. |
| `assets/logo/` | The logo, as SVG and PNG. |

## License

[MIT](LICENSE) © Franck Matsos
