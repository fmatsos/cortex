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
- **Search.** `cortex search` uses BM25 (index kept in `.cortex/`, only changed files are read again), searching the wiki first and then the raw sources. With an [`embed`](#the-agent-schema) server configured, it fuses BM25 with semantic similarity.
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
| `cortex search "<query>" [--in wiki\|raw] [--json] [--limit N]` | BM25 search (plus semantic similarity if `embed` is set). |
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
| `parser.social.external_link.limit` | Pages a social post links to that `cortex add` also captures, as sources tied to the post (default `5`, `0` = links not followed). Each one is compiled in its own agent session. `parser.social.<network>.external_link.limit` (`x`, `bluesky`, `mastodon`, `linkedin`) overrides it for one network. Example: `{ "parser": { "social": { "external_link": { "limit": 2 }, "linkedin": { "external_link": { "limit": 0 } } } } }`. |
| `parser.social.linkedin` | Selectors LinkedIn is read with outside its JSON-LD, to update when LinkedIn changes its page: `card` (link card), `activity_text`, `activity_author`, `activity_images` (activity page), `shortlink` (destination link on the lnkd.in interstitial), `carousel` (attribute holding the carousel's JSON). Each key is optional, defaults in `src/social/linkedin.ts`. Example: `{ "parser": { "social": { "linkedin": { "card": "a.card" } } } }`. |
| `embed` | Semantic search through an OpenAI-compatible `/embeddings` server (llama.cpp with Qwen3-Embedding-0.6B…); absent = off. `{ "base_url": …, "model": "qwen3-embed", "dims": 256 }`, every key optional: `base_url` follows the openai client (`base_url`, else `$OPENAI_BASE_URL`, else Ollama; `$OPENAI_API_KEY` only goes to a URL the environment names). `cortex index` (so every compile) embeds the new and changed pages into `.cortex/embeddings.json`; `search` then fuses BM25 and cosine top 50 (RRF), and `related` adds pages close in meaning. Server down or not indexed yet: plain BM25, one warning. |
| `site_ask` | The assistant of the site `cortex serve` hosts: a conversation about the wiki in a panel docked on the right (a drawer on a small screen), opened by its header button or Ctrl+I, kept from page to page; search and questions stay apart (a query phrased as a question offers "Ask the assistant" in the palette, Enter only searches); absent = off, since each question spends tokens; needs a client (`site_ask.client`, else `client`), so the model and the tools are under control. `{ "client": …, "model": …, "effort": …, "base_url": … }`, every key optional: `client` lets the questions use another client than compiling (e.g. `openai` on a pay-per-use API while compiling stays on a subscription); `model` defaults to `haiku` (claude) or `gpt-6-luna` (codex), otherwise `model` when the client is the global one (required for `openai`); `effort` is not sent unless set here (the global one is for compiling); `base_url` (openai client) defaults to `$CORTEX_ASK_BASE_URL`, else the openai client's. The key goes in `$CORTEX_ASK_API_KEY`, only ever sent to `$CORTEX_ASK_BASE_URL` (or a `site_ask.base_url` equal to it), so it never mixes with `$OPENAI_API_KEY` (embeddings…). The agent answers read-only and cites the pages it used. With a `judge`, each page the search finds (`judge.ask_candidates`, 16) is judged alone against the question; the pages at `ask_retained` (0.5) or more are given to the agent in full and listed under the answer, those from `ask_related` (0.3) are named as related; within a serve process the same question retains the same pages (the scores are kept in memory). Without a judge, or when it fails, the agent gets the search hits up front (BM25 fused with `embed` when configured). The site sends the earlier turns of the conversation with each question (the server keeps none). With the `openai` and `claude` clients the agent also gets a `render_blocks` tool to lay out its answer with the site's components (callout, table, steps, tabs, key facts, key pages), each block checked against its schema before it is accepted; the other clients answer in Markdown. One question at a time; give your reverse proxy a read timeout of a minute or more. |
| `auth` | User accounts of the site `cortex serve` hosts (see [User accounts](#user-accounts)); absent = no sign-in, the site works as before. `{ "public_urls": ["https://cortex.example"], "oidc": { "label": "Authelia", "issuer": …, "client_id": …, "groups": […] }, "github": { "client_id": …, "allow": [<numeric ids>] }, "google": { "client_id": …, "allow": ["<e-mails>"] } }`. Each provider is active only when configured **and** its secret is in the environment (`$CORTEX_OIDC_CLIENT_SECRET`, `$CORTEX_GITHUB_CLIENT_SECRET`, `$CORTEX_GOOGLE_CLIENT_SECRET`: never in this file, which is versioned). |
| `review` | Review notion on the site: « never reviewed » and « to review again » marks, the `is:verified` / `is:unverified` / `is:review` filters and facets, the reviewer in the page details, the « Mark as reviewed » button and the footer count. `true` to turn it on; absent = off, and none of it reaches the exported site. |
| `drafts` | Draft status on the site: the draft mark, the `status:draft` filter and facet. `true` to turn it on; absent = off, draft pages are shown as stable. |
| `judge` | A System One model that answers yes/no and choice questions at `POST <base_url>/systemone`: TypeSafe's hosted Jev, or d3-mini behind llama.cpp; absent = off. `{ "base_url": …, "model": "d3-mini" }`, every key optional. `base_url`: its own, else `$CORTEX_JUDGE_BASE_URL` (key in `$CORTEX_JUDGE_API_KEY`, sent only there), else as for `embed`. `model`: default `$CORTEX_JUDGE_MODEL`, else `d3-mini`. Settings that depend on the model, each from cortex.json, else `$CORTEX_JUDGE_<NAME>` (e.g. `CORTEX_JUDGE_ROUTE_YES`), else the default: `route_yes` (0.5) and `dup_yes` (0.7), the probabilities from which a page is suggested to `compile` or a new page refused; `route_candidates` (10) and `dup_candidates` (5), the pages offered to the judge; `route_chars` (1500), the characters of the source it reads; `ask_retained` (0.5), `ask_related` (0.3) and `ask_candidates` (16) for the site's questions (see `site_ask`). For Jev: `CORTEX_JUDGE_BASE_URL=https://api.typesafe.ai/v1`, `CORTEX_JUDGE_MODEL=jev-1.13.0`, `CORTEX_JUDGE_ROUTE_YES=0.65` (best F1 measured on a real wiki). Used by `cortex new` (does the new page duplicate one of the 5 closest pages by meaning? refused at probability 0.7) and by `compile` (the pages the source probably updates, listed in the agent's prompt). Needs `embed` for both. Server down or slow: one warning, then the same behaviour as without it (cosine alone for `new`, nothing for `compile`). |
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
| `{kind}` | `raw_path` only: `article`, `social`, `pdf`, `note`… |
| `{type}` | `page_path` only: `sources`, `concepts`, `entities` or `syntheses` |

```sh
cortex config set raw_path "{yyyy}{mm}{dd}-{rand}-{slug}"   # raw/20261104-k3xz-context-rot/
cortex config set page_path "{type}/{slug}"                 # wiki/concepts/context-rot.md
```

`cortex config` rejects an invalid template: an unknown placeholder, a character other than letters, digits, `.`, `_`, `-` and `/`, an empty or `..` segment, or a last segment with no placeholder. A name that is already taken gets `-2`, `-3`… appended. Existing files are never renamed: `cortex lint` warns about the ones that do not follow the current templates.

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
| `POST /api/ask/render` | `{ answers: [Markdown] }` (up to 200, 1,000,000 characters in all; same origin only, needs `site_ask`) → `{ answers: [{ segments, cited }] }`: the saved answers drawn again as `/api/ask` draws them, so the panel can resume a conversation (no model involved) |
| `GET /api/journeys`, `POST /api/journeys` | `{ title?, route: [page ids] }`: 1 to 500 ids, default title « Voyage : <first page> → <last page> » |
| `GET`, `PUT`, `DELETE /api/journeys/:id` | `PUT` takes `{ title?, route? }` |

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
