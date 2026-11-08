#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { add, formatAdd, VIA } from "./add";
import { toResource } from "./doc";
import { inbox } from "./inbox";
import { openWiki } from "./context";
import { regenerateCtx } from "./catalog";
import { KINDS, kindLabel, logAddCtx, newestFirst } from "./log";
import { search } from "./search";
import { lintCtx } from "./lint";
import { configCmd } from "./config-cmd";
import { CONFIG_KEYS, override } from "./config";
import { CortexError, findRoot } from "./lib";
import { newPageCtx } from "./naming";
import { print, type Result } from "./print";
import { fail, paint, warn } from "./style";
import { LIMITS } from "./limits";
import pkg from "../package.json";
import { HELP } from "./help";



const usage = (msg: string) => new CortexError(msg, "usage");
/** Optional integer option: undefined when absent, a usage error unless it is an integer >= min. */
const int = (name: string, value: string | undefined, { min }: { min: number }) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw usage(`${name} expects an integer >= ${min} (got: ${value})`);
  return n;
};

// Exit code: set in one place. A command that fails without throwing flips `ok`; a thrown CortexError is mapped in the catch.
try {
  let ok = true;
  /** Domain results arrive already printed (live `print` report) or are rendered here; either way `ok` decides the exit code. */
  const finish = (r: Result, rendered = true) => { if (!rendered) r.messages.forEach(print); ok &&= r.ok; };
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      tokens: true, // token order tells whether `add` directly follows `log`
      options: {
        note: { type: "string" }, via: { type: "string" }, "dry-run": { type: "boolean" }, in: { type: "string" },
        json: { type: "boolean" }, limit: { type: "string" }, pending: { type: "boolean" }, batch: { type: "boolean" },
        file: { type: "boolean" }, kind: { type: "string" }, source: { type: "string", multiple: true }, page: { type: "string", multiple: true }, out: { type: "string" }, interactive: { type: "boolean" }, help: { type: "boolean", short: "h" }, type: { type: "string" }, check: { type: "boolean" }, write: { type: "boolean" }, version: { type: "boolean", short: "v" }, force: { type: "boolean" }, agent: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, port: { type: "string" }, sync: { type: "boolean" },
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code, opt = (e as Error).message.match(/'(-[^' ]*)/)?.[1] ?? "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") throw usage(`unknown option: ${opt} (see cortex --help)`);
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") throw usage(`missing or invalid value for ${opt} (see cortex --help)`);
    throw e;
  }
  const { values: o, positionals: [cmd, ...args], tokens } = parsed;
  Object.assign(override, { model: o.model, effort: o.effort }); // this command only: every loadConfig applies it
  // `log add` only when `add` is the very next token after `log`: `cortex log --json add …` and `cortex search log add` must write nothing
  const first = tokens!.findIndex((t) => t.kind === "positional");
  const isLogAdd = cmd === "log" && tokens![first + 1]?.kind === "positional" && (tokens![first + 1] as { value?: string }).value === "add";
  // config init creates cortex.json, the root marker: it runs where it is called
  // upgrade and doctor concern the CLI, not a wiki: they run anywhere (the root is never read)
  // help and version too: no command, `--help`, `--version` (the release workflow runs them outside any wiki)
  if (o.version) { console.log(pkg.version); process.exit(0); }
  const anywhere = !cmd || o.help || cmd === "config" && args[0] === "init" || cmd === "upgrade" || cmd === "doctor" || cmd === "share";
  const root = anywhere ? (process.env.CORTEX_ROOT ?? process.cwd()) : findRoot();
  const wiki = openWiki(root); // one context per command: cortex.json, raw/ and wiki/ are each read at most once
  switch (cmd) {
    case "add": {
      if (!args[0]) throw usage("Usage: cortex add <url|file|-> --note \"…\"");
      if (o.via && !VIA[o.via]) throw usage(`Unknown --via: ${o.via} (${Object.keys(VIA).join(", ")}).`);
      for (const input of args) {
        try { // one context per input (add(root) opens it): the previous input wrote to raw/, the duplicate check must see it
          const r = await add(root, input, { note: o.note, dryRun: o["dry-run"], mirrors: o.via ? VIA[o.via] : undefined });
          console.log(formatAdd(r, o["dry-run"]));
        } catch (e) {
          fail((e as Error).message);
          ok = false;
        }
      }
      break;
    }
    case "inbox":
      finish(await inbox(root, { dryRun: o["dry-run"] }, print));
      break;
    case "search": {
      const q = args.join(" ");
      if (!q) throw usage('Usage: cortex search "<query>"');
      if (o.in && o.in !== "wiki" && o.in !== "raw") throw usage("--in expects wiki or raw");
      const hits = await search(root, q, { in: o.in as any, limit: int("--limit", o.limit, { min: 1 }) });
      if (o.json) { console.log(JSON.stringify(hits, null, 2)); break; }
      if (!hits.length) console.log(paint.dim("No results."));
      for (const h of hits) console.log(`${paint.accent(h.area === "raw" ? "raw " : "wiki")}  ${paint.bold(h.title)}  ${paint.dim(toResource(h.path))}\n      ${h.snippet.replace(/\s+/g, " ")}`);
      if (o.in !== "raw" && hits.length && hits.every((h) => h.area === "raw")) console.log(paint.warn("\n→ Found only in raw/: a gap to compile?"));
      break;
    }
    case "new": {
      if (args.length !== 2) throw usage('Usage: cortex new <Source|Concept|Entity|Synthesis> "<title>" [--force]');
      if (o.force && process.env.CORTEX_IN_AGENT) throw usage("cortex new --force is for a human only: update the existing page instead.");
      const notes: string[] = [];
      console.log(await newPageCtx(wiki, args[0], args[1], new Date(), { force: o.force, notes }));
      for (const n of notes) warn(n);
      break;
    }
    case "index":
      await regenerateCtx(wiki);
      console.log(`${paint.ok("✓")} wiki/index.md and wiki/log.md regenerated.`);
      break;
    case "log": {
      // `add` is the subcommand only right after `log`: `cortex log --json add …` must write nothing (the agent guards rely on this)
      if (isLogAdd) {
        const [, kind, ...text] = args;
        if (!kind || !text.length) throw usage(`Usage: cortex log add <${KINDS.join("|")}> "<text>" [--source <id>]… [--page <path>]…`);
        const e = await logAddCtx(wiki, kind, text.join(" "), o.source, o.page);
        console.log(`${paint.ok("+")} ${paint.dim(e.at)} ${paint.bold(kindLabel(e.kind))}: ${e.text}`);
        break;
      }
      if (args.length) throw usage(`Usage: cortex log [--limit N] [--json] [--kind k] | cortex log add …`);
      if (o.kind && !KINDS.includes(o.kind as any)) throw usage(`--kind expects ${KINDS.join(" | ")}`);
      const limit = int("--limit", o.limit, { min: 1 }) ?? LIMITS.logEntries;
      const { entries, errors } = wiki.journal();
      for (const x of errors) warn(`wiki/log.jsonl:${x.line}: ${x.msg}`);
      const shown = newestFirst(entries.filter((e) => !o.kind || e.kind === o.kind)).slice(0, limit);
      if (o.json) { console.log(JSON.stringify(shown, null, 2)); break; }
      if (!shown.length) console.log(paint.dim("Empty journal."));
      for (const e of shown) console.log(`${paint.dim(e.at.slice(0, 16).replace("T", " "))}  ${paint.bold(kindLabel(e.kind).padEnd(6))}  ${e.text}`);
      break;
    }
    case "links": {
      const { suggestLinks, writeLinks } = await import("./links");
      let found = suggestLinks(await wiki.pages());
      if (o.write) found = await writeLinks(root, found);
      if (o.json) { console.log(JSON.stringify(found, null, 2)); break; }
      for (const s of found)
        console.log(`${paint.bold(s.from || s.path)} → ${paint.bold(s.title)}\n    ${s.reasons.join(" · ")}\n    ${paint.dim(`${s.path} → ${s.target}`)}`);
      console.log(o.write ? `${found.length} link(s) written.` : `${found.length} link(s) suggested; nothing written (--write writes them).`);
      break;
    }
    case "lint": {
      const issues = await lintCtx(wiki);
      if (o.json) console.log(JSON.stringify(issues, null, 2));
      else {
        const icon = { error: paint.error("✗"), warning: paint.warn("!"), info: "·" };
        for (const i of issues.filter((i) => i.level !== "info")) console.log(`${icon[i.level]} ${paint.dim(i.path)}: ${i.msg}`);
        const n = (l: string) => issues.filter((i) => i.level === l).length;
        const count = (k: string, s: string, color: (s: string) => string) => (n(k) ? color(`${n(k)} ${s}`) : `${n(k)} ${s}`);
        console.log(`${count("error", "error(s)", paint.error)}, ${count("warning", "warning(s)", paint.warn)}, ${n("info")} page(s) never reviewed.`);
      }
      if (issues.some((i) => i.level === "error")) ok = false;
      break;
    }
    case "compile":
      if (!args.length && !o.pending) throw usage("Usage: cortex compile <id…> | --pending [--batch]");
      finish(await (await import("./agent")).compileCtx(wiki, args, { pending: o.pending, batch: o.batch }, print));
      break;
    case "ask": {
      const q = args.join(" ");
      if (!q) throw usage('Usage: cortex ask "<question>" [--file]');
      finish(await (await import("./agent")).askCtx(wiki, q, { file: o.file, interactive: o.interactive }, print));
      break;
    }
    case "share": {
      if (process.env.CORTEX_IN_AGENT) throw usage("cortex share is for a human only.");
      if ((await import("./upgrade")).dist() !== "sources") { // the bookmarklet is bundled from the extension's sources at startup
        process.exitCode = await (await import("./payload")).runFromSources(root);
        break;
      }
      const server = (await import("../scripts/share-server")).start();
      console.log(`cortex share: http://127.0.0.1:${server.port}/share/`);
      await new Promise(() => {}); // serves until stopped
      break;
    }
    case "serve": {
      if (process.env.CORTEX_IN_AGENT) throw usage("cortex serve is for a human only.");
      const reviewer = process.env.CORTEX_REVIEWER;
      if (!reviewer) throw usage("cortex serve needs $CORTEX_REVIEWER: the name written in verified.by (human:<name>).");
      if ((await import("./upgrade")).dist() !== "sources") { // the site export needs Vite: run from the embedded sources, as export does
        process.exitCode = await (await import("./payload")).runFromSources(root);
        break;
      }
      await (await import("./serve")).serve(root, { port: int("--port", o.port, { min: 0 }) ?? 8080, sync: !!o.sync, reviewer });
      await new Promise(() => {}); // serves until stopped
      break;
    }
    case "export": {
      if ((await import("./upgrade")).dist() !== "sources") { // Vite cannot run inside the binary or the bundle: rerun from the embedded sources
        process.exitCode = await (await import("./payload")).runFromSources(root);
        break;
      }
      const { exportSite } = await import("./export"); // Vite, Svelte and force-graph are only loaded here
      await exportSite(root, o.out ?? join(root, ".cortex/site"));
      break;
    }
    case "ls": {
      const rows = await (await import("./extras")).lsCtx(wiki, o.type);
      if (o.json) { console.log(JSON.stringify(rows, null, 2)); break; }
      if (!rows.length) console.log(paint.dim("No pages."));
      for (const r of rows) console.log(`${paint.accent(String(r.type ?? "?").padEnd(9))} ${paint.dim(String(r.status ?? "").padEnd(10))} ${paint.bold(r.title)}  ${paint.dim(toResource(r.path))}`);
      break;
    }
    case "show":
      if (args.length !== 1) throw usage("Usage: cortex show <path|raw id|title>");
      process.stdout.write(await (await import("./extras")).showCtx(wiki, args[0]));
      break;
    case "related": {
      if (args.length !== 1) throw usage("Usage: cortex related <path|title> [--limit N] [--json]");
      const hits = await (await import("./extras")).relatedCtx(wiki, args[0], int("--limit", o.limit, { min: 1 }) ?? 10);
      if (o.json) { console.log(JSON.stringify(hits, null, 2)); break; }
      if (!hits.length) console.log(paint.dim("No related pages."));
      for (const h of hits) console.log(`${String(h.score).padStart(3)}  ${paint.bold(h.title)}  ${paint.dim(toResource(h.path))}
     ${paint.dim(h.reasons.join(", "))}`);
      break;
    }
    case "doctor":
      for (const t of await (await import("./extras")).doctor(root)) {
        if (t.path) console.log(`${paint.ok("✓")} ${t.name.padEnd(13)} ${paint.dim(t.path)}`);
        else console.log(`${paint.warn("!")} ${t.name.padEnd(13)} missing: ${t.use}; ${paint.dim(t.install)}`);
      }
      break;
    case "upgrade": {
      const { upgrade, compareVersions } = await import("./upgrade");
      const r = await upgrade(o.check);
      if (r.upgraded) console.log(`${paint.ok("✓")} cortex ${r.current} → ${r.latest}`);
      else if (compareVersions(r.current, r.latest) >= 0) console.log(`cortex ${r.current}: up to date (latest release: ${r.latest}).`);
      else console.log(`cortex ${r.current} → ${paint.warn(r.latest)} available: cortex upgrade`);
      break;
    }
    case "mcp":
      if (o.agent !== undefined) { // the agent cortex runs: the cortex tool pack (agent-mcp.ts), not the human's server
        if (o.agent !== "write" && o.agent !== "read") throw usage("Usage: cortex mcp [--agent write|read]");
        await (await import("./agent-mcp")).serveAgentMcp(root, o.agent);
      } else await (await import("./mcp")).serveMcp(root); // loaded on demand; stays open as long as the client reads stdin
      break;
    case "schema": {
      const { schemaText, writeSchema } = await import("./schema");
      if (o.write) console.log(`${paint.ok("✓")} ${(await writeSchema(root, true)).file} written.`);
      else process.stdout.write(await schemaText(root));
      break;
    }
    case "config":
      finish(await configCmd(root, args), false);
      break;
    default:
      console.log(HELP);
      if (cmd && !o.help) ok = false;
  }
  if (!ok) process.exitCode = 1;
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  process.exitCode = e instanceof CortexError && e.code === "usage" ? 2 : 1; // lint errors keep exit 1 (documented contract)
}
