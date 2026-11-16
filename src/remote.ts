import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { parseArgs } from "node:util";
import { OPTIONS } from "./cli-options";
import { CortexError } from "./lib";
import { withSync } from "./sync";
import pkg from "../package.json";

/**
 * Remote wiki (docs/REMOTE-PLAN.md): on a machine without the wiki, the CLI forwards the command over SSH to the cortex
 * of the wiki host (`cortex remote-exec`), which runs it in its own checkout, synced with git. Client: the user-level
 * `remotes.json`, the choice of the wiki, the forwarding. Server: `remoteExec`.
 */

const usage = (msg: string) => new CortexError(msg, "usage");

const Remote = z.object({
  ssh: z.string().regex(/^[^\s-][^\s]*$/, "ssh: user@host or an ~/.ssh/config Host alias (no space, not starting with -)"),
  port: z.number().int().min(1).max(65535).optional(),
}).strict();
const RemotesFile = z.object({ default: z.string().optional(), wikis: z.record(z.string(), Remote).default({}) }).strict();
export type Remote = z.infer<typeof Remote>;
export type Remotes = z.infer<typeof RemotesFile>;
const NAME = /^[A-Za-z0-9._-]+$/;

/** `$XDG_CONFIG_HOME/cortex/remotes.json` (default `~/.config/cortex/remotes.json`): outside any wiki, it spans them. */
export const remotesPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cortex", "remotes.json");

export function readRemotes(path = remotesPath()): Remotes {
  if (!existsSync(path)) return { wikis: {} };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new CortexError(`${path}: invalid JSON (${(e as Error).message})`, "usage"); }
  const r = RemotesFile.safeParse(raw);
  if (!r.success) throw new CortexError(`${path}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`, "usage");
  return r.data;
}

function writeRemotes(r: Remotes, path = remotesPath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
}

/** `cortex remote add|remove|list|default`: the lines to print. */
export function remoteCommand(args: string[], port?: string, path = remotesPath()): string[] {
  const [sub, name, target] = args;
  const r = readRemotes(path);
  const known = (n: string | undefined) => { if (!n || !r.wikis[n]) throw usage(`unknown remote wiki: ${n ?? ""} (cortex remote list)`); return n; };
  switch (sub) {
    case "add": {
      if (!name || !target || args.length !== 3) throw usage("Usage: cortex remote add <name> <user@host> [--port N]");
      if (!NAME.test(name)) throw usage("remote name: letters, digits, . _ - only");
      const p = port === undefined ? undefined : Number(port);
      const w = Remote.safeParse({ ssh: target, ...(p !== undefined && { port: p }) });
      if (!w.success) throw usage(w.error.issues.map((i) => i.message).join("; "));
      r.wikis[name] = w.data;
      r.default ??= name;
      writeRemotes(r, path);
      return [`remote wiki ${name}: ${target}${p ? ` (port ${p})` : ""}${r.default === name ? ", default" : ""}`];
    }
    case "remove": {
      if (args.length !== 2) throw usage("Usage: cortex remote remove <name>");
      delete r.wikis[known(name)];
      if (r.default === name) delete r.default;
      writeRemotes(r, path);
      return [`remote wiki ${name} removed`];
    }
    case "default": {
      if (args.length !== 2) throw usage("Usage: cortex remote default <name>");
      r.default = known(name);
      writeRemotes(r, path);
      return [`default remote wiki: ${name}`];
    }
    case "list":
    case undefined: {
      const names = Object.keys(r.wikis);
      if (!names.length) return ["No remote wiki (cortex remote add <name> <user@host>)."];
      return names.map((n) => `${n === r.default ? "*" : " "} ${n}  ${r.wikis[n]!.ssh}${r.wikis[n]!.port ? `:${r.wikis[n]!.port}` : ""}`);
    }
    default:
      throw usage("Usage: cortex remote add <name> <user@host> [--port N] | remove <name> | default <name> | list");
  }
}

/**
 * The remote wiki a command goes to, or undefined for a local one. `--wiki` / `$CORTEX_WIKI` choose a remote even
 * inside a local checkout; otherwise a local wiki (`$CORTEX_ROOT`, a parent holding cortex.json) wins, then the default.
 */
export function pickRemote(explicit: string | undefined, hasLocal: boolean, r: Remotes = readRemotes()): (Remote & { name: string }) | undefined {
  const name = explicit || process.env.CORTEX_WIKI || undefined;
  if (name) {
    if (!r.wikis[name]) throw usage(`unknown remote wiki: ${name} (cortex remote list)`);
    return { name, ...r.wikis[name]! };
  }
  if (hasLocal || !r.default || !r.wikis[r.default]) return undefined;
  return { name: r.default, ...r.wikis[r.default]! };
}

/** Commands that are a job of the wiki host, or not available remotely yet: the reason, in one line. */
export const REFUSED: Record<string, string> = {
  serve: "cortex serve runs on the wiki host, not through a remote wiki.",
  share: "cortex share runs on the wiki host, not through a remote wiki.",
  export: "cortex export writes a site on the wiki host: not through a remote wiki.",
  inbox: "cortex inbox reads a local inbox/ folder: with a remote wiki, use cortex add or the share app.",
  compile: "cortex compile is not available through a remote wiki yet: run it on the wiki host (or let its CI compile).",
  ask: "cortex ask is not available through a remote wiki yet: search, show and the MCP server are.",
  "remote-exec": "remote-exec is the server side of a remote wiki.",
};
/** What the wiki host accepts: the wiki commands minus REFUSED; `config` read-only (`schema` names a file the host would read). */
const ALLOWED = new Set(["add", "search", "index", "new", "lint", "log", "links", "ls", "show", "related", "mcp", "schema", "config", "version"]);

/** Why the host refuses a forwarded argv, or undefined. A path of the host is never an input: it would land in raw/, then in git. */
export function refusal(argv: string[], uploads = 0): string | undefined {
  const cmd = argv[0]!;
  if (REFUSED[cmd]) return REFUSED[cmd];
  if (!ALLOWED.has(cmd)) return `${cmd} is not available through a remote wiki.`;
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }); } catch (e) { return (e as Error).message; }
  const { values: o, positionals: [, ...rest] } = parsed;
  if (cmd === "config" && !["get", "lint", undefined].includes(rest[0])) return "through a remote wiki, cortex config only reads (get, lint): edit cortex.json in a checkout.";
  if (cmd === "mcp" && o.agent !== undefined) return "cortex mcp --agent is internal to the wiki host.";
  if (cmd === "add") {
    const files = rest.filter((a) => /^@file:\d+$/.test(a));
    if (files.length !== uploads || new Set(files).size !== uploads || files.some((f) => Number(f.slice(6)) >= uploads)) return "add: the uploaded files do not match the arguments.";
    const local = rest.find((a) => a !== "-" && !isUrl(a) && !/^@file:\d+$/.test(a));
    if (local) return `add: ${local} is neither a URL, - nor a file of this machine.`;
  }
}

/** The forwarded command: argv as JSON, base64url (one shell word: no shell on either side can read anything in it). */
export type Payload = { argv: string[]; envelope?: boolean };
export const encodePayload = (p: Payload) => Buffer.from(JSON.stringify(p)).toString("base64url");
export function decodePayload(s: string): Payload {
  let p: unknown;
  try { p = JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { throw new CortexError("remote-exec: unreadable payload", "refused"); }
  const ok = !!p && typeof p === "object" && Array.isArray((p as Payload).argv) && (p as Payload).argv.length > 0 && (p as Payload).argv.every((a) => typeof a === "string");
  if (!ok) throw new CortexError("remote-exec: unreadable payload", "refused");
  return p as Payload;
}

const isUrl = (s: string) => /^https?:\/\//i.test(s);
type Envelope = { files: { name: string; b64: string }[]; stdin?: string };

/** `add` with local files: their bytes travel on stdin (the envelope), each argument replaced by `@file:<i>`. */
export async function pack(argv: string[]): Promise<{ argv: string[]; envelope?: Envelope }> {
  if (argv[0] !== "add") return { argv };
  // the inputs are the positionals after the command: an option value (--note README.md) is never a file to send
  const { tokens } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true });
  const inputs = new Set(tokens.filter((t) => t.kind === "positional" && t.index > 0).map((t) => t.index));
  const files: Envelope["files"] = [];
  const out = argv.map((a, i) => {
    if (!inputs.has(i) || a === "-" || isUrl(a) || !existsSync(a) || !statSync(a).isFile()) return a;
    files.push({ name: basename(a), b64: readFileSync(a).toString("base64") });
    return `@file:${files.length - 1}`;
  });
  if (!files.length) return { argv };
  return { argv: out, envelope: { files, ...(out.includes("-") && { stdin: await Bun.stdin.text() }) } };
}

/** The ssh command line of a forwarded call. `-t` only with two terminals and no envelope (a pty would alter its bytes). */
export function sshArgs(r: Remote, payload: string, tty: boolean): string[] {
  return ["ssh", ...(r.port ? ["-p", String(r.port)] : []), ...(tty ? ["-t"] : []), "--", r.ssh, "cortex", "remote-exec", payload];
}

/** Runs the command on the remote wiki; resolves the exit code (ssh's, which is cortex's, or 255 when ssh failed). */
export async function forward(r: Remote & { name: string }, argv: string[]): Promise<number> {
  const { argv: sent, envelope } = await pack(argv);
  const tty = !envelope && !!process.stdin.isTTY && !!process.stdout.isTTY;
  const p = Bun.spawn(sshArgs(r, encodePayload({ argv: sent, ...(envelope && { envelope: true }) }), tty), {
    stdin: envelope ? new Blob([JSON.stringify(envelope)]) : "inherit", stdout: "inherit", stderr: "inherit",
  });
  const code = await p.exited;
  if (code === 255) console.error(`cortex: cannot reach the remote wiki ${r.name} (${r.ssh}): see the ssh error above.`);
  return code;
}

/** `cortex --version` of the remote wiki's host, or the reason it could not be read. */
export async function remoteVersion(r: Remote): Promise<{ version?: string; error?: string }> {
  const p = Bun.spawn(sshArgs(r, encodePayload({ argv: ["version"] }), false), { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return code === 0 ? { version: out.trim() } : { error: err.trim().split("\n").at(-1) || `ssh exit ${code}` };
}

/** Whether two versions differ in major or minor (a patch never changes what a command does). */
export const skewed = (a: string, b: string) => a.split(".").slice(0, 2).join(".") !== b.split(".").slice(0, 2).join(".");

/** The command of the payload, as the key's forced command or an ssh argument gives it. */
function payloadArg(args: string[]): string | undefined {
  if (args[0]) return args[0];
  const words = (process.env.SSH_ORIGINAL_COMMAND ?? "").trim().split(/\s+/);
  return words.length === 3 && words[1] === "remote-exec" ? words[2] : undefined;
}

/**
 * Server side: `cortex remote-exec <payload>`, the only entry point of a remote call. The root is the server's
 * (`$CORTEX_ROOT`, set by the key's forced command), never the client's. The command runs as a child cortex, synced
 * with git around it (`withSync`); the MCP server, which lasts a whole session, syncs each tool call instead.
 */
export async function remoteExec(args: string[], self: string[]): Promise<number> {
  const root = process.env.CORTEX_ROOT;
  if (!root) throw new CortexError("remote-exec needs $CORTEX_ROOT (set by the forced command of the ssh key).", "refused");
  const arg = payloadArg(args);
  if (!arg) throw new CortexError("remote-exec: no payload", "refused");
  const { argv, envelope } = decodePayload(arg);
  if (argv[0] === "version") { console.log(pkg.version); return 0; }
  const cmd = argv[0]!;
  let stdin: "inherit" | "ignore" | Blob = "inherit", e: Envelope | undefined;
  if (envelope) {
    try { e = JSON.parse(await Bun.stdin.text()) as Envelope; } catch { throw new CortexError("remote-exec: unreadable upload", "refused"); }
    if (!Array.isArray(e?.files) || !e.files.every((f) => typeof f?.name === "string" && typeof f?.b64 === "string") || (e.stdin !== undefined && typeof e.stdin !== "string"))
      throw new CortexError("remote-exec: unreadable upload", "refused");
  }
  const why = refusal(argv, e?.files.length ?? 0);
  if (why) throw new CortexError(why, "refused");
  let dir: string | undefined;
  if (e) {
    dir = mkdtempSync(join(tmpdir(), "cortex-upload-"));
    for (const [i, f] of e.files.entries()) {
      const name = basename(f.name).replace(/^\.+/, "") || `file-${i}`;
      mkdirSync(join(dir, String(i)));
      writeFileSync(join(dir, String(i), name), Buffer.from(f.b64, "base64")); // its own folder: two uploads may share a name
      argv.splice(argv.indexOf(`@file:${i}`), 1, join(dir, String(i), name));
    }
    stdin = e.stdin === undefined ? "ignore" : new Blob([e.stdin]);
  }
  const { SSH_ORIGINAL_COMMAND: _, ...env } = process.env;
  const run = async () => {
    // CORTEX_PUBLIC_ONLY: a URL given from another machine never reaches the host's own network (loopback, private), as through MCP
    const p = Bun.spawn([...self, ...argv], { cwd: root, env: { ...env, CORTEX_ROOT: root, CORTEX_PUBLIC_ONLY: "1", ...(cmd === "mcp" && { CORTEX_SYNC: "1" }) }, stdin, stdout: "inherit", stderr: "inherit" });
    return p.exited;
  };
  try { return cmd === "mcp" ? await run() : await withSync(root, cmd, run, undefined, (code) => code !== 0); }
  finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
}
