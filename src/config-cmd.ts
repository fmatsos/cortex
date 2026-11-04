import { CONFIG_KEYS, configFile, lintConfig, readConfig, type ConfigIssue } from "./config";
import { paint } from "./style";

/** cortex config init|lint|get|set|remove. Every write is validated before being made. */
export async function configCmd(root: string, [sub, key, value]: string[]): Promise<number> {
  const f = configFile(root);
  const save = async (c: Record<string, unknown>) => {
    const e = lintConfig(c).filter((i) => i.level === "error");
    if (e.length) throw new Error(e.map((i) => i.msg).join(" "));
    await Bun.write(f, JSON.stringify(c, null, 2) + "\n");
  };
  const checkKey = () => {
    if (!(CONFIG_KEYS as readonly string[]).includes(key ?? "")) throw new Error(`Propriété attendue : ${CONFIG_KEYS.join(", ")}.`);
  };
  switch (sub) {
    case "init": {
      // key = client (optional): it also picks the agent file written next to cortex.json (CLAUDE.md or AGENTS.md)
      if (await f.exists()) throw new Error("cortex.json existe déjà.");
      await save({ client: key ?? null, model: null, effort: null, language: null, schema: null, raw_path: null, page_path: null }); // null = unset: defaults
      console.log(`${paint.ok("✓")} cortex.json créé${key ? ` (client ${key})` : " (agnostique)"}.`);
      const { writeSchema } = await import("./schema");
      const w = await writeSchema(root, false);
      console.log(w.written ? `${paint.ok("✓")} ${w.file} créé : le schéma que suit l'agent.` : `${paint.dim("=")} ${w.file} existe déjà : inchangé (cortex schema --write le remplace).`);
      return 0;
    }
    case "lint": {
      if (!(await f.exists())) { console.log("Pas de cortex.json : mode agnostique."); return 0; }
      let issues: ConfigIssue[];
      try { issues = lintConfig(await readConfig(root)); } catch (e) { issues = [{ level: "error", msg: (e as Error).message }]; }
      for (const i of issues) console.log(`${i.level === "error" ? paint.error("✗") : paint.warn("!")} ${i.msg}`);
      if (!issues.length) console.log(`${paint.ok("✓")} cortex.json valide.`);
      return issues.some((i) => i.level === "error") ? 1 : 0;
    }
    case "get": {
      const c = await readConfig(root);
      if (!key) { console.log(JSON.stringify(c, null, 2)); return 0; }
      checkKey();
      if (c[key] != null) console.log(c[key]);
      return 0;
    }
    case "set":
      checkKey();
      if (!value) throw new Error(`Usage : cortex config set ${key} <valeur>`);
      await save({ ...(await readConfig(root)), [key]: value });
      return 0;
    case "remove": {
      checkKey();
      const c = await readConfig(root);
      delete c[key];
      await save(c);
      return 0;
    }
    default:
      throw new Error("Usage : cortex config init [claude|codex|opencode] | lint | get [clé] | set <clé> <valeur> | remove <clé>");
  }
}
