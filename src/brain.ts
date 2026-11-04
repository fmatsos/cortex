#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join } from "node:path";
import { add } from "./add";
import { renderIndex } from "./index";
import { search } from "./search";
import { findRoot } from "./lib";

const HELP = `brain — second cerveau (étape 1)

  brain add <url|fichier|-> --note "pourquoi je garde ça" [--dry-run]
  brain search "<requête>" [--in wiki|raw] [--json] [--limit N]
  brain index

Racine : $BRAIN_ROOT, sinon le premier dossier parent qui contient BRAIN.md.`;

const { values: o, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    note: { type: "string" }, "dry-run": { type: "boolean" }, in: { type: "string" },
    json: { type: "boolean" }, limit: { type: "string" }, help: { type: "boolean", short: "h" },
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
          if (r.duplicate || !r.ex) console.log(`= déjà présent : ${r.id}`);
          else console.log(`${o["dry-run"] ? "~ (dry-run)" : "+"} ${r.id}  [${r.ex.extractor}${r.ex.partial ? ", partiel" : ""}] ${r.ex.content.split(/\s+/).length} mots`);
        } catch (e) {
          console.error(`✗ ${(e as Error).message}`);
          process.exitCode = 1;
        }
      }
      if (!o.note && !o["dry-run"]) console.error("! note manquante : à renseigner avant compilation (BRAIN.md).");
      break;
    }
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
      await Bun.write(join(root, "wiki/index.md"), await renderIndex(root));
      console.log("wiki/index.md régénéré.");
      break;
    default:
      console.log(HELP);
      if (cmd && !o.help) process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
}
