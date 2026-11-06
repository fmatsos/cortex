import { renameSync } from "node:fs";
import { CONFIG_KEYS, configFile, lintConfig, readConfig, type ConfigIssue } from "./config";
import { CortexError } from "./lib";
import { collector, type Result } from "./print";
import { paint } from "./style";

/** Keys whose value is a number in cortex.json: `set` writes `6`, not `"6"`. */
const NUMBERS = new Set(["max_tags", "fetch_timeout"]);

/** cortex config init|lint|get|set|remove. Every write is validated before being made. Returns what to print; throws on misuse. */
export async function configCmd(root: string, [sub, key, value]: string[]): Promise<Result> {
  const { say, done } = collector();
  const f = configFile(root);
  const save = async (c: Record<string, unknown>) => {
    const e = lintConfig(c).filter((i) => i.level === "error");
    if (e.length) throw new Error(e.map((i) => i.msg).join(" "));
    // tmp + rename: cortex.json marks the root, a half-written one would break every command
    await Bun.write(`${f.name}.tmp`, JSON.stringify(c, null, 2) + "\n");
    renameSync(`${f.name}.tmp`, f.name!);
  };
  const checkKey = () => {
    if (!(CONFIG_KEYS as readonly string[]).includes(key ?? "")) throw new CortexError(`Expected a property: ${CONFIG_KEYS.join(", ")}.`, "usage");
  };
  switch (sub) {
    case "init": {
      // key = client (optional): it also picks the agent file written next to cortex.json (CLAUDE.md or AGENTS.md)
      if (await f.exists()) throw new Error("cortex.json already exists.");
      await save({ client: key ?? null, model: null, effort: null, base_url: null, language: null, schema: null, raw_path: null, page_path: null, max_tags: null, fetch_timeout: null }); // null = unset: defaults
      say("ok", `cortex.json created${key ? ` (client ${key})` : " (agnostic)"}.`);
      const { writeSchema } = await import("./schema");
      const w = await writeSchema(root, false);
      if (w.written) say("ok", `${w.file} created: the schema the agent follows.`);
      else say("info", `${paint.dim("=")} ${w.file} already exists: unchanged (cortex schema --write replaces it).`);
      return done(true);
    }
    case "lint": {
      if (!(await f.exists())) { say("info", "No cortex.json: agnostic mode."); return done(true); }
      let issues: ConfigIssue[];
      try { issues = lintConfig(await readConfig(root)); } catch (e) { issues = [{ level: "error", msg: (e as Error).message }]; }
      for (const i of issues) say("info", `${i.level === "error" ? paint.error("✗") : paint.warn("!")} ${i.msg}`); // stdout, as before
      if (!issues.length) say("ok", "cortex.json valide.");
      return done(!issues.some((i) => i.level === "error"));
    }
    case "get": {
      const c = await readConfig(root);
      if (!key) { say("info", JSON.stringify(c, null, 2)); return done(true); }
      checkKey();
      if (c[key] != null) say("info", String(c[key]));
      return done(true);
    }
    case "set":
      checkKey();
      if (!value) throw new CortexError(`Usage: cortex config set ${key} <value>`, "usage");
      await save({ ...(await readConfig(root)), [key]: NUMBERS.has(key) && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value });
      return done(true);
    case "remove": {
      checkKey();
      const c = await readConfig(root);
      delete c[key];
      await save(c);
      return done(true);
    }
    default:
      throw new CortexError("Usage: cortex config init [claude|codex|opencode|openai] | lint | get [key] | set <key> <value> | remove <key>", "usage");
  }
}
