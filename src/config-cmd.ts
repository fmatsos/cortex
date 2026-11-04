import { CONFIG_KEYS, configFile, lintConfig, readConfig, type ConfigIssue } from "./config";
import { CortexError } from "./lib";
import { collector, type Result } from "./print";
import { paint } from "./style";

/** cortex config init|lint|get|set|remove. Every write is validated before being made. Returns what to print; throws on misuse. */
export async function configCmd(root: string, [sub, key, value]: string[]): Promise<Result> {
  const { say, done } = collector();
  const f = configFile(root);
  const save = async (c: Record<string, unknown>) => {
    const e = lintConfig(c).filter((i) => i.level === "error");
    if (e.length) throw new Error(e.map((i) => i.msg).join(" "));
    await Bun.write(f, JSON.stringify(c, null, 2) + "\n");
  };
  const checkKey = () => {
    if (!(CONFIG_KEYS as readonly string[]).includes(key ?? "")) throw new CortexError(`Propriété attendue : ${CONFIG_KEYS.join(", ")}.`, "usage");
  };
  switch (sub) {
    case "init": {
      // key = client (optional): it also picks the agent file written next to cortex.json (CLAUDE.md or AGENTS.md)
      if (await f.exists()) throw new Error("cortex.json existe déjà.");
      await save({ client: key ?? null, model: null, effort: null, language: null, schema: null, raw_path: null, page_path: null }); // null = unset: defaults
      say("ok", `cortex.json créé${key ? ` (client ${key})` : " (agnostique)"}.`);
      const { writeSchema } = await import("./schema");
      const w = await writeSchema(root, false);
      if (w.written) say("ok", `${w.file} créé : le schéma que suit l'agent.`);
      else say("info", `${paint.dim("=")} ${w.file} existe déjà : inchangé (cortex schema --write le remplace).`);
      return done(true);
    }
    case "lint": {
      if (!(await f.exists())) { say("info", "Pas de cortex.json : mode agnostique."); return done(true); }
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
      if (!value) throw new CortexError(`Usage : cortex config set ${key} <valeur>`, "usage");
      await save({ ...(await readConfig(root)), [key]: value });
      return done(true);
    case "remove": {
      checkKey();
      const c = await readConfig(root);
      delete c[key];
      await save(c);
      return done(true);
    }
    default:
      throw new CortexError("Usage : cortex config init [claude|codex|opencode] | lint | get [clé] | set <clé> <valeur> | remove <clé>", "usage");
  }
}
