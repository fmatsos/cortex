#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { add, describe } from "./add";
import { toResource } from "./doc";
import { inbox } from "./inbox";
import { openWiki } from "./context";
import { regenerateCtx } from "./index";
import { KINDS, kindLabel, logAddCtx, newestFirst } from "./log";
import { search } from "./search";
import { lintCtx } from "./lint";
import { configCmd } from "./config-cmd";
import { CortexError, findRoot } from "./lib";
import { newPageCtx } from "./naming";
import { print, type Result } from "./print";
import { fail, paint, warn } from "./style";

const HELP = `cortex — second cerveau

  cortex add <url|fichier|-> --note "pourquoi je garde ça" [--dry-run]
  cortex inbox [--dry-run]   (add sur inbox/ : urls.txt et fichiers ; les entrées réussies en sortent)
  cortex search "<requête>" [--in wiki|raw] [--json] [--limit N]
  cortex index
  cortex new <Source|Concept|Entity|Synthesis> "<titre>"   (crée la page selon page_path, status: draft ; affiche son chemin)
  cortex lint [--json]
  cortex log [--limit N] [--json] [--kind k]     (le journal, du plus récent au plus ancien ; défaut 20 entrées)
  cortex log add <add|ingest|query|lint|update> "<texte>" [--source <id raw>]… [--page <wiki/….md>]…
  cortex compile <id…> | --pending [--batch]   (interactif par défaut ; --batch : pages en draft)
  cortex ask "<question>" [--file] [--interactive]
  cortex export [--out <dossier>]               (le wiki en site HTML interactif ; défaut : .cortex/site)
  cortex mcp                                   (serveur MCP stdio : search, get, related, lint, add, log)
  cortex schema [--write]                      (le schéma que suit l'agent ; --write le réécrit dans CLAUDE.md ou AGENTS.md)
  cortex config init [claude|codex|opencode] | lint | get [clé] | set <clé> <valeur> | remove <clé>
                                               (clés : client, model, effort, language, schema, raw_path, page_path)

Agent : cortex.json (client claude|codex|opencode, model, effort). Sans client :
$CORTEX_AGENT (interactif, défaut « claude »), $CORTEX_AGENT_BATCH (défaut « claude -p »).

Racine : $CORTEX_ROOT, sinon le premier dossier parent qui contient cortex.json.`;

const usage = (msg: string) => new CortexError(msg, "usage");
/** Optional integer option: undefined when absent, a usage error unless it is an integer >= min. */
const int = (name: string, value: string | undefined, { min }: { min: number }) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw usage(`${name} attend un entier >= ${min} (reçu : ${value})`);
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
        note: { type: "string" }, "dry-run": { type: "boolean" }, in: { type: "string" },
        json: { type: "boolean" }, limit: { type: "string" }, pending: { type: "boolean" }, batch: { type: "boolean" },
        file: { type: "boolean" }, kind: { type: "string" }, source: { type: "string", multiple: true }, page: { type: "string", multiple: true }, out: { type: "string" }, interactive: { type: "boolean" }, help: { type: "boolean", short: "h" }, write: { type: "boolean" },
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code, opt = (e as Error).message.match(/'(-[^' ]*)/)?.[1] ?? "";
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") throw usage(`option inconnue : ${opt} (voir cortex --help)`);
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") throw usage(`valeur manquante ou invalide pour ${opt} (voir cortex --help)`);
    throw e;
  }
  const { values: o, positionals: [cmd, ...args], tokens } = parsed;
  // `log add` only when `add` is the very next token after `log`: `cortex log --json add …` and `cortex search log add` must write nothing
  const first = tokens!.findIndex((t) => t.kind === "positional");
  const isLogAdd = cmd === "log" && tokens![first + 1]?.kind === "positional" && (tokens![first + 1] as { value?: string }).value === "add";
  // config init creates cortex.json, the root marker: it runs where it is called
  const root = cmd === "config" && args[0] === "init" ? (process.env.CORTEX_ROOT ?? process.cwd()) : findRoot();
  const wiki = openWiki(root); // one context per command: cortex.json, raw/ and wiki/ are each read at most once
  switch (cmd) {
    case "add": {
      if (!args[0]) throw usage("Usage : cortex add <url|fichier|-> --note \"…\"");
      for (const input of args) {
        try { // one context per input (add(root) opens it): the previous input wrote to raw/, the duplicate check must see it
          const r = await add(root, input, { note: o.note, dryRun: o["dry-run"] });
          console.log(describe(r, o["dry-run"]));
        } catch (e) {
          fail((e as Error).message);
          ok = false;
        }
      }
      if (!o.note && !o["dry-run"]) warn("note manquante : à renseigner avant compilation.");
      break;
    }
    case "inbox":
      finish(await inbox(root, { dryRun: o["dry-run"] }, print));
      break;
    case "search": {
      const q = args.join(" ");
      if (!q) throw usage('Usage : cortex search "<requête>"');
      if (o.in && o.in !== "wiki" && o.in !== "raw") throw usage("--in attend wiki ou raw");
      const hits = await search(root, q, { in: o.in as any, limit: int("--limit", o.limit, { min: 1 }) });
      if (o.json) { console.log(JSON.stringify(hits, null, 2)); break; }
      if (!hits.length) console.log(paint.dim("Aucun résultat."));
      for (const h of hits) console.log(`${paint.accent(h.area === "raw" ? "raw " : "wiki")}  ${paint.bold(h.title)}  ${paint.dim(toResource(h.path))}\n      ${h.snippet.replace(/\s+/g, " ")}`);
      if (o.in !== "raw" && hits.length && hits.every((h) => h.area === "raw")) console.log(paint.warn("\n→ Trouvé seulement dans raw/ : un trou à compiler ?"));
      break;
    }
    case "new":
      if (args.length !== 2) throw usage('Usage : cortex new <Source|Concept|Entity|Synthesis> "<titre>"');
      console.log(await newPageCtx(wiki, args[0], args[1]));
      break;
    case "index":
      await regenerateCtx(wiki);
      console.log(`${paint.ok("✓")} wiki/index.md et wiki/log.md régénérés.`);
      break;
    case "log": {
      // `add` is the subcommand only right after `log`: `cortex log --json add …` must write nothing (the agent guards rely on this)
      if (isLogAdd) {
        const [, kind, ...text] = args;
        if (!kind || !text.length) throw usage(`Usage : cortex log add <${KINDS.join("|")}> "<texte>" [--source <id>]… [--page <chemin>]…`);
        const e = await logAddCtx(wiki, kind, text.join(" "), o.source, o.page);
        console.log(`${paint.ok("+")} ${paint.dim(e.at)} ${paint.bold(kindLabel(e.kind))} : ${e.text}`);
        break;
      }
      if (args.length) throw usage(`Usage : cortex log [--limit N] [--json] [--kind k] | cortex log add …`);
      if (o.kind && !KINDS.includes(o.kind as any)) throw usage(`--kind attend ${KINDS.join(" | ")}`);
      const limit = int("--limit", o.limit, { min: 1 }) ?? 20;
      const { entries, errors } = wiki.journal();
      for (const x of errors) warn(`wiki/log.jsonl:${x.line} : ${x.msg}`);
      const shown = newestFirst(entries.filter((e) => !o.kind || e.kind === o.kind)).slice(0, limit);
      if (o.json) { console.log(JSON.stringify(shown, null, 2)); break; }
      if (!shown.length) console.log(paint.dim("Journal vide."));
      for (const e of shown) console.log(`${paint.dim(e.at.slice(0, 16).replace("T", " "))}  ${paint.bold(kindLabel(e.kind).padEnd(6))}  ${e.text}`);
      break;
    }
    case "lint": {
      const issues = await lintCtx(wiki);
      if (o.json) console.log(JSON.stringify(issues, null, 2));
      else {
        const icon = { error: paint.error("✗"), warning: paint.warn("!"), info: "·" };
        for (const i of issues.filter((i) => i.level !== "info")) console.log(`${icon[i.level]} ${paint.dim(i.path)} : ${i.msg}`);
        const n = (l: string) => issues.filter((i) => i.level === l).length;
        const count = (k: string, s: string, color: (s: string) => string) => (n(k) ? color(`${n(k)} ${s}`) : `${n(k)} ${s}`);
        console.log(`${count("error", "erreur(s)", paint.error)}, ${count("warning", "avertissement(s)", paint.warn)}, ${n("info")} page(s) jamais relue(s).`);
      }
      if (issues.some((i) => i.level === "error")) ok = false;
      break;
    }
    case "compile":
      if (!args.length && !o.pending) throw usage("Usage : cortex compile <id…> | --pending [--batch]");
      finish(await (await import("./agent")).compileCtx(wiki, args, { pending: o.pending, batch: o.batch }, print));
      break;
    case "ask": {
      const q = args.join(" ");
      if (!q) throw usage('Usage : cortex ask "<question>" [--file]');
      finish(await (await import("./agent")).askCtx(wiki, q, { file: o.file, interactive: o.interactive }, print));
      break;
    }
    case "export": {
      const { exportSite } = await import("./export"); // Vite, Svelte and force-graph are only loaded here
      await exportSite(root, o.out ?? join(root, ".cortex/site"));
      break;
    }
    case "mcp":
      await (await import("./mcp")).serveMcp(root); // loaded on demand; stays open as long as the client reads stdin
      break;
    case "schema": {
      const { schemaText, writeSchema } = await import("./schema");
      if (o.write) console.log(`${paint.ok("✓")} ${(await writeSchema(root, true)).file} écrit.`);
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
