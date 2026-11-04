import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * T11: every command that runs offline, spawned for real in a temp wiki. For each one: stdout / stderr / exit code
 * on success, on a usage error (exit 2) and on a domain error (exit 1). Colors are off (NO_COLOR) so lines compare as text.
 */

const CLI = join(import.meta.dir, "cortex.ts");

/** A fresh wiki root with a minimal cortex.json (no client: the agnostic backend, driven by $CORTEX_AGENT_BATCH). */
function wiki() {
  const root = mkdtempSync(join(tmpdir(), "cortex-t11-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  return root;
}

function cortex(root: string, args: string[], opts: { stdin?: string; env?: Record<string, string>; cwd?: string } = {}) {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", CORTEX_ROOT: root, ...opts.env };
  delete env.CORTEX_AGENT; // never reach a real agent from a test
  if (!opts.env?.CORTEX_AGENT_BATCH) delete env.CORTEX_AGENT_BATCH;
  const p = Bun.spawnSync(["bun", CLI, ...args], { env, cwd: opts.cwd, stdin: opts.stdin === undefined ? undefined : Buffer.from(opts.stdin) });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** Adds `text` as a note through `cortex add -` and returns the raw id. */
function addNote(root: string, text = "# Une note\n\nUne idée sur la fermentation lactique des légumes.\n") {
  const r = cortex(root, ["add", "-", "--note", "pourquoi"], { stdin: text });
  expect(r.code).toBe(0);
  return r.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/)![0];
}

describe("add", () => {
  test("a local file and stdin text are added; the missing note is flagged", () => {
    const root = wiki();
    writeFileSync(join(root, "n.md"), "# Ma note\n\nUne idée.\n");
    const file = cortex(root, ["add", "n.md", "--note", "ma note"], { cwd: root });
    expect(file.code).toBe(0);
    expect(file.out).toMatch(/^\+ [0-9a-f-]{36} {2}\[manual\] \d+ mots?\n$/);
    expect(file.err).toBe("");

    const stdin = cortex(root, ["add", "-"], { stdin: "Texte libre sans note, assez différent du premier.\n" });
    expect(stdin.code).toBe(0);
    expect(stdin.out).toStartWith("+ ");
    expect(stdin.err).toBe("! note manquante : à renseigner avant compilation.\n");

    const again = cortex(root, ["add", "n.md", "--note", "ma note"], { cwd: root });
    expect(again.code).toBe(0); // idempotent: the existing id comes back
    expect(again.out).not.toStartWith("+ ");
  });
  test("usage error: no input → 2", () => {
    const r = cortex(wiki(), ["add"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe('✗ Usage : cortex add <url|fichier|-> --note "…"\n');
    expect(r.out).toBe("");
  });
  test("domain error: unknown file → 1", () => {
    const r = cortex(wiki(), ["add", "absent.md", "--note", "x"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("✗ Fichier introuvable : absent.md\n");
    expect(r.out).toBe("");
  });
});

describe("inbox", () => {
  test("success: an empty inbox, then a file leaving it", () => {
    const root = wiki();
    const empty = cortex(root, ["inbox"]);
    expect(empty).toEqual({ code: 0, out: "Inbox vide.\n", err: "" });

    mkdirSync(join(root, "inbox"));
    writeFileSync(join(root, "inbox/idee.md"), "# Idée\n\nUne idée sur la lacto-fermentation, assez longue.\n");
    writeFileSync(join(root, "inbox/idee.md.note"), "ma note\n");
    const dry = cortex(root, ["inbox", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("(dry-run, inbox inchangée) 1 ajouté(s), 0 déjà présent(s), 0 échec(s).");
    expect(existsSync(join(root, "inbox/idee.md"))).toBe(true);

    const r = cortex(root, ["inbox"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\+ [0-9a-f-]{36} {2}\[manual\] .*← idee\.md\n1 ajouté\(s\), 0 déjà présent\(s\), 0 échec\(s\)\.\n$/);
    expect(r.err).toBe("");
    expect(existsSync(join(root, "inbox/idee.md"))).toBe(false);
  });
  test("usage error: unknown option → 2", () => {
    const r = cortex(wiki(), ["inbox", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("option inconnue : --bogus");
  });
  test("domain error: an entry that is not an URL stays and fails → 1", () => {
    const root = wiki();
    mkdirSync(join(root, "inbox"));
    writeFileSync(join(root, "inbox/urls.txt"), "pas-une-url\n");
    const r = cortex(root, ["inbox"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("✗ pas-une-url : pas une URL http(s)\n");
    expect(r.out).toBe("0 ajouté(s), 0 déjà présent(s), 1 échec(s).\n");
  });
});

describe("search", () => {
  test("success: a hit in raw/ suggests compiling; no hit says so; --json is parseable", () => {
    const root = wiki();
    addNote(root);
    const hit = cortex(root, ["search", "fermentation"]);
    expect(hit.code).toBe(0);
    expect(hit.out).toContain("raw ");
    expect(hit.out).toContain("→ Trouvé seulement dans raw/ : un trou à compiler ?");
    const none = cortex(root, ["search", "zzzzzz"]);
    expect(none).toEqual({ code: 0, out: "Aucun résultat.\n", err: "" });
    expect(JSON.parse(cortex(root, ["search", "fermentation", "--json"]).out)).toHaveLength(1);
  });
  test("usage error: no query, bad --in → 2", () => {
    const none = cortex(wiki(), ["search"]);
    expect(none.code).toBe(2);
    expect(none.err).toBe('✗ Usage : cortex search "<requête>"\n');
    const area = cortex(wiki(), ["search", "x", "--in", "ailleurs"]);
    expect(area.code).toBe(2);
    expect(area.err).toBe("✗ --in attend wiki ou raw\n");
  });
});

describe("new", () => {
  test("success: prints the page path, which exists", () => {
    const root = wiki();
    const r = cortex(root, ["new", "Concept", "Mon concept"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^wiki\/concepts\/[0-9a-f-]{36}\.md\n$/);
    expect(r.err).toBe("");
    expect(existsSync(join(root, r.out.trim()))).toBe(true);
  });
  test("usage error: wrong arity → 2", () => {
    const r = cortex(wiki(), ["new", "Concept"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe('✗ Usage : cortex new <Source|Concept|Entity|Synthesis> "<titre>"\n');
  });
  test("domain error: unknown type → 1", () => {
    const r = cortex(wiki(), ["new", "Bogus", "x"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("✗ type inconnu : Bogus (Source | Concept | Entity | Synthesis)\n");
    expect(r.out).toBe("");
  });
});

describe("index", () => {
  test("success: index.md and log.md are regenerated", () => {
    const root = wiki();
    const r = cortex(root, ["index"]);
    expect(r).toEqual({ code: 0, out: "✓ wiki/index.md et wiki/log.md régénérés.\n", err: "" });
    expect(existsSync(join(root, "wiki/index.md"))).toBe(true);
  });
  test("usage error: unknown option → 2", () => {
    expect(cortex(wiki(), ["index", "--bogus"]).code).toBe(2);
  });
  test("domain error: not inside a wiki → 1", () => {
    const empty = mkdtempSync(join(tmpdir(), "cortex-t11-nowiki-"));
    const r = cortex("", ["index"], { cwd: empty, env: { CORTEX_ROOT: "" } });
    expect(r.code).toBe(1);
    expect(r.err).toStartWith("✗ cortex.json introuvable");
    expect(r.out).toBe("");
  });
});

describe("lint", () => {
  test("success: a clean wiki exits 0; --json is an array", () => {
    const root = wiki();
    const r = cortex(root, ["lint"]);
    expect(r).toEqual({ code: 0, out: "0 erreur(s), 0 avertissement(s), 0 page(s) jamais relue(s).\n", err: "" });
    expect(JSON.parse(cortex(root, ["lint", "--json"]).out)).toEqual([]);
  });
  test("usage error: unknown option → 2", () => {
    expect(cortex(wiki(), ["lint", "--bogus"]).code).toBe(2);
  });
  test("domain error: a page without description → 1", () => {
    const root = wiki();
    const page = cortex(root, ["new", "Concept", "Sans description"]).out.trim();
    const r = cortex(root, ["lint"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${page} : description manquante`);
    expect(r.out).toContain("1 erreur(s)");
    expect(cortex(root, ["lint", "--json"]).code).toBe(1);
  });
});

describe("log", () => {
  test("success: empty journal, add an entry, read it back", () => {
    const root = wiki();
    expect(cortex(root, ["log"])).toEqual({ code: 0, out: "Journal vide.\n", err: "" });
    const add = cortex(root, ["log", "add", "update", "une entrée"]);
    expect(add.code).toBe(0);
    expect(add.out).toMatch(/^\+ \d{4}-\d\d-\d\dT\S+ Update : une entrée\n$/);
    const list = cortex(root, ["log"]);
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d {2}Update {2}une entrée\n$/);
    expect(JSON.parse(cortex(root, ["log", "--json", "--kind", "update"]).out)).toHaveLength(1);
  });
  test("usage error: bad --limit, bad --kind, incomplete log add → 2", () => {
    const root = wiki();
    expect(cortex(root, ["log", "--limit", "abc"]).code).toBe(2);
    expect(cortex(root, ["log", "--kind", "zz"]).err).toBe("✗ --kind attend add | ingest | query | lint | update\n");
    expect(cortex(root, ["log", "add", "update"]).code).toBe(2);
  });
  test("domain error: unknown kind, unknown source → 1, nothing written", () => {
    const root = wiki();
    const kind = cortex(root, ["log", "add", "nope", "x"]);
    expect(kind.code).toBe(1);
    expect(kind.err).toBe("✗ kind inconnu : nope (add | ingest | query | lint | update)\n");
    expect(cortex(root, ["log", "add", "update", "x", "--page", "wiki/absente.md"]).code).toBe(1);
    expect(cortex(root, ["log"]).out).toBe("Journal vide.\n");
  });
});

describe("config", () => {
  test("success: init, get, set, remove, lint", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-t11-cfg-"));
    const init = cortex(root, ["config", "init", "codex"]);
    expect(init).toEqual({ code: 0, out: "✓ cortex.json créé (client codex).\n✓ AGENTS.md créé : le schéma que suit l'agent.\n", err: "" });
    expect(cortex(root, ["config", "get", "client"])).toEqual({ code: 0, out: "codex\n", err: "" });
    expect(JSON.parse(cortex(root, ["config", "get"]).out).client).toBe("codex");
    expect(cortex(root, ["config", "set", "effort", "low"])).toEqual({ code: 0, out: "", err: "" });
    expect(cortex(root, ["config", "get", "effort"]).out).toBe("low\n");
    expect(cortex(root, ["config", "remove", "effort"]).code).toBe(0);
    expect(cortex(root, ["config", "get", "effort"]).out).toBe("");
    expect(cortex(root, ["config", "lint"])).toEqual({ code: 0, out: "✓ cortex.json valide.\n", err: "" });
  });
  test("agnostic mode: lint without cortex.json", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-t11-cfg-"));
    expect(cortex(root, ["config", "lint"])).toEqual({ code: 0, out: "Pas de cortex.json : mode agnostique.\n", err: "" });
  });
  test("usage error: unknown subcommand, unknown key, missing value → 2", () => {
    const root = wiki();
    expect(cortex(root, ["config", "bogus"]).code).toBe(2);
    const key = cortex(root, ["config", "set", "couleur", "x"]);
    expect(key.code).toBe(2);
    expect(key.err).toStartWith("✗ Propriété attendue : client, model, effort");
    expect(cortex(root, ["config", "set", "client"]).code).toBe(2);
  });
  test("domain error: invalid value, existing cortex.json, broken cortex.json → 1", () => {
    const root = wiki();
    cortex(root, ["config", "set", "client", "codex"]);
    const effort = cortex(root, ["config", "set", "effort", "turbo"]);
    expect(effort.code).toBe(1);
    expect(effort.err).toContain("invalide pour codex");
    const again = cortex(root, ["config", "init"]);
    expect(again.code).toBe(1);
    expect(again.err).toBe("✗ cortex.json existe déjà.\n");
    writeFileSync(join(root, "cortex.json"), "{ pas du json");
    const lint = cortex(root, ["config", "lint"]);
    expect(lint.code).toBe(1);
    expect(lint.out).toStartWith("✗ ");
  });
});

describe("schema", () => {
  test("success: prints the schema; --write writes the agent file", () => {
    const root = wiki();
    const r = cortex(root, ["schema"]);
    expect(r.code).toBe(0);
    expect(r.out).toStartWith("# Cortex schema");
    expect(r.err).toBe("");
    expect(cortex(root, ["schema", "--write"])).toEqual({ code: 0, out: "✓ CLAUDE.md écrit.\n", err: "" });
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
  });
  test("usage error: unknown option → 2", () => {
    expect(cortex(wiki(), ["schema", "--bogus"]).code).toBe(2);
  });
  test("domain error: the configured schema file is missing → 1", () => {
    const root = wiki();
    cortex(root, ["config", "set", "schema", "absent.md"]);
    const r = cortex(root, ["schema"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("schéma introuvable");
    expect(r.out).toBe("");
  });
});

describe("help", () => {
  test("--help exits 0, an unknown command prints the help and exits 1", () => {
    const root = wiki();
    expect(cortex(root, ["--help"]).code).toBe(0);
    expect(cortex(root, ["--help"]).out).toStartWith("cortex — second cerveau");
    const bad = cortex(root, ["bogus"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toStartWith("cortex — second cerveau");
  });
});

// compile / ask drive an agent: a fake script stands in (the agnostic backend runs $CORTEX_AGENT_BATCH under bubblewrap on Linux).
describe.skipIf(process.platform === "linux" && !Bun.which("bwrap"))("compile / ask with a fake agent", () => {
  function agent(script: string) {
    const f = join(mkdtempSync(join(tmpdir(), "cortex-t11-agent-")), "agent.sh");
    writeFileSync(f, `#!/bin/sh\n${script}\n`);
    chmodSync(f, 0o755);
    return { CORTEX_AGENT_BATCH: f };
  }
  const silent = () => agent("cat >/dev/null");

  test("compile usage error: nothing to compile → 2", () => {
    const r = cortex(wiki(), ["compile"], { env: silent() });
    expect(r.code).toBe(2);
    expect(r.err).toBe("✗ Usage : cortex compile <id…> | --pending [--batch]\n");
  });
  test("compile success path without work: nothing pending → 0", () => {
    const r = cortex(wiki(), ["compile", "--pending", "--batch"], { env: silent() });
    expect(r).toEqual({ code: 0, out: "Rien à compiler.\n", err: "" });
  });
  test("compile domain error: unknown id → 1", () => {
    const r = cortex(wiki(), ["compile", "inconnu", "--batch"], { env: silent() });
    expect(r.code).toBe(1);
    expect(r.err).toBe("✗ Source introuvable : inconnu\n");
  });
  test("compile domain error: empty note → 1", () => {
    const root = wiki();
    const id = cortex(root, ["add", "-"], { stdin: "Texte sans note.\n" }).out.match(/[0-9a-f-]{36}/)![0];
    const r = cortex(root, ["compile", id, "--batch"], { env: silent() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(`✗ ${id} : note vide.`);
  });
  test("compile domain error: the agent writes no Source page → 1, status unchanged", () => {
    const root = wiki();
    const id = addNote(root);
    const r = cortex(root, ["compile", id, "--batch"], { env: silent() });
    expect(r.code).toBe(1);
    expect(r.out).toStartWith(`→ compile ${id} (batch)\n`);
    expect(r.err).toContain(`✗ ${id} : aucune page Source ne cite la source (agent sorti avec 0) ; statut inchangé.`);
    const [source] = [...new Bun.Glob("raw/**/source.md").scanSync({ cwd: root })];
    expect(readFileSync(join(root, source), "utf8")).toContain("status: pending");
  });
  test("ask usage error: no question → 2", () => {
    const r = cortex(wiki(), ["ask"], { env: silent() });
    expect(r.code).toBe(2);
    expect(r.err).toBe('✗ Usage : cortex ask "<question>" [--file]\n');
  });
  test("ask success: the agent answer is printed → 0", () => {
    const r = cortex(wiki(), ["ask", "quoi ?"], { env: agent("cat >/dev/null; echo réponse") });
    expect(r.code).toBe(0);
    expect(r.out).toBe("réponse\n");
  });
  test("ask domain error: the agent fails → 1", () => {
    const r = cortex(wiki(), ["ask", "quoi ?"], { env: agent("cat >/dev/null; exit 3") });
    expect(r.code).toBe(1);
    expect(r.err).toContain("✗ ");
    expect(r.err).toContain("sorti en erreur");
  });
});
