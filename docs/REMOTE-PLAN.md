# PLAN — Remote wiki: using the CLI without the wiki on the machine

> Status: **phase 1 implemented** (not released yet). 2026-11-16.
> Need: run `cortex` (and `cortex mcp` from Claude Code) on a machine that holds **no copy of the wiki**, against a wiki that lives elsewhere, configured once.

## 0. Prerequisite, before any code

Checked on 2026-11-16 (read-only, LXC 138, cortex 0.7.1):

- **SSH:** OpenSSH listens on port 22; Gitea's built-in SSH server is off (`START_SSH_SERVER = false`), so `git@` goes through OpenSSH. A shell account with restricted keys works on port 22, no other port needed.
- **Account:** `runner` (home `/var/lib/act_runner`, bash) owns the `cortex` binary (`/usr/local/bin/cortex` links to it) and `/srv/cortex/wiki`. No `cortex` account exists.
- **`bwrap`:** works as `runner` inside the container (unprivileged, `nesting=1`).
- **Agents: none on the host.** `claude`, `codex` and `opencode` are not installed for `runner`, and there is no Claude credential. The CI installs the agent CLI inside each job and gets its credentials from Gitea secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_AUTH_JSON`). So `compile` and `ask` cannot run on the host outside the CI today (§4.4).

## 1. Today

- Every command except `config init`, `upgrade`, `doctor`, `share` and help needs a wiki root: `$CORTEX_ROOT`, or the first parent holding `cortex.json` (`src/lib.ts:12-16`, `src/cortex.ts:64-65`). Outside a checkout, the CLI fails.
- The personal wiki is the `fmatsos/thoughts` repository on the homelab Gitea. `cortex serve --sync` runs on the LXC in its own checkout (`/srv/cortex/wiki`): it pulls before a write, commits and pushes after it (`pullRebase` / `commitAndPush`, `src/serve.ts:28-46`), the CI compiles pending sources every hour (`site-claude.yml`, cron, also on demand; rebasing before pushing), and the site is rebuilt by `serve` after each change. Several writers therefore push to `thoughts`: `serve`, the CI, the workstation.

## 2. Decision: the local CLI forwards the command over SSH

The local `cortex` sends the command to the `cortex` installed on the wiki host, which runs it in a checkout of its own and syncs it with git. Nothing of the wiki is written on the local machine.

**Why SSH rather than an HTTP API on `cortex serve`:**

- **Every command works as is**, interactive ones included (`compile` without `--batch`, `ask --interactive` through `ssh -t`), with output streamed and exit codes kept.
- **`cortex mcp` works for free:** it is a stdio server, and `ssh` carries stdio. Claude Code on any machine: `claude mcp add cortex -- cortex mcp`, nothing else.
- **No new server surface:** authentication is SSH keys; no token, no route that runs commands over HTTP, no auth to add in front of the site.
- **Little code:** a forwarder on the client, a small entry point on the server.

Rejected: an HTTP API on `cortex serve` (a command runner over HTTP, plus streaming, plus an MCP over HTTP transport, and no interactive mode), a local cache clone (excluded: nothing of the wiki on the machine).

Limits accepted: no offline use; each command pays an SSH connection and a `git pull` (well under a second on the LAN); the host must be reachable by SSH from each machine (LAN, or a VPN such as Tailscale from outside).

## 3. Client side

### 3.1 Configuration

A user-level file, outside any wiki: `$XDG_CONFIG_HOME/cortex/remotes.json` (default `~/.config/cortex/remotes.json`), validated with zod like `cortex.json`.

```json
{
  "default": "perso",
  "wikis": {
    "perso": { "ssh": "cortex@192.168.1.138" },
    "pro":   { "ssh": "cortex@work-host", "port": 2222 }
  }
}
```

- Only how to reach the host. **The path of the wiki is decided on the server** (§4.2): a client cannot point the remote `cortex` at another directory.
- Managed with `cortex remote add <name> <user@host> [--port N]`, `cortex remote remove <name>`, `cortex remote list`, `cortex remote default <name>`. These run anywhere, like `config init`.

### 3.2 Which wiki a command uses

1. `--wiki <name>` or `$CORTEX_WIKI`: that remote wiki, even inside a local checkout.
2. `$CORTEX_ROOT`: that local wiki (unchanged).
3. A parent folder holding `cortex.json`: that local wiki (unchanged).
4. The `default` remote wiki.
5. Otherwise the current error, plus one line: `or configure a remote wiki: cortex remote add <name> <user@host>`.

A local checkout keeps working exactly as today; a remote is only used when there is no local wiki or when asked.

### 3.3 Forwarding

`src/remote.ts`, called at the top of `main` (`src/cortex.ts`) before `openWiki`:

- **Always local:** `--version`, help, `upgrade`, `config init`, `remote …`, `doctor` (which also checks the remote: reachable, remote version).
- **Refused in remote mode,** with one line saying why: `serve`, `share` (host jobs), `export` (writes a site on the host), `inbox` (a local folder; use the share app or `cortex add`), and in phase 1 `compile` and `ask` (§4.4).
- **Everything else is forwarded:** `ssh [-p port] [-t] <user@host> cortex remote-exec <payload>`.
  - `<payload>`: the argv as JSON, base64url-encoded: one shell word, nothing for any shell to interpret on either side.
  - `-t` when local stdin and stdout are both terminals (colors, interactive agent sessions); without it otherwise (pipes, `mcp`, `--json`).
  - stdin, stdout, stderr inherited; the exit code of `ssh` is the exit code of `cortex`.
- **Local files given to `add`:** `cortex add ./doc.pdf` reads the file locally and sends it on stdin with its name (a small JSON envelope, only for `add` with local paths); the server writes it to a temporary directory and passes that path. `cortex add -` streams stdin as today. URLs pass unchanged.
- **Never `-t` when stdin carries the envelope:** a remote pty would alter the bytes (echo, line endings, ^D).
- **Version skew:** checked by `cortex doctor` only (it runs `cortex --version` on the host), never on the output of a forwarded command, which must stay clean for MCP and `--json`.
- **Several wikis on one host, or a key per wiki:** use a `Host` alias in `~/.ssh/config` and put the alias in `remotes.json`.

## 4. Server side

### 4.1 `cortex remote-exec`

A hidden subcommand, the only entry point of a remote call:

- reads the payload from `$SSH_ORIGINAL_COMMAND` (or its argument);
- **requires `$CORTEX_ROOT`**, set by the forced command of the key (§4.3): without it, it refuses, so the root is always decided on the server;
- decodes the argv, refuses the commands of §3.3 that are local-only or refused, and `remote-exec` itself;
- runs the command in the server's wiki checkout (`$CORTEX_ROOT`), **in sync mode** (§4.2).

### 4.2 Sync around a forwarded command

`remote-exec` runs the command as a child `cortex` and syncs the checkout around it, in the parent (`withSync`, `src/sync.ts`). Only a checkout whose branch tracks a remote is synced; otherwise the command just runs.

- **Nothing is ever discarded.** `serve` resets its checkout on a conflict (`pullRebase`): fine for one click, not for a long command. `withSync` never resets work that is not saved elsewhere.
- **Before the command:** if the tree is dirty (a command killed before it could commit), those changes are committed first ("cortex: changes left by an interrupted command"); then `git pull --rebase`. If the pull fails with nothing local to save, the command does not run, and the message ends with git's own error.
- **After the command, whatever its exit code:** if `raw/`, `wiki/`, `cortex.json` or the agent file changed, commit as `cortex-remote` with an English message: `cortex <command>: <n> files changed`, then one line per path (at most 50); a failed command says so in the subject. Then push; a rejected push is rebased once.
- **Push conflict:** the commit is pushed to a branch of its own (`cortex/pending-<date>-<time>`) and the checkout returns to the remote. One line on stderr gives the branch name: the work is safe on the remote, to merge by hand. Offline, the commits simply stay local and go with the next command.
- **No nested sync:** the sync happens in the `remote-exec` parent only, so a `cortex` the command itself runs (an agent's `cortex search`, later) neither takes the lock nor pulls or pushes.
- **One command at a time per checkout:** a lock (atomic `mkdir` of `.git/cortex.lock` with the pid, the command and the start time inside; a lock whose pid is dead is taken over). A second command waits and says so on stderr, in one line: `waiting: cortex new (started 14:02) is using the wiki`.
- **`cortex mcp`:** it lasts as long as Claude Code is open, so it is not wrapped. `remote-exec` starts it with `CORTEX_SYNC=1`, and each tool call is wrapped instead: lock, pull, call, commit and push what `add` wrote.
- **URLs stay public:** `remote-exec` sets `CORTEX_PUBLIC_ONLY=1` for the child, so `add` refuses loopback and private addresses, as the MCP `add` does: `localhost` sent from a laptop would otherwise mean the host's own services.
- `pullRebase` and `commitAndPush` moved from `src/serve.ts` to `src/sync.ts`, shared by `serve` and `share`, which keep their reset-on-conflict behaviour.

**A checkout for remote calls, separate from the one of `cortex serve`** (`/srv/cortex/cli`, a clone of `thoughts`): `serve` resets its checkout to the remote on a conflict (`src/serve.ts`, `pullRebase`), which would drop a remote command's uncommitted writes if both shared it. Each pushes to Gitea.

Ceiling: the lock serializes everything, so a long command makes a `search` wait. Upgrade path if that bothers: read-only commands skip the lock and the pull runs only when the last one is older than a few seconds.

### 4.3 SSH access

- A dedicated account on the wiki host (`cortex`, or the existing `runner` that already has the `cortex` binary and the agent credentials used by the CI).
- Each client machine's key in `authorized_keys` **restricted to cortex**:
  ```
  restrict,pty,command="CORTEX_ROOT=/srv/cortex/cli /usr/local/bin/cortex remote-exec" ssh-ed25519 AAAA… laptop
  ```
  The key can run nothing but `cortex remote-exec`, in that checkout; `pty` keeps interactive sessions possible.
- The agent runs on the host, never on the client (§4.4).

### 4.4 Agent commands (`compile`, `ask`)

The host has no agent outside the CI (§0). Two phases:

- **Phase 1 (this plan):** `compile` and `ask` are refused in remote mode, with one line saying to run them on the wiki host. A source added remotely is compiled by the CI within the hour, as today for a share from the phone. Everything else works: `add`, `search`, `show`, `ls`, `related`, `log`, `lint`, `new`, `index`, `links`, `mcp`.
- **Phase 2 (only if phase 1 is not enough):** install the agent CLI for the remote account (`bun add @anthropic-ai/claude-code` in its home, as the CI does in a job) and give it a token made with `claude setup-token`, in a file readable by that account only, loaded by the forced command. Interactive sessions then run under `bwrap`, which works (§0).

## 5. Changes (done)

- `src/remote.ts`: `remotes.json` (zod) and `cortex remote`, `pickRemote` (§3.2), payload encoding, `pack` (files given to `add`), `forward`, `remoteVersion` for `doctor`; server side `remoteExec` and `refusal` (host jobs, phase-1 agent commands, `config` other than `get` / `lint`, `mcp --agent`, any input of `add` that is neither a URL, `-` nor an uploaded file).
- `src/sync.ts`: the git helpers (moved), `changedPaths`, `syncMessage`, `syncUp` (pending branch), `lock`, `withSync`.
- `src/cli-options.ts`: the parseArgs options, shared by the CLI and `refusal` / `pack`, which parse a forwarded argv the same way.
- `src/cortex.ts`: `remote` and `remote-exec`, forwarding before the root is resolved, `--wiki`, `doctor` checks the remote, `CORTEX_PUBLIC_ONLY` for `add`.
- `src/mcp.ts`: each tool call wrapped in `withSync` when `CORTEX_SYNC=1`.
- `src/serve.ts`, `scripts/share-server.ts`: import from `src/sync.ts`.
- `src/lib.ts`: the `findRoot` error names `cortex remote add`.
- `bunfig.toml` and `src/test-preload.ts`: every test, and every cortex it spawns, gets an empty `XDG_CONFIG_HOME`, so no test can reach a real remote wiki.
- `src/help.ts`, `README.md` ("Remote wiki"), `docs/DESIGN.md` (§6).

## 6. Tests (done)

`src/sync.test.ts` (a bare remote and two clones) and `src/remote.test.ts` (a client without a wiki, a `remotes.json`, and an `ssh` on `PATH` that runs the server side here):

- `cortex remote`: add (first one is the default), list, default, remove; a name with spaces, an ssh target starting with `-`, a bad port and an invalid file are refused.
- Choice of the wiki: `--wiki`, `$CORTEX_WIKI`, a local wiki, the default.
- Payload: an argv with spaces, quotes, `$`, backticks, newlines and non-ASCII comes back identical; anything else is refused.
- `refusal`: host jobs, `compile` and `ask`, `config set` / `init`, `mcp --agent`, a host path given to `add` (an option value is not an input), uploads that do not match the arguments, an unknown option.
- `pack`: only the inputs of `add` travel as files, never an option value naming a file.
- End to end: `search` answers from the host with a clean JSON stdout, the command first and `--wiki` not sent, no `-t` without terminals; `add` of a local file travels in the envelope; `add -` passes stdin; exit codes come back; refused commands say why in one line without calling ssh; `remote-exec` needs the host's `$CORTEX_ROOT` and refuses a host path.
- End to end on a git-backed host: a forwarded `add` is committed and pushed as `cortex-remote`; `cortex mcp` over ssh answers JSON-RPC on a clean stdout and each `add` call is pushed.
- `withSync`: pull before, commit and push after with the expected message; a read command commits nothing; no upstream, no sync; a failed command (thrown or exit code) still commits; leftovers committed before the next command; a push conflict lands on a `cortex/pending-…` branch, the checkout back at the remote; an unreachable remote stops before running.
- `lock`: a dead holder is taken over; a live one is waited for, said once.

## 7. Setup on the homelab (after the code, with your go-ahead)

- Clone `thoughts` into `/srv/cortex/cli` with the push credentials `serve` uses.
- Create or reuse the account, install the restricted keys of each machine.
- Check that `compile --batch` and an interactive `compile` work for that account (agent CLI installed and authenticated, `bwrap` usable).
- On each machine: `cortex remote add perso cortex@<host>`, then `cortex search …` and `claude mcp add cortex -- cortex mcp`.
- From outside the LAN (work machine): reachability through a VPN to decide; and the professional data question stays separate (a professional wiki would be another remote on another host).

## 8. Not planned

- Offline use, a local cache of the wiki.
- An HTTP API or an MCP over HTTP on `cortex serve`.
- Several hosts for one wiki, or a remote that is a bare git URL with no `cortex` installed on the other side.
