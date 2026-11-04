#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { add, describe } from "./add";
import { inbox } from "./inbox";
import { regenerate } from "./index";
import { KINDS, kindLabel, logAdd, newestFirst, readLog } from "./log";
import { search } from "./search";
import { lint } from "./lint";
import { ask, compile } from "./agent";
import { configCmd } from "./backends/index";
import { findRoot } from "./lib";

const HELP = `brain — second cerveau

  brain add <url|fichier|-> --note "pourquoi je garde ça" [--dry-run]
  brain inbox [--dry-run]   (add sur inbox/ : urls.txt et fichiers ; les entrées réussies en sortent)
  brain search "<requête>" [--in wiki|raw] [--json] [--limit N]
  brain index
  brain lint [--json]
  brain log [--limit N] [--json] [--kind k]     (le journal, du plus récent au plus ancien ; défaut 20 entrées)
  brain log add <add|ingest|query|lint|update> "<texte>" [--source <id raw>]… [--page <wiki/….md>]…
  brain compile <id…> | --pending [--batch]   (interactif par défaut ; --batch : pages en draft)
  brain ask "<question>" [--file] [--interactive]
  brain export [--out <dossier>]               (le wiki en site HTML interactif ; défaut : .brain/site)
  brain mcp                                   (serveur MCP stdio : search, get, related, lint, add, log)
  brain config init | lint | get [clé] | set <clé> <valeur> | remove <clé>   (clés : client, model, effort)

Agent : config.json (client claude|codex|opencode, model, effort). Sans client :
$BRAIN_AGENT (interactif, défaut « claude »), $BRAIN_AGENT_BATCH (défaut « claude -p »).

Racine : $BRAIN_ROOT, sinon le premier dossier parent qui contient BRAIN.md.`;

const { values: o, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    note: { type: "string" }, "dry-run": { type: "boolean" }, in: { type: "string" },
    json: { type: "boolean" }, limit: { type: "string" }, pending: { type: "boolean" }, batch: { type: "boolean" },
    file: { type: "boolean" }, kind: { type: "string" }, source: { type: "string", multiple: true }, page: { type: "string", multiple: true }, out: { type: "string" }, interactive: { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});

try {
  const root = findRoot();
  switch (cmd) {
    case "add": {
      if (!args[0]) throw new Error("Usage : brain add <url|fichier|-> --note \"…\"");
      for (const input of args) {
        try {
          const r = await add(root, input, { note: o.note, dryRun: o["dry-run"] });
          console.log(describe(r, o["dry-run"]));
        } catch (e) {
          console.error(`✗ ${(e as Error).message}`);
          process.exitCode = 1;
        }
      }
      if (!o.note && !o["dry-run"]) console.error("! note manquante : à renseigner avant compilation (BRAIN.md).");
      break;
    }
    case "inbox":
      process.exitCode = await inbox(root, { dryRun: o["dry-run"] });
      break;
    case "search": {
      const q = args.join(" ");
      if (!q) throw new Error('Usage : brain search "<requête>"');
      if (o.in && o.in !== "wiki" && o.in !== "raw") throw new Error("--in attend wiki ou raw");
      const hits = await search(root, q, { in: o.in as any, limit: o.limit ? Number(o.limit) : undefined });
      if (o.json) { console.log(JSON.stringify(hits, null, 2)); break; }
      if (!hits.length) console.log("Aucun résultat.");
      for (const h of hits) console.log(`${h.area === "raw" ? "raw " : "wiki"}  /${h.path}  ${h.title}\n      ${h.snippet.replace(/\s+/g, " ")}`);
      if (o.in !== "raw" && hits.length && hits.every((h) => h.area === "raw")) console.log("\n→ Trouvé seulement dans raw/ : un trou à compiler ?");
      break;
    }
    case "index":
      await regenerate(root);
      console.log("wiki/index.md et wiki/log.md régénérés.");
      break;
    case "log": {
      // `add` n'est le sous-commande que juste après `log` : `brain log --json add …` ne doit rien écrire (les gardes des agents reposent là-dessus)
      const raw = process.argv.slice(2);
      if (args[0] === "add" && raw[raw.indexOf("log") + 1] === "add") {
        const [, kind, ...text] = args;
        if (!kind || !text.length) throw new Error(`Usage : brain log add <${KINDS.join("|")}> "<texte>" [--source <id>]… [--page <chemin>]…`);
        const e = await logAdd(root, kind, text.join(" "), o.source, o.page);
        console.log(`+ ${e.at} ${kindLabel(e.kind)} : ${e.text}`);
        break;
      }
      if (args.length) throw new Error(`Usage : brain log [--limit N] [--json] [--kind k] | brain log add …`);
      if (o.kind && !KINDS.includes(o.kind as any)) throw new Error(`--kind attend ${KINDS.join(" | ")}`);
      const { entries, errors } = readLog(root);
      for (const x of errors) console.error(`! wiki/log.jsonl:${x.line} : ${x.msg}`);
      const shown = newestFirst(entries.filter((e) => !o.kind || e.kind === o.kind)).slice(0, o.limit ? Number(o.limit) : 20);
      if (o.json) { console.log(JSON.stringify(shown, null, 2)); break; }
      if (!shown.length) console.log("Journal vide.");
      for (const e of shown) console.log(`${e.at.slice(0, 16).replace("T", " ")}  ${kindLabel(e.kind).padEnd(6)}  ${e.text}`);
      break;
    }
    case "lint": {
      const issues = await lint(root);
      if (o.json) console.log(JSON.stringify(issues, null, 2));
      else {
        const icon = { error: "✗", warning: "!", info: "·" };
        for (const i of issues.filter((i) => i.level !== "info")) console.log(`${icon[i.level]} ${i.path} : ${i.msg}`);
        const n = (l: string) => issues.filter((i) => i.level === l).length;
        console.log(`${n("error")} erreur(s), ${n("warning")} avertissement(s), ${n("info")} page(s) jamais relue(s).`);
      }
      if (issues.some((i) => i.level === "error")) process.exitCode = 1;
      break;
    }
    case "compile":
      if (!args.length && !o.pending) throw new Error("Usage : brain compile <id…> | --pending [--batch]");
      await compile(root, args, { pending: o.pending, batch: o.batch });
      break;
    case "ask": {
      const q = args.join(" ");
      if (!q) throw new Error('Usage : brain ask "<question>" [--file]');
      await ask(root, q, { file: o.file, interactive: o.interactive });
      break;
    }
    case "export": {
      const { exportSite } = await import("./export"); // Vite, Svelte et force-graph ne se chargent qu'ici
      await exportSite(root, o.out ?? join(root, ".brain/site"));
      break;
    }
    case "mcp":
      (await import("./mcp")).serveMcp(root); // chargé à la demande ; reste ouvert tant que le client lit stdin
      break;
    case "config":
      process.exitCode = await configCmd(root, args);
      break;
    default:
      console.log(HELP);
      if (cmd && !o.help) process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
}
