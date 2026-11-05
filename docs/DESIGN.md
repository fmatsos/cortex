---
type: Design Doc
title: "DESIGN — Cortex v2"
description: "Design of v2: architecture, the cortex CLI (Bun), dependencies, roadmap."
---
# DESIGN — Cortex v2

> Status: proposal (2026-11-04). Drawn from two independent analyses (Opus and Fable).
> Replaces the v1 approach (multi-agent pipeline + GitHub Actions) of this repository.

## 1. Why a v2

v1 produced more machinery than knowledge:

| Machinery | What it produced |
|---|---|
| 100 commits in 14 days, then 14 months of silence | 7 notes (~12 KB), 6 of 7 about LLMs |
| 5 agents, 4 JSON handoff schemas, 6 GitHub Actions, `rules.yaml` | empty `zettels/`, `summaries/`, `archive/` |
| 4 stack changes in 10 days (Bash → Go → Cobra → Bun → opencode) | 3 redundant “context rot” notes, never deduplicated |
| Index written by an LLM | `index.md` points to files that do not exist |
| CI that validates handoffs | `writer_to_organizer.schema.json` is invalid JSON (line 90) |

**Causes:**
1. Enterprise architecture for a solo use.
2. An LLM in the wrong place: it was given the plumbing, with no human for the judgment.
3. Asynchronous processing by cron, with no immediate feedback.
4. A dependency on GitHub (secrets that expire, CI that runs an LLM).
5. No query operation.

**To keep:** Markdown + frontmatter, the separation between raw capture and lasting knowledge, the “URL → sourced summary” operation.

## 2. Foundations

### LLM Wiki (Karpathy)

The LLM **compiles** the sources once and for all into an interlinked wiki, then maintains it. This is not RAG: raw material is not searched again at every question.

Three layers:
- **raw**: the sources, immutable;
- **wiki**: the pages written by the LLM;
- **schema**: the built-in `src/schema.md`, written to `CLAUDE.md` or `AGENTS.md`, which sets the conventions and the workflows.

Three operations:
- **ingest**: one source can touch 5 to 15 pages;
- **query**: a good answer is filed in the wiki;
- **lint**: contradictions, orphans, gaps, stale claims.

`index.md` serves as the catalog and `log.md` as the journal.

### OKF v0.2 (subset kept)

Follow **SPEC v0.2**. The Google blog post describes v0.1, where `timestamp` became `generated.at` and `# Citations` became `sources`.

**What we keep:**
- `type` is the only required field. The recommended fields are `title`, `description` and `tags`.
- `sources[]` (`id`, `resource`, `title`), with `[^id]` footnotes that attribute each claim to its source.
- `generated: {by, at}`, with the actor convention `human:franck`, `claude-code/opus-5.5` and `cortex-cli/0.1`.
- `verified` when a page has been reviewed (with `human:franck`).
- `status` (`draft`, `stable` or `deprecated`) and, optionally, `stale_after`.
- Root-relative Markdown links (`/wiki/concepts/x.md`). A broken link is tolerated: it flags knowledge not yet written.
- `index.md` and `log.md` are reserved names.

**What we ignore:** Attested Computations (§10), `usage_count` and `usage_window`, and the BigQuery/Knowledge Catalog layer.

The benefit: the wiki stays readable by Obsidian, by the OKF viewer and by any agent, with no SDK.

## 3. Guiding principle

**The CLI does the deterministic work, the LLM does the judgment. The CLI never writes a wiki page.**

| `cortex` CLI | Agent (Claude Code / opencode / codex) |
|---|---|
| fetch, extraction to Markdown, hash and dedup, writing to `raw/` | decide what a source contributes |
| search index (SQLite FTS5), `search` | create and update pages, link them, flag contradictions |
| generate `wiki/index.md` from the frontmatters, generate `log.md` from `log.jsonl` (`cortex log add` validates and appends an entry) | answer questions with citations, file the answers |
| structural `lint` | resolve what lint reports (merge, deprecate, create) |
| MCP server | describe images, summarize transcripts |

**By default, the CLI embeds no LLM SDK.** The agent is a session of your existing harness, with the schema (`CLAUDE.md` or `AGENTS.md`) as instructions and `cortex` as a tool.

**The CLI does not provide the agents.** `claude`, `codex` or `opencode` must already be installed and authenticated on the machine. `cortex` drives them. It never bundles or installs them.

**SDKs are optional and loaded on demand** when `cortex.json` names a client. They only serve to make better use of the agent, first of all to block writes outside `wiki/` before they happen. In the code, this is a Bridge pattern:
- **the abstraction** is the `compile` and `ask` commands (`agent.ts`), which only know the `Backend` interface (`interactive`, `run`);
- **the implementations** are in `src/backends/`: `default.ts` (agnostic, subprocess), `claude.ts`, `codex.ts` and `opencode.ts`.

Guardrails verified on 2026-11-04 by trials where the agent tried to write to `raw/`:

| Client | Mechanism | Result |
|---|---|---|
| Default (agnostic, any CLI) | repository read-only except `wiki/`: bubblewrap on Linux, `sandbox-exec` on macOS | `raw/` gives “EROFS: read-only file system”, `wiki/` is writable |
| Claude (Agent SDK) | `canUseTool` on every tool call, `settingSources: []` (a settings `permissions.allow` rule or hook would run before `canUseTool`; the schema is passed through `systemPrompt`), nothing approved by default | writes and shell outside `wiki/` denied; `Read`/`Glob`/`Grep`/`LS` confined to the repository |
| Codex (SDK) | `workspace-write` sandbox launched from `wiki/` | `raw/` and the agent file give “Read-only file system” (`/tmp` always remains writable) |
| opencode v2 (REST API of `opencode serve`) | permission rules, the last matching rule wins | `edit` denied outside `wiki/*`, shell denied outside `cortex` |

Interactive sessions, whatever the client, also go through this confinement: a human approving too quickly cannot write outside `wiki/`. In every case, `git status` before and after the agent remains the common safety net.

**Residual risk: reads.** Only the Claude SDK backend confines reads (its `guard` refuses any path outside the repository, symlinks resolved). Interactive sessions and the agnostic mode (bubblewrap) cannot: a read-only mount of the whole filesystem is what lets the agent's own binary and state work, and the Codex and opencode sandboxes likewise leave reads open. Raw sources are untrusted web content, so a prompt-injected source could make the agent copy a local secret into a wiki page, and `cortex export` would then publish it. The exfiltration path is therefore *through the wiki*: review the pages (`git diff`) before committing or exporting.

*Prerequisites:* `bwrap` on Linux (`apt install bubblewrap`). On macOS, `sandbox-exec` is built into the system. The macOS variant has not yet been tested on a real machine.

## 4. Directory layout

```
cortex/
├── cortex.json        # configuration; marks the wiki root
├── CLAUDE.md          # schema written by `cortex config init` (AGENTS.md for Codex and opencode)
├── raw/              # immutable, written by the CLI (or by hand at step 0)
│   └── 2026/11/<uuid>/
│       ├── source.md # extraction + frontmatter
│       └── assets/   # images ≤ ~500 KB
├── wiki/             # written by the agent
│   ├── index.md      # GENERATED (never written by the agent once the CLI is available)
│   ├── log.jsonl     # append-only journal, SOURCE OF TRUTH (one JSON entry per line), written by `cortex log add`
│   ├── log.md        # GENERATED from log.jsonl (readable in Obsidian, OKF-reserved)
│   ├── sources/      # type: Source — one summary page per raw source
│   ├── concepts/     # type: Concept
│   ├── entities/     # type: Entity (people, tools, projects, organizations)
│   └── syntheses/    # type: Synthesis — filed answers, comparisons
├── inbox/            # synced drop zone (mobile), emptied by `cortex inbox`
└── .cortex/           # gitignored: index.sqlite, blobs/<sha256>, cache
```

**Binaries:** PDFs, videos, audio files and DOCX go to `.cortex/blobs/` (content-addressed, **outside git**) and are referenced by `blob:`. For a video, the file is never kept, only the transcript and a thumbnail. The knowledge is in the Markdown. The original is only a convenience.

**Dotfiles are invisible.** Every scan of `wiki/` and `raw/` goes through `Bun.Glob`, which skips dotfiles and does not follow symlinked directories. A `wiki/.drafts/` folder (or any `.hidden.md`) is therefore ignored by every command: `index`, `search`, `lint`, `export`, `mcp`. That is a handy place for scratch notes, and a trap if a page is expected to be listed.

## 5. Formats

The format of `raw/.../source.md` and that of the wiki pages are defined in the agent schema ([`src/schema.md`](../src/schema.md)), which is authoritative.

**Built-in schema** (decision of 2026-11-04, replaces a hand-kept `CORTEX.md` at the wiki root). The schema ships with the CLI, in English, so it evolves with the commands it describes. `cortex config init [client]` creates `cortex.json` and writes the schema where the client loads it by itself: `CLAUDE.md` (Claude, or no client: `$CORTEX_AGENT` defaults to `claude`), `AGENTS.md` (Codex, opencode); an existing file is kept. `cortex schema [--write]` prints or rewrites it, after a CLI update or a change of client. `cortex.json` can set `language` (fills `{{language}}`, default English: the wiki language is a setting, not a fork of the schema) and `schema` (a Markdown file, relative to the root, replacing the built-in one). The agent prompts name the agent file (`Apply the INGEST workflow of CLAUDE.md…`). `cortex.json` (formerly `config.json`) now marks the root: a `CLAUDE.md` or `AGENTS.md` could not, since many code repositories have one. `findRoot` walks up to it, or uses `$CORTEX_ROOT`. It is versioned with the wiki, since it carries the naming.

**Identifiers: UUID v7**, for raw sources (`raw/YYYY/MM/<uuid>/source.md`, month of addition) as well as for wiki pages (`wiki/<type>/<uuid>.md`). Decision of 2026-11-04, which replaces `YYYYMMDD-<4 characters>-<slug>` and readable slugs: uniqueness is guaranteed without depending on the title (two sources with the same title on the same day, a renamed page), at the cost of unreadable file names. Timestamped then random (74 bits), a UUID v7 sorts in creation order; `Bun.randomUUIDv7()`, no dependency. Neither the agent nor the human writes one: `cortex add` names a source, `cortex new <type> "<title>"` creates a page (refused if the title already exists: update before creating). A page is found by its title (index, search); the journal (`log.md`) names it by its title. The path of a raw source is found from its id (`rawPath`, a search for `raw/*/*/<id>/`), never by splitting the id. A link to a page yet to be written is no longer possible: the stub is created first (`cortex new`, as `draft`).

**Configurable naming** (same day): `raw_path` and `page_path` in `cortex.json` (validated by a zod schema, like the whole config) compose paths and names from placeholders (`{uuid}`, date and time, `{slug}`, `{rand}`, `{kind}`, `{type}`); UUID v7 remains the default. The last segment of `raw_path` is the raw id, unique under `raw/` (the journal cites only that). A collision gets `-2`, `-3`… Lint compares each path to the pattern derived from the template (warning: changing the template renames nothing) and rejects two identical raw ids. `naming.ts`.

**Time zone and naming.** `{yyyy}`, `{mm}`, `{dd}`, `{hh}`, `{mi}` and `{ss}` are the **local** time of the machine that runs `cortex add` / `cortex new` (like `fetched_at`). The default `raw_path` `{yyyy}/{mm}/{uuid}` therefore depends on `TZ`: a wiki synced between machines in different time zones files two sources added at the same instant, around midnight on the last day of a month, under two different months. The raw id (the UUID) is the same either way, so nothing breaks; only the folder differs. Nothing else in the generated files depends on `TZ` or `LANG`: `wiki/index.md` is sorted by one French collator (`text.ts`), and `wiki/log.md` groups entries by the date written in the entry (`determinism.test.ts` spawns `cortex index` under opposite settings and compares the bytes).

## 6. `cortex` CLI

**The MVP commands come first.** The others arrive when the need is felt.

| Command | Step | Role |
|---|---|---|
| `cortex add <url\|file\|-> --note "…"` | 1 | extracts, deduplicates (hash of the normalized content + canonical URL), writes to `raw/`, indexes, appends to the journal. Idempotent. |
| `cortex search "<q>" [--in wiki\|raw] [--json]` | 1 | BM25 FTS5, wiki first |
| `cortex index` | 1 | regenerates `wiki/index.md` from the frontmatters, and `wiki/log.md` from `wiki/log.jsonl` |
| `cortex lint [--json]` | 2 | frontmatter (`type`, `description`), broken links, orphans, `pending` raw sources, `stale_after` exceeded, probable duplicates, pages modified since their review (`generated.at` > `verified.at`) |
| `cortex compile [id…\|--pending] [--batch]` | 2 | launches the configured agent, **one session per source**: interactive by default (the client's CLI, or `$CORTEX_AGENT`), or `--batch` (the configured client's SDK, otherwise `$CORTEX_AGENT_BATCH`, `claude -p` by default), which writes as `draft` with no prior validation. Refuses an empty `note`. Sets `compiled` only if a Source page cites the source (line replaced, without re-serializing the YAML). Flags any modification outside `wiki/` (via `git status`). Regenerates the index. Runs the ingest, then sets the status to `compiled` |
| `cortex ask "<q>" [--file]` | 2 | same mechanism with the query workflow, **read-only**. `--file` allows writing a synthesis as `draft` |
| `cortex config init\|lint\|get\|set\|remove` | 2 | skeleton of `cortex.json` (keys `client`, `model`, `effort` set to `null`), check, and validated reading and writing of properties. The effort is translated for each client: `effort` (Claude), `modelReasoningEffort` (Codex), model variant (opencode, `model#variant` on the CLI) |
| `cortex log [--limit N] [--json] [--kind k]`, `cortex log add <kind> "<text>" [--source <id>]… [--page <path>]…` | — | the journal. `wiki/log.jsonl` is the source of truth (append-only, one line `{"at", "kind": add\|ingest\|query\|lint\|update, "text", "sources"?, "pages"?}`); `wiki/log.md` is generated from it (same rendering as the old journal, plus a “generated, do not edit” line), like `index.md`. `cortex log add` validates the `kind`, the page paths (existing, under `wiki/`, excluding `index.md` and `log.md`) and the raw ids (existing), writes the line with a single `append`, then regenerates `log.md`; `cortex add` writes the `add` entry itself. `cortex log` reads (last 20 entries by default). Agents never write the journal by hand: `cortex log add` is allowed wherever `cortex index` is (Claude guard, opencode rules, `--allowedTools` of the default engine; Codex writes under `wiki/`, so it has it by default), and `cortex log` read-only (Claude guard, opencode). `cortex lint`: error on an invalid line, warning if `log.md` differs from its generation |
| `cortex mcp` | 3 | stdio MCP server, which never modifies `wiki/`. Read: `search`, `get` (a `.md` under `wiki/` or `raw/`, paths resolved by `realpath`), `related` (outgoing and incoming links 3, shared raw source 2, shared tag 1), `lint`, `log` (structured entries of the last N days, 1 by default, optional `kind` filter). Write: `add` only, into `raw/` (URL or `text`, never a local file of the machine, `note` required, idempotent). Root set by `$CORTEX_ROOT`. |
| `cortex inbox [--dry-run]` | 4 | `add` on the whole content of `inbox/`. `urls.txt`: one entry per line, `<url> [free note…]` (the rest of the line is the `note`), blank lines and `#` lines ignored and kept. Any other visible file (PDF, `.md`, `.txt`) goes through `add`, with the content of `<name>.note` as its note if it exists. **A successful entry (added or already present) leaves the inbox** (line removed, file and `.note` deleted); a failure stays there, and the exit code is 1. `urls.txt` is rewritten through a temporary file then `rename`, after re-reading. `--dry-run` writes nothing and empties nothing. Without a `note`, the `cortex add` warning is shown and `compile` will refuse the source as long as it is missing |
| `cortex export [--out <folder>]` | 6 (done) | the wiki as an interactive HTML site (see §10 bis): navigation, instant search, link graph. Default output `.cortex/site`, **emptied at every export** (refused if it is the root, `wiki/`, `raw/`, the CLI folder, the HOME or one of their parents, or if the folder exists, is not empty and contains no `_app/`: it does not look like a previous export). SvelteKit `adapter-static` + shadcn-svelte, bundled in the CLI (`site/`), nothing more to install |
| `cortex ls [--type T] [--json]`, `show <path\|raw id\|title>`, `related <path\|title> [--limit N] [--json]`, `doctor` | on demand (done) | `ls` lists the pages by title; `show` prints a page or a raw source (same confinement as MCP `get`); `related` is the MCP tool on the command line; `doctor` reports the missing system tools (exit 0). `src/extras.ts`. No `reextract`: `raw/` is immutable. |

**Detecting truncated extractions in `cortex add`.** Lesson from step 0: defuddle cut Google's OKF article in the middle (841 words instead of 1,577), with no error or warning. `cortex add` must compare the number of extracted words with that of the visible text of the page. Below a threshold (to be calibrated, for example 70%), it retries with Readability + Turndown, keeps the longer result, and marks `partial: true` if both extractions stay short. A paywall and a Cloudflare block (empty body) produce an explicit refusal.

**Heuristic adopted at step 1** (calibrated on the 21 sources of step 0). The comparison with the visible text of the page was dropped: Next's navigation and “related articles” blocks skew it. `cortex add` runs **defuddle and Readability + Turndown every time** and keeps Readability if its text is **more than 1.3 times longer**. Only OKF switches, and no other source loses content. `partial:` is set on **verified paywall markers** in the HTML: “Il reste N % de l'article” (“N% of the article remains”) for Next, “This post is for paid subscribers” for Substack. They find exactly the 3 partial sources. An HTTP error status or a body of fewer than 50 words is refused. *Known limit:* a page shell served with a 200 status (a Medium header with no article, for example) passes this threshold. The review at compile time catches it.

The SQLite index is a **rebuildable cache**, never a source of truth.

## 7. Extraction

We compose existing tools, without seeking a native universal extractor. Each extractor produces a normalized `source.md` and records its name in `extractor:`, so that the source can be re-extracted later.

| Source | Method |
|---|---|
| Text, Markdown, note | direct read |
| Web page | fetch + Readability + HTML→Markdown, canonical URL, OpenGraph metadata, images downloaded locally |
| Text PDF | `pdftotext` (poppler) |
| DOCX, PPTX, ODT | `pandoc` |
| Image | stored as is; **the agent describes it** at compile time, using its vision. Local OCR with `tesseract.js` as an option. |
| Video, podcast | `yt-dlp` (subtitles first), otherwise audio → `ffmpeg` → Whisper via `@huggingface/transformers` |
| Scanned PDF | agent vision |

If an external tool is missing, the CLI prints a clear message.

## 8. Search (no RAG)

1. **Progressive disclosure**: the agent reads `wiki/index.md`, chooses the pages and reads them in full. The retrieval unit is **the compiled page**, never a chunk.
2. **FTS5 BM25** for precise terms, on `wiki/` then `raw/`. A result found only in `raw/` flags a gap to compile.
3. **Graph**: links, tags and shared sources.
4. **Embeddings** (`sqlite-vec` + multilingual model, RRF fusion) only if recall degrades measurably. Field experience: grep + reading remain reliable under 50 to 100K tokens of wiki.

## 9. CLI language: Bun

> **Decision (2026-11-04): Bun (TypeScript).** It will not be reopened. The contract is the file format.

The CLI is mostly **glue**: HTTP fetch, HTML extraction, SQLite, YAML, calls to external tools, MCP. Performance does not matter at the scale of a few thousand files.

| Criterion | Bun (TypeScript) | Rust |
|---|---|---|
| Web extraction | `@mozilla/readability`, the reference implementation, + `turndown` | ports of Readability, less proven |
| SQLite FTS5 | built-in `bun:sqlite` | `rusqlite` (bundled), solid |
| MCP | official TypeScript SDK | `rmcp`, younger |
| Single binary | `bun build --compile` (~50-90 MB) | native, small |
| Robustness, typing | adequate | excellent |
| Speed to reach the MVP | high | slower |

**Choice: Bun**, for the speed of reaching the MVP and the ecosystem (Readability, official MCP SDK, `bun:sqlite`).

The risk is not the language, it is **changing language** (cf. v1). We choose once and do not go back. The contract is the file format, not the code: the CLI can be rewritten without touching the wiki.

**I/O rule.** Small metadata reads (existence checks, `cortex.json`, the journal, one page) use synchronous `node:fs`: simpler stack traces, no accidental concurrency. Bulk or specialised work goes through `Bun.*`: `Bun.file`/`Bun.write` for file contents, `Bun.CryptoHasher` for hashing, `Bun.YAML` for frontmatter, `Bun.Glob` for scans, `Bun.spawn` for external commands. `node:fs/promises` is kept only where Bun has no equivalent (`rename`, `appendFile`, exclusive-create writes).

### Module layout

`src/cortex.ts` parses the arguments and dispatches; commands are functions of a root (or of a `Wiki` context) that return data or a `Result`, and report progress through `print.ts` rather than printing. The modules, from the bottom up:

| Module | Role |
|---|---|
| `limits.ts` | Every tunable threshold (word counts, timeouts, display caps), with its calibration. A magic number belongs here. |
| `text.ts` | The one collator (French rules) used to sort titles everywhere, whatever the runtime locale. |
| `paths.ts` | `realPath` and `isUnder`: symlink-aware containment checks, shared by the guards, `log add --page`, `get` and the export. |
| `template.ts` | Pure part of the naming: placeholders, template validation, `expand`, the pattern lint matches. Imports no config, so `config.ts` and `naming.ts` can both use it. |
| `config.ts` | `cortex.json`: the zod schema (`CONFIG_KEYS` is the one list of keys), clients, effort vocabularies, reading, linting. |
| `doc.ts` | Domain types of the file format (`Page`, `RawSource`) and the conversions between the spellings of an identity (path, resource, route). Pure: no I/O. |
| `lib.ts` | Reading and writing frontmatter and documents, `readDocs` / `readPages`, links and `related`. |
| `context.ts` | `openWiki(root)`: what one command knows about the wiki (config, pages, raw, journal, link graph), each read at most once, on first use. A snapshot. |
| `catalog.ts` | Renders `wiki/index.md` from the frontmatters. |
| `print.ts` | `Result`, `Report` and `collector`: what domain code returns or says instead of printing. |
| `prompts.ts` + `prompts.md` | The orchestration prompts (compile, ask, MCP instructions), shipped next to `schema.md`. |
| `backends/policy.ts` | What an agent may run, as one table, rendered in each backend's dialect (`--allowedTools`, Claude regexes, opencode rules). |
| `backends/sandbox.ts` | `confine`: bubblewrap on Linux, `sandbox-exec` on macOS. |
| `backends/*.ts` | One adapter per client (`default`, `claude`, `codex`, `opencode`) behind the `Backend` interface of `backend.ts`. |

Tests live next to the module they cover (`<module>.test.ts`); fixtures shared by several files are in `test-helpers.ts`. Test names are in English; assertions on CLI output stay in French.

### Distribution: one binary, `cortex upgrade`

A tag `v<version>` (matching `package.json`) runs `.github/workflows/release.yml`: `scripts/build.sh` compiles one binary per platform on that platform (Linux x64, macOS arm64), checks that `cortex export` works from the binary alone, then publishes the binaries, `SHA256SUMS` and `SHA256SUMS.sig` as a GitHub release. The signature is Ed25519 (`scripts/sign.ts`, private key in the `CORTEX_SIGNING_KEY` secret, public key `RELEASE_PUBLIC_KEY` built into the binary): a release altered by someone without the key, `SHA256SUMS` included, is refused. `cortex upgrade [--check]` compares the installed version with the latest release, downloads the asset of the platform, checks the signature of `SHA256SUMS` and then the SHA-256 of the binary, and replaces the binary in place; run from the sources, it only says to `git pull && bun install`.

**Export from the binary.** Vite cannot run inside a compiled binary (optional imports it cannot resolve, per-platform native bindings, SvelteKit reloading `vite.config.ts` from disk). The binary (~93 MB) therefore embeds a ~200 KB tarball of `src/`, `site/`, `package.json` and `bun.lock` (`src/bin.ts`, `src/payload.ts`). The first `cortex export` of a build extracts it to `~/.cache/cortex/<version>-<hash>/`, runs `bun install --frozen-lockfile --production` there with the bun the binary embeds (`BUN_BE_BUN=1`; network needed once, ~165 MB), deletes the folders of earlier builds, then reruns itself as `bun` on those sources. `schema.md` and `prompts.md` are imported as text, so the other commands need no file on disk. *Known gap:* the service worker lists `site/static` in filesystem order, so an export is byte-identical on one machine but not always across machines.

### Known limits

- **`wiki/log.md` can be stale after concurrent writers.** `appendLog` is one `O_APPEND` write, so `wiki/log.jsonl` (the source of truth) never loses a line. `writeLogMd`, though, regenerates `log.md` from a read that may predate another process's append (for example `cortex mcp add` and `cortex log add` at the same moment): the last writer wins and `log.md` can miss an entry. `cortex lint` reports it (`log.md` differs from the journal) and `cortex index` repairs it. Accepted: no lock.
- **`cortex inbox` rewrites `urls.txt` without a lock.** It re-reads the file just before writing through `tmp` + `rename`, but a sync client that writes between the re-read and the rename loses its line. Accepted, as a lock file would be over-engineering for a mobile share target; the `ponytail:` comment in `inbox.ts` keeps the decision visible.

### Dependencies

Exploration of 2026-11-04 on Bun 1.4.3. The documentation was checked via Context7, and each building block was run on real cases.

**Runtime — core (6)**

| Package | Version | Role | Why this one |
|---|---|---|---|
| `defuddle` | `0.19.6` (pinned exactly, since 0.x) | web page → Markdown, plus metadata (title, author, publication date, image, schema.org) | Engine of Obsidian Web Clipper (kepano), ~9.9k ★, weekly releases. Main extractor. |
| `linkedom` | `^0.18` | server-side DOM for defuddle | Lightweight, very active. `jsdom` remains compatible as a fallback. |
| `@mozilla/readability` + `turndown` | `^0.6` / `^7` | fallback when defuddle truncates | Firefox's reference implementation. Moved from plan B to the core at step 0: defuddle truncated the OKF article without warning (see §6). |
| `@modelcontextprotocol/server` | `^2.4` | `cortex mcp` (`serveStdio`) | Official v2 SDK, which depends only on `zod` and `core` (v1 `@modelcontextprotocol/sdk` pulled in express, hono, cors, ajv…). Verified at step 3 (v2.4.0, Context7): `McpServer` from `@modelcontextprotocol/server`, `serveStdio` from the subpath `@modelcontextprotocol/server/stdio` (not the root), `registerTool(name, { description, inputSchema: z.object({…}) }, handler)`. |
| `zod` | `^4` | input schemas of the MCP tools (`import * as z from "zod/v4"`) | Required by the MCP SDK |

**Runtime — optional, loaded on demand (`await import()`) (2)**

| Package | Version | Role | Cost |
|---|---|---|---|
| `@huggingface/transformers` | `^4.3` | Whisper transcription (ONNX), **replaces `whisper.cpp`** | ~580 MB in `node_modules` (`onnxruntime-node`/`web`) + model downloaded on first use (whisper-small q8 = 241 MB, see below). |
| `tesseract.js` | `^7` | local OCR in WASM, **replaces `tesseract`** | ~44 MB + language model (`fra`). Test: 0.4 s, exact French text. |

These two packages are listed in `optionalDependencies` and loaded only by the audio and image extractors. The core stays light.

**Runtime — agent SDKs, loaded only if `cortex.json` names the client (2)**

| Package | Version | Role | Cost |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `^0.3.318` | `"client": "claude"` | 5 MB, plus its peers `@anthropic-ai/sdk` (25 MB) and `@modelcontextprotocol/sdk` (6 MB). Works with the Claude subscription. |
| `@openai/codex-sdk` | `^0.166.0` | `"client": "codex"` | 100 KB. Reuses the `codex login` connection. |

These SDKs are only thin layers that drive the agent's CLI. They pull in, as optional dependencies, one binary per platform: ~630 MB for Claude (glibc + musl), ~440 MB for Codex. The CLI spares you this: it installs with `bun install --omit optional` and points the SDKs to the CLIs already installed (`pathToClaudeCodeExecutable`, `codexPathOverride`). Result: `node_modules` weighs ~97 MB (~220 MB since the HTML export) instead of ~1.2 GB. In return, the installed CLI (`claude`, `codex`) must stay on a version compatible with the SDK.

opencode has no SDK: the only one published, `@opencode-ai/sdk` 1.19.5, does not speak the opencode v2 API (`/api/…` routes, Basic authentication, new permission format). `opencode.ts` calls the REST API of `opencode serve` directly. Default model: `opencode/big-pickle`.

*To revisit at step 5 (the HTML export already had to move its native bindings out of `optionalDependencies`, see below):* `--omit optional` will also drop `@huggingface/transformers` and `tesseract.js`. They will then have to become normal dependencies loaded on demand, or be installed explicitly.

**Points to watch:**
- `onnxruntime-node` is a native addon, so it does not fit in a `bun build --compile` binary. Transcription is only available in a `cortex` installed via `bun install`.
- Local OCR is only a fallback: the agent's vision does better (description + text).
- **Whisper model chosen: `onnx-community/whisper-small` (q8, 241 MB), with `language: "french"`.**
  - Test on 60 s of French LibriVox reading: full text, correct punctuation, a few proper names mangled.
  - Speed: 20 s per minute of audio, i.e. ~3× real time (a 1 h podcast ≈ 20 min).
  - `whisper-base` (9 s/min) **skips an entire passage** and distorts many words.
  - `whisper-large-v3-turbo` (1.1 GB, 32 s/min) **also loses a passage** and all the punctuation in q8: it is not worth its cost.

**Runtime — HTML export (`cortex export`), normal dependencies loaded on demand (`await import("vite")`) (10)**

Added at step 6, documentation checked via Context7 and last-publication dates read from the npm registry on 2026-11-04. Rule adopted: only maintained libraries (version published in the last ~3 months).

| Package | Version | Published | Role | Why this one |
|---|---|---|---|---|
| `vite` | `8.3.5` (exact, see below) | 2026-10-21 | builds the site through its API (`createBuilder().buildApp()`) | required by SvelteKit 3 |
| `@sveltejs/kit` | `^3.1.1` | 2026-10-29 | routing, prerendering, static HTML pages | native prerendering (see §10 bis) |
| `@sveltejs/adapter-static` | `^4.0.1` | 2026-10-29 | writes the prerendered site to `--out` | official static-site adapter |
| `svelte` | `^5.57.3` | 2026-10-26 | components (runes) | required by SvelteKit and shadcn-svelte |
| `tailwindcss` + `@tailwindcss/vite` | `4.3.4` (exact) | 2026-11-02 | styles | required by shadcn-svelte |
| `tailwind-variants` + `tailwind-merge` | `^4.0.1` / `^3.7.0` | 2026-10-31 / 2026-09-12 | variants and class merging for the copied shadcn-svelte components | shadcn-svelte's `cn`, without `clsx` (not needed: `twMerge` already accepts arrays and falsy values) |
| `force-graph` | `^1.52.0` | 2026-09-28 | graph (canvas, d3-force), loaded only in the browser | see §10 bis |
| `fuse.js` | `^7.5.0` | 2026-07-13 | full-text search in the browser: fuzzy, ranked, with highlighting; index precomputed at export (`Fuse.createIndex` → JSON, `Fuse.parseIndex` in the browser) | zero dependencies, ~450 KB installed, ~25 KB in the browser. Rejected because frozen for more than 3 months: `minisearch` (2025-09), `@orama/orama` (2025-12), `flexsearch` (2025-09). Rejected: Pagefind (Rust binary per platform in `optionalDependencies`, no autocompletion) |

**Native bindings of Vite 8 and Tailwind 4, to pin (6).** Vite 8 (rolldown), `@tailwindcss/oxide` and `lightningcss` ship their binary in per-platform `optionalDependencies`, which `bun install --omit optional` drops: `import("vite")` then fails (“Cannot find native binding”). They are therefore declared as **normal dependencies**, at the exact versions of their parent: `@rolldown/binding-*` `1.2.16` (published 2026-10-29), `@tailwindcss/oxide-*` `4.3.4` (2026-11-02), `lightningcss-*` `1.33.0` (2026-07-20: a little over 3 months, outside the rule, but it is the latest published version and the one Tailwind requires), for `linux-x64-gnu` and `darwin-arm64`. Bun silently ignores the one that does not match the platform. **To be maintained together with `vite` and `tailwindcss`** (exact versions, no `^`). Other platforms (Linux arm64, Intel macOS, musl, Windows): add the matching binding, otherwise `cortex export` stops with a message that names the platform.

**Markdown rendering: no dependency** (`Bun.markdown.html`, GFM built into Bun; `marked` rejected). `[^id]` footnotes are not handled there: `export.ts` extracts and numbers them itself (about forty lines).

**shadcn-svelte components** copied into `site/` (`button`, `badge`, `input`, `card`), versioned; the `nova` preset adds `tw-animate-css`, `@fontsource-variable/geist`, `shadcn-svelte/tailwind.css`, `bits-ui` and `@lucide/svelte`, which are not used here and therefore not installed (animations, font and icons are unnecessary; `tw-animate-css` dates from 2025-09).

**Dev (2):** `@types/bun`, `@types/turndown`.

**Built into Bun, so no dependency:**

| Need | Bun building block |
|---|---|
| BM25 index | `bun:sqlite` (FTS5 + `bm25()`) |
| YAML frontmatter | `Bun.YAML.parse` / `stringify` |
| CLI argument parsing | `node:util` `parseArgs` |
| sha256 | `Bun.CryptoHasher` |
| file traversal | `Bun.Glob` |
| HTTP | `fetch` |
| external tools | `Bun.spawn` |
| tests | `bun test` |
| binary | `bun build --compile` |

Rejected: `commander`/`citty`, `yaml`/`gray-matter`, `better-sqlite3`, `vitest`, `nodejs-whisper`/`smart-whisper` (they compile whisper.cpp), and the v1 MCP SDK.

**System tools, called via `Bun.spawn`:** `ffmpeg` (audio decoding, also required by yt-dlp), `yt-dlp`, `pdftotext` (poppler) and `pandoc`. All are available in the standard package managers. `cortex doctor` reports the missing ones.

## 10. Roadmap

- **Step 0 — zero code (1 week).** Set up the directory layout and `CORTEX.md`, migrate the 7 v1 notes as the first sources, ingest 5 real sources **on varied topics** and ask 5 questions. *Pass criterion:* you come back to consult the wiki on your own.
- **Step 1.** `add` (URL, text, Markdown, text PDF), `search`, `index`. *Criterion:* 20 sources ingested and `search` actually used.
- **Step 2.** `lint`, `compile`, `ask`.
- **Step 3.** `mcp` (done).
- **Step 4.** `inbox` (done), with a mobile “Share → `inbox/urls.txt`” shortcut: the phone's “Share” action appends `<url>` to the end of `inbox/urls.txt`, in the synced folder. The content of `inbox/` is not versioned (`.gitignore`): syncing happens outside git, with Syncthing or an equivalent, at the human's choice; the CLI only reads the folder. A later `cortex inbox` ingests then empties.
- **Step 5.** Images, then video and audio.
- **Step 6 (done).** `export`: the wiki as an interactive HTML site, with an Obsidian-style link graph (see §10 bis).
- **Step 7, only if needed.** Embeddings.

## 10 bis. HTML export

**Goal:** browse the wiki from a browser, with no Obsidian and no agent.

**`cortex export` produces a dynamic, interactive HTML site**: everything runs in the browser (JavaScript), with no application server, so any file server is enough. It is a deterministic step, with no LLM, like `index` and `lint`.
- **One HTML page per wiki page.** The Markdown is rendered; `/wiki/…` links become relative links to the HTML pages; footnotes point to the sources.
- **The index, the tags and the journal** become navigation pages, generated from the frontmatters, like `wiki/index.md`.
- **“Copier le Markdown” button** (“Copy the Markdown”) on every page: the page source, frontmatter included. Since `raw/` is not published, each `/raw/…` path there becomes the source's original URL, or disappears if it has none.
- **Each page shows its OKF metadata**: type, status (`draft`, `stable`, `deprecated`), reviewed or not, sources, and its incoming links (backlinks).
- **An interactive graph page**, in the manner of Obsidian's graph view. Nodes are pages, colored by type; edges are Markdown links. You can zoom, pan, filter by type or tag, and open a page by clicking its node. The graph data is a JSON file produced at export.
- **A full-text search in the browser**, on a JSON index produced at export.
- **`raw/` is not published.** Sources point to their original URL. The site contains only the wiki, which the human has reviewed or can review.
- **The site works offline.** Everything is bundled by Vite, with no CDN, and a service worker caches the whole site after the first visit (see “Offline” below).

**Stack: SvelteKit (`adapter-static`, on Vite) and shadcn-svelte.**
- **Why SvelteKit rather than React + Vite:** prerendering is native. Each page becomes an HTML file at build time, then hydrates for client-side navigation, the graph and the search. React + Vite would need an extra SSG tool (`vite-react-ssg` or equivalent). Svelte bundles are also lighter.
- **shadcn-svelte** is the community port of shadcn/ui for Svelte (Bits UI + Tailwind CSS). Like shadcn, it copies the components into the project instead of importing them from a package. Installation: `bun x sv create --add tailwindcss`, then `bun x shadcn-svelte@latest init`. Only the components in use are added.
- **Vite and SvelteKit are bundled in the CLI**, the user has nothing to install for the export. Vite, SvelteKit, Svelte, Tailwind and `force-graph` are normal dependencies in `package.json`, installed by the same `bun install`. They do **not** go in `optionalDependencies`, which the recommended install (`--omit optional`) would drop.
- **The application lives in `site/`.** The shadcn-svelte components are copied there once, during development: the user never runs `shadcn-svelte`.
- **`cortex export`** writes the data (rendered pages, OKF metadata, `graph.json`, search index), then calls Vite through its API (`createBuilder(…).buildApp()`, without the `vite` command; see the deviations below) on `site/`, which prerenders every page into `--out`. The CLI remains the only one to read the wiki; the site only displays this data.
- **Loaded on demand** (`await import()`): `add`, `search`, `compile`… never load Vite and stay just as fast.
- **Graph: `force-graph`** (vasturiano), in a Svelte component. Canvas 2D rendering and d3-force physics: animated out of the box (node placement, drag, zoom, neighbors highlighted on hover, particles on links), as close as possible to Obsidian's graph view with the least code. The interface around it (filters by type and tag, search, page preview) is in shadcn-svelte. *Limit:* it slows down beyond a few thousand nodes; if the wiki gets there, switch to sigma.js + graphology (WebGL). Rejected: 3d-force-graph (Three.js, heavier, harder to navigate).
- **Cost:** a few tens of MB more in `node_modules` (to be measured at step 6) and a few seconds of build time per export.

**Delivered at step 6: measurements and deviations from the spec.**

- **Measurements (47 pages, 81 edges, Linux x64, Bun 1.4.3).** Full export in **~2.2 s**. Site of 3.2 MB (the graph JS loads only on `/graph/`). Search index 172 KB (~62 KB compressed), search in 4 to 15 ms. `node_modules`: **106 MB → 222 MB (+116 MB)**, which is more than the “few tens of MB” planned: Vite's native bindings (`@rolldown`, 21 MB) and lightningcss's (10 MB), `force-graph` and its d3 packages (6.5 MB), Svelte and SvelteKit (7.4 MB). The other commands load none of this (`cortex search`: 0.13 s).
- **Data.** `cortex export` reads `wiki/` (never `raw/`, except the `url` field of the frontmatter of each cited source) and writes `.cortex/site-data/` (`data.json`, `graph.json`, `search-index.json`); the site reads them at build time (`CORTEX_SITE_DATA`), and `graph.json` and the index are republished as prerendered endpoints. Nothing is written to `site/` outside `.svelte-kit/` (ignored). To develop the site: `CORTEX_SITE_DATA=<root>/.cortex/site-data bunx --bun vite dev` from `site/`.
- **Deviation: `createBuilder().buildApp()` instead of `build()`.** `build()` builds only one Vite environment: SvelteKit 3 orchestrates client, server, prerendering and adapter in its `buildApp` hook, which only `createBuilder` calls. `build()` ended “successfully” without writing anything.
- **Deviation: SvelteKit 3 and Vite 8** (current versions, newer than those of the documentation consulted beforehand). Configuration goes through `sveltekit({…})` in `site/vite.config.ts` (no more `svelte.config.js`); `$lib` is removed, replaced by `#lib` via the `imports` field of `site/package.json` (the copied shadcn-svelte components were adapted); `tscortex.json` extends `$app/tsconfig`. The CLI does not type-check the site (no `svelte-check`, one more dependency): Svelte compilation errors and prerendering (`handleHttpError: "fail"`) make the export fail.
- **Search: inverted index built at export, Fuse.js for typos only.** The export produces, over **all the text** of each page, an index of folded word (no accents, no case) → pages. In the browser, each typed word is resolved to index words: exact, prefix (typing in progress, binary search in the sorted list) or close (Fuse on the word list, never on the content, and only for a word with no exact or prefix match). Words combine with AND, exact phrases first narrow the candidates through the index and are then verified against the text. Ranking: title 3 > description 1.5 > tags 1 > content 0.4, weighted by quality (exact > prefix > close). The cost of a search depends on the words typed, not on the size of the wiki. Measured on 2026-11-04 (worst query): ~13 ms for the 47 pages, ~12 ms for ~940, ~11 ms for ~2,800 (versus 19, ~290 and ~900 ms when Fuse scanned the content); search index 146 KB for the current wiki. Engine in `site/src/lib/search-engine.ts`, with no SvelteKit dependency, tested by `bun test` (including a 200 ms ceiling on ~3,000 pages, ~10 ms in practice).
- **A single search bar, command-palette style** (header field; ⌘K / Ctrl+K or “/” to jump to it; dropdown ARIA `combobox`, ↑ ↓ Enter Esc) plus a `/search/?q=…` page. Operators combine with AND: `#tag` or `tag:x`, `type:concept|entity|synthesis|source` (plurals and French forms are accepted), `status:draft|stable|deprecated`, `is:fav`, `is:unverified` (never reviewed), `"exact phrase"`, exclusions `-word`, `-#tag`, `-type:source`. Filters are resolved on the metadata (page count shown while typing: `#` or `type:` suggest the existing values), free text by Fuse. Active filters appear as removable chips. The parser is a pure function (`site/src/lib/query.ts`, tested). Autocompletion: filter values, vocabulary terms (prefix of the last word), titles by prefix. The suggested titles go through the same conditions as the results (filters, phrases, exclusions; with no free word, no title). A repeated filter gives a single chip. Each suggested page carries a short excerpt and its states (favorite, draft, to review); the selected title may span two lines and the active option is always scrolled into view. A sticky footer “Tous les résultats pour …” (“All results for …”) gives the exact total; an empty list explains why (“Aucun favori” (“No favorites”), “Aucun résultat” (“No results”), loading, failure to load the index with “Réessayer” (“Retry”)) and offers to reset. On `/search/`, the URL is authoritative (submission from the header, previous and next) and the list grows in slices of 50 (“Afficher davantage”, “Show more”).
- **Actions on the selected result**: `Enter` opens, `⌘/Ctrl+Enter` opens in a new tab, `Alt+F` toggles the favorite, `Alt+C` copies the link (the shortcuts are displayed under the selected line). Global commands (empty field, or matching text): go to the graph, the journal, the favorites, the tags, the home page; change theme (system, dark, light, remembered in `localStorage`). **No “edit the page” action**: the site is generated and read-only, so no edit URL, no reading of the `origin` remote, and no `editUrl` key. This avoids `shadcn` `command` and `dialog` (hence `bits-ui`, `tw-animate-css` and the icons): the copied components shrink to `button`, `badge`, `input`, `card`. shadcn-svelte's `cn` is rewritten without `clsx`, and the preset's font (Geist) is replaced by the system stack: no font file to bundle.
- **Favorites.** Star button on each page and in the palette, a “Favoris” (“Favorites”) section at the top of the home page, the `is:fav` filter, a golden ring on graph nodes. Stored in the browser's `localStorage` (reads and writes inside a `try/catch`): **since the site is static, favorites are specific to each browser** (neither shared nor versioned).
- **Long pages: table of contents and notes.** At export, each heading gets a readable, stable anchor (heading text without accents, suffix `-1`, `-2` in case of duplicates; Bun's slug, which strips accents, is replaced; a slug that would look like an interface id is prefixed with `t-`). `PageData.toc` lists the h2/h3. Beyond 3 headings, the page shows a table of contents: in the side column (sticky) on a large screen, collapsible (`<details>`) above the text on mobile; the current section (last heading scrolled past under the header) is flagged with `aria-current="location"`. The `↩` return of a footnote leads to the call actually followed (remembered on click, per page and per note), otherwise to the first one; a note cited several times also has a return per occurrence (↩ a b c, `Note.refs`). Body limited to 72 characters per line; tables and code blocks scroll horizontally.
- **Navigation and theme.** The header carries “Favoris” (the `is:fav` search) and a System / Light / Dark selector (`theme.set`, same `localStorage` memory and same `data-theme` attribute as the palette command). The active section gets `aria-current="page"` (read from `page.route.id`, valid at prerender time). The home page offers shortcuts (anchors) to the sections by type; `/tags/` has a filter field (insensitive to case and accents).
- **Touch targets.** Under `@media (pointer: coarse)`, the `.touch-target` class (buttons, tags, shortcuts) extends the clickable area to ~44 px with a transparent pseudo-element; the compact look for mouse use is unchanged. The fields and the theme selector go to 44 px high.
- **Journal.** The journal is `wiki/log.jsonl`; `renderLog` (`src/export.ts`) derives structured entries from it (`at`, `kind`, text rendered as inline HTML, cited pages, sources) into `data.json`, and each entry also carries a folded text (`search`) for the local search of `/log/`. The `/log/` page (`site/src/routes/log/`) is a day-by-day timeline (most recent at the top): each entry carries a badge colored by `kind` (`--kind-*` variables, light and dark), the time if known, the text, then links to the cited wiki pages and to the sources. Since `raw/` is not published, a source links to the wiki Source page that cites it, otherwise its id stays as text; an id cited in the text also becomes that link. Filters by `kind` as chips with counters (`aria-pressed`, announcement of the total); without JavaScript, everything is shown. Entries migrated from the old `log.md`: date without time.
- **Reproducible.** Same wiki, same site, byte for byte (tested by exporting twice): the SvelteKit version is the fingerprint of the data (`CORTEX_SITE_VERSION`), `.svelte-kit/` is emptied before each build, and the prerendered HTML has no random identifier.
- **Deviation: native bindings as normal dependencies** (see §9), so that `--omit optional` does not prevent Vite from starting.
- **Offline (initial version, replaced: see “On-demand offline” below).** `site/src/service-worker.ts` (SvelteKit 3's native service worker, no dependency; `$service-worker` no longer exists, so `$app/manifest` and `$app/env` are read) precached the whole prerendered site at install: pages, `__data.json`, `graph.json`, `search-index.json` and the `_app/` resources (233 files for the current wiki). The cache is named `brain-<version>` and the version is the fingerprint of the data (`CORTEX_SITE_VERSION`), not the clock: the service worker stays reproducible byte for byte. Old caches are deleted at activation, and `clients.claim()` lets the page that installs it benefit without a reload. Strategy: cache first for immutable files (`_app/immutable/`, named by fingerprint), network first for everything else (updates are seen online), cache as a fallback (`ignoreSearch`: `/search/?q=…` falls back to `/search/`). Manifest paths are resolved against the service worker's scope, so the site works under a subpath. The indicator (`offline-status.svelte`, `aria-live="polite"`, bottom left) shows “Disponible hors ligne” (“Available offline”) for 6 s, once per site version, when the service worker is active (so its cache is complete), and “Hors ligne” (“Offline”) as long as the browser is. *Measured (47 pages):* 3.0 MB in cache (0.85 MB compressed over the network), of which 1.9 MB for `wiki/` (HTML and `__data.json`, about 40 KB per page). Tested in Chrome: server stopped after installation, home page, a never-visited page, graph and search work, at the root as well as under `/brain/sous/`. *Limits:* (1) `file://` is not targeted: a service worker requires http(s) or localhost. (2) The cache grows with the wiki (~40 KB per page: about 40 MB for 1,000 pages, 120 MB for 3,000); browsers cap storage per origin (often several hundred MB) and may evict a cache that is too full. Beyond that, the remedy: precache only the essentials (`_app/`, home page, `graph.json`, `search-index.json`) and let pages be cached on the fly, or remove the `__data.json` files from the precache (pages then reload as full HTML). (3) A site update installs in the background and takes over only once the tabs are closed.
- **On-demand offline (2026-11-04, replaces the full precache).** Installation precaches only the base: `_app/`, the home page, the lists (`tags/`, `log/`, `graph/`, `search/`), `graph.json` and `search-index.json` (42 files instead of 234). Pages that are visited go into a runtime cache bounded to 120 entries; “Télécharger tout le wiki” (“Download the whole wiki”), in the status panel (permanent button at the bottom left), fetches the rest with an estimate, progress, cancellation and resume. Caches are named `brain-wiki:<scope>:<version>` (and `…:runtime`): at activation, only the old versions of that prefix and that scope are deleted (plus the old `brain-<12 hex>` naming), never the caches of another application on the domain. Keys have no parameters or anchor. With a local copy, the network has 3 s before it is served, and it also replaces a 5xx, 408 or 429 response (404 and 410 pass through as is). The version (`CORTEX_SITE_VERSION`) includes the fingerprint of the frontend sources (`frontendFingerprint()`) in addition to the data: a CSS or component change invalidates the cache. A real 404 page (`routes/+error.svelte`) is also produced as `404.html`; since SvelteKit cannot make a fallback page relative when it is served at an arbitrary address, a subpath hosting is exported with `CORTEX_SITE_BASE=/subpath`. A `<noscript>` explains what requires JavaScript.
- **UI/UX overhaul (2026-11-04, Codex's second review: 86 findings, local unversioned list `REVIEW-UI-UX.md`).**
  - *Theme* “mineral paper, teal ink” (shadcn variables, light and dark), reading body 17 px, metadata 14 px; contrasts checked AA by `src/theme.test.ts` (82 pairs per theme, read from `app.css`). Print styles.
  - *In-house icon pack* (`lib/icons.ts`, `components/icon.svelte`): viewBox 24, stroke 1.75, rounded caps, `currentColor`, no dependency and no emoji.
  - *Search at the center*: home page built around a large field (examples, local recent searches, favorites, then 5 pages per collection and “Voir tout” (“See all”)), clickable facets synchronized with the operators (`is:review`, `is:partial` added), contextual counters, diagnosis of contradictory filters, a single shared query state, a common result row (type, status, review, partial source). A result opens the page with `?q=`: highlighted passages, next / previous, back to the results.
  - *Article*: breadcrumb, in-place citation preview, table of contents with Notes and Sources (floating panel on mobile), “Lire la source originale” (“Read the original source”), deduplicated related pages with their reason shown, accessible scrolling tables, “Voir dans le graphe” (“View in the graph”) (`/graph/?focus=<id>`).
  - *Graph*: shape by type (circle, square, diamond, triangle), node search, list view with the same actions as the mouse, empty / error / loading states, degree recomputed according to the filters.
  - *Journal*: French labels, local search, filters in the URL, slices of 20, stable link per entry, long entries collapsed. *Limit:* the page still receives the whole journal (only the display is bounded).
  - *Security*: the exported HTML is sanitized by an allowlist (`src/sanitize.ts`, no dependency): an LLM writes the wiki from web pages.
  - *Not verified*: real touch, virtual keyboard, screen reader. No browser tests (no Playwright for now): the logic is extracted into pure functions tested by `bun test`.
- **Links and pages.** `wiki/concepts/x.md` becomes `wiki/concepts/x/index.html` (`trailingSlash: "always"`, `paths.relative: true`): the site works behind any file server, subpath included (HTTP crawl on two prefixes: 124 URLs, 635 anchors, 0 dead links). Body links are rewritten as relative; a link to a page that does not exist yet (allowed by CORTEX.md) becomes a `<span class="lien-manquant">`, never a 404; a link to `raw/` is not published. Graph links are directed (`source` = the page that contains the link, `target` = the cited page); a reciprocal pair gives a single link `mutual: true`. Particles follow this direction, in both directions for a reciprocal link.
- **Graph.** Nodes colored by type with a legend (the dots also filter), filters by type and by tag, drag, zoom, gravity toward the center, hover or selection that dims the rest, particles on the highlighted links. Additions from the UI/UX review:
  - **Landmarks from the start.** Labels are drawn after all the nodes, in decreasing degree order, never overlapping (spatial grid, `placeLabels` in `site/src/lib/graph-labels.ts`, tested). The number of labels follows the visible area and grows with zoom (area ÷ 14,000 px², × zoom, cap 150): on a 390 px screen, a dozen at the initial framing; more as you zoom in. Node radius bounded on screen (2.5 to 14 px whatever the zoom; the degree stays readable when zoomed out), link thickness roughly constant. Initial framing with a margin adapted to the width (7%, between 20 and 70 px). The hovered or selected node shows its full title (the others: 28 characters); on hover or selection, only the neighborhood is labeled.
  - **Selection.** A click or a tap selects the page: neighborhood highlighted (ring + links + particles), panel (type, title, description, clickable related pages, “Ouvrir la page” (“Open the page”)), placed at the bottom on a narrow screen (the node it would cover is moved up) and on the right on a large screen. Double-click (400 ms) opens the page; a click on empty space or `Esc` deselects; hovering another node takes precedence as long as the pointer stays on it. The touch area of a node is widened (+12 px, +6 px with a mouse). `graph.json` now carries the `description` of each page.
  - **Controls.** Pause / Reprendre (Pause / Resume) (freezes the simulation and the particles; nodes remain draggable), zoom + / − (×1.5, bounds 0.05 to 12), Recentrer (Recenter). A late framing at the end of the simulation no longer takes over once the user has touched the graph.
  - **Sobriety and reduced motion.** The canvas no longer redraws at rest (`autoPauseRedraw`: simulation stopped, no particle); measured: 0.1 ms per frame at rest versus ~10 ms for a redrawn frame with 2,000 nodes. `prefers-reduced-motion`: no particles, no animated framing or zoom, simulation computed in one go (300 steps) then frozen, Pause button hidden.
  - **Keyboard equivalent.** The page list (rendered only when opened) gives, for each page, its related pages as links.
  - **Scale (synthetic graph of 2,000 nodes and ~3,000 edges, Chrome, Linux).** On opening: a main-thread block of about 1 s (code loading and 80 warm-up simulation steps), then smooth; frame at ~10 ms at worst (nodes, links and labels), labels without overlap (label selection < 20 ms, tested), at rest no more redraw. Limits: with `prefers-reduced-motion`, the 300 warm-up steps block for ~3 s at this size; at 2,000 nodes the initial framing is a dense cloud where only ~40 labels (the most linked) appear, readability comes from zoom and selection; beyond a few thousand, switch to sigma.js (WebGL, see above). Not verified: real touch, `prefers-reduced-motion` in a browser, a screen reader.

**Out of scope: deployment.** Where and how to serve the site (for example on a homelab) is a matter of use, not of the CLI. The export is reproducible (same commit, same site), which is enough to automate it elsewhere.

## 11. Non-goals

- no CI that runs an LLM (GitHub Actions only test and build the releases);
- no JSON handoffs and no multi-agent pipeline;
- no cron and no automatic periodic syntheses: syntheses are born from questions;
- no ingestion without reading: the `note:` field is required and the human stays in the loop;
- no a priori tag taxonomy: tags emerge and lint proposes merges;
- no mandatory LLM SDK: the CLI stays agnostic by default, the SDKs are optional;
- no chunk-based RAG.

## Sources

- Karpathy, [LLM Wiki](https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/ac46de1ad27f92b28ac95459c782c07f6b8c964a/llm-wiki.md)
- OKF: [README](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/README.md), [SPEC v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md), [Google Cloud blog post (v0.1)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing?hl=en)
- Local search: [qmd](https://github.com/tobi/qmd), [rqmd](https://docs.rs/crate/rqmd/0.1.1), [qrst](https://github.com/l1x/qrst)
- Implementations of the pattern: [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki), [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), [topic llm-wiki](https://github.com/topics/llm-wiki)
