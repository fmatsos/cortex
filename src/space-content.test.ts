import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { compileCtx } from "./agent";
import { openWiki } from "./context";
import { inbox } from "./inbox";

/** What a space holds (resources, notes, both) decides which sources it takes: the kind of a source, the refusal, the skips. */

const CLI = join(import.meta.dir, "cortex.ts");
const cortex = (cwd: string, args: string[], stdin?: string) => {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CORTEX_ROOT", "CORTEX_SPACE", "CORTEX_WIKI", "CORTEX_AGENT", "CORTEX_AGENT_BATCH"]) delete env[k];
  const p = Bun.spawnSync(["bun", CLI, ...args], { cwd, env, stdin: stdin === undefined ? undefined : Buffer.from(stdin) });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
/** An instance with spaces: `resources` (default content), `pro` (notes), `mix` (both); `legacy: true` for a wiki at the root. */
function instance(legacy = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cortex-content-")));
  writeFileSync(join(root, "cortex.json"), JSON.stringify(legacy ? {} : { default_space: "veille", spaces: { pro: { content: ["notes"] }, mix: { content: ["notes", "resources"] } } }));
  for (const base of legacy ? [root] : ["veille", "pro", "mix"].map((n) => join(root, "spaces", n))) { mkdirSync(join(base, "wiki"), { recursive: true }); mkdirSync(join(base, "raw"), { recursive: true }); }
  return { root, dir: (n: string) => (legacy ? root : join(root, "spaces", n)) };
}
const sources = async (dir: string) => (await openWiki(dir).raws()).map((d) => ({ content: d.fm.content, kind: d.fm.kind, status: d.fm.status }));
const page = `<html><head><title>Page de test</title></head><body><article><h1>Page de test</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante mots, sans rien dire de plus que le strict nécessaire à ce test.</p>".repeat(8)}</article></body></html>`;

describe("kind of a raw source", () => {
  test("a URL, a PDF or a captured page is a resource; stdin, a text file or a text take what the space holds (a note when it holds both); --as overrides; one field `content`, `kind` stays", async () => {
    const { dir } = instance();
    const mix = dir("mix"), srv = Bun.serve({ port: 0, fetch: () => new Response(page, { headers: { "content-type": "text/html" } }) });
    try {
      writeFileSync(join(mix, "doc.md"), "# Un document\n\nUn texte de référence copié d'ailleurs, assez distinct des autres.\n");
      writeFileSync(join(mix, "doc2.md"), "# Mon journal\n\nCe que j'ai écrit moi-même aujourd'hui, un autre texte.\n");
      expect(cortex(mix, ["add", "-", "--note", "n"], "Ce que j'ai noté: appeler Marie vendredi.\n").code).toBe(0);
      expect(cortex(mix, ["add", "doc.md", "--note", "n"]).code).toBe(0);
      expect(cortex(mix, ["add", "doc2.md", "--as", "resource", "--note", "n"]).code).toBe(0);
      expect(cortex(mix, ["add", "-", "--as", "resource", "--note", "n"], "Un extrait collé d'un article, pour la veille.\n").code).toBe(0);
      expect((await add(mix, `http://127.0.0.1:${srv.port}/`, { note: "n" })).duplicate).toBe(false);
      expect((await add(mix, "-", { text: "Un texte passé sans stdin, comme le fait le serveur MCP.", note: "n" })).duplicate).toBe(false);
      expect((await add(mix, "-", { text: "Une page capturée par le navigateur, avec son origine.", url: "https://example.org/page", note: "n" })).duplicate).toBe(false);
    } finally { srv.stop(true); }
    const all = await sources(mix);
    expect(all.map((s) => s.content).sort()).toEqual(["note", "note", "note", "resource", "resource", "resource", "resource"]);
    expect(all.filter((s) => s.kind === "note")).toHaveLength(5); // `kind` is the old field (note for text), left as it was
    expect(all.every((s) => s.status === "pending")).toBe(true);
    const bad = cortex(mix, ["add", "-", "--as", "memo"], "x");
    expect([bad.code, bad.err]).toEqual([2, expect.stringContaining("--as expects resource or note")]);
  });

  test("in a space with one content, an ambiguous input takes that content and is never refused", async () => {
    const { dir } = instance(), veille = dir("veille"), pro = dir("pro");
    for (const root of [veille, pro]) {
      writeFileSync(join(root, "doc.md"), "# Un fichier\n\nUn fichier texte, à ranger selon l'espace.\n");
      expect(cortex(root, ["add", "-", "--note", "n"], "Un texte venu de stdin, à ranger selon l'espace.\n").code).toBe(0);
      expect(cortex(root, ["add", "doc.md", "--note", "n"]).code).toBe(0);
    }
    expect((await sources(veille)).map((s) => s.content)).toEqual(["resource", "resource"]);
    expect((await sources(pro)).map((s) => s.content)).toEqual(["note", "note"]);
  });
});

describe("a kind the space does not hold is refused, then skipped", () => {
  test("CLI: a notes space refuses a URL (before any fetch), an explicit --as of a content the space leaves out is refused, --dry-run says what would happen", async () => {
    const { dir } = instance(), veille = dir("veille"), pro = dir("pro");
    let hits = 0;
    const srv = Bun.serve({ port: 0, fetch: () => (hits++, new Response(page, { headers: { "content-type": "text/html" } })) });
    try {
      const note = cortex(veille, ["add", "-", "--as", "note", "--note", "n"], "Une note perso, pas une ressource.\n");
      expect([note.code, note.err]).toEqual([1, expect.stringContaining("space veille holds resources, not notes: this source is a note")]);
      expect(note.err).toContain("--content resources,notes");
      expect(note.err).toContain("--as resource");
      expect(await sources(veille)).toEqual([]);

      const url = `http://127.0.0.1:${srv.port}/`;
      const res = cortex(pro, ["add", url, "--note", "n"]);
      expect([res.code, res.err]).toEqual([1, expect.stringContaining("space pro holds notes, not resources: this source is a resource")]);
      expect(hits).toBe(0); // refused before the fetch
      expect(cortex(pro, ["add", "-", "--as", "resource", "--note", "n"], "Une ressource collée.\n").code).toBe(1);
      expect(await sources(pro)).toEqual([]);

      const dry = cortex(veille, ["add", "--dry-run", "-", "--as", "note"], "Encore une note, pour voir.\n");
      expect([dry.code, dry.out]).toEqual([0, expect.stringContaining("(dry-run)")]);
      expect(dry.out).toContain("not added for real: space veille holds resources, not notes");
      expect(await sources(veille)).toEqual([]); // nothing written
    } finally { srv.stop(true); }
  });

  test("a legacy wiki (no spaces) takes everything; the mixed space takes both", async () => {
    const legacy = instance(true).root, mix = instance().dir("mix");
    for (const root of [legacy, mix]) {
      expect(cortex(root, ["add", "-", "--note", "n"], "Une note.\n").code).toBe(0);
      expect(cortex(root, ["add", "-", "--as", "resource", "--note", "n"], "Une ressource collée.\n").code).toBe(0);
    }
  });

  test("the inbox skips what the space does not hold (links in a notes space: left in place, one line, not a failure) and takes the rest", async () => {
    const { dir } = instance(), pro = dir("pro"), veille = dir("veille");
    mkdirSync(join(pro, "inbox"), { recursive: true });
    writeFileSync(join(pro, "inbox/urls.txt"), "http://127.0.0.1:1/never\n");
    writeFileSync(join(pro, "inbox/link.url"), "http://127.0.0.1:1/other\n");
    writeFileSync(join(pro, "inbox/file.md"), "# Un fichier\n\nUn texte déposé, qui prend ce que l'espace contient.\n");
    writeFileSync(join(pro, "inbox/captured.md"), "# Une page\n\nUne page capturée par le navigateur.\n");
    writeFileSync(join(pro, "inbox/captured.md.origin"), "https://example.org/page\n");
    const lines: string[] = [];
    const r = await inbox(pro, {}, (m) => lines.push(m.text));
    expect(r.ok).toBe(true); // skipped is not failed
    expect(readdirSync(join(pro, "inbox")).sort()).toEqual(["captured.md", "captured.md.origin", "link.url", "urls.txt"]); // the links and the captured page stay
    expect(readFileSync(join(pro, "inbox/urls.txt"), "utf8")).toBe("http://127.0.0.1:1/never\n");
    expect(lines.filter((l) => l.includes("skipped"))).toEqual([expect.stringContaining("1 added, 0 already present, 0 failed, 3 skipped and left in inbox/: space pro holds notes, not resources")]);
    expect((await sources(pro)).map((s) => s.content)).toEqual(["note"]);

    mkdirSync(join(veille, "inbox"), { recursive: true });
    writeFileSync(join(veille, "inbox/typed.md"), "# Idée\n\nUne idée tapée, dans un espace de ressources.\n");
    expect((await inbox(veille, {}, () => {})).ok).toBe(true);
    expect(readdirSync(join(veille, "inbox"))).toEqual([]);
    expect((await sources(veille)).map((s) => s.content)).toEqual(["resource"]);
  });

  test("compile --pending skips the pending sources of a kind the space does not hold (those without `content` are resources), says so, and touches nothing", async () => {
    const { dir } = instance(), pro = dir("pro"), veille = dir("veille");
    const raw = (root: string, id: string, extra: string) => { mkdirSync(join(root, "raw", id), { recursive: true }); writeFileSync(join(root, "raw", id, "source.md"), `---\ntype: RawSource\ntitle: ${id}\n${extra}status: pending\n---\ntexte\n`); };
    raw(pro, "old", ""); // from before the field: a resource
    raw(pro, "res", "content: resource\n");
    raw(veille, "n1", "content: note\n");
    for (const [root, n] of [[pro, 2], [veille, 1]] as const) {
      const lines: string[] = [];
      const r = await compileCtx(openWiki(root), [], { pending: true }, (m) => lines.push(m.text));
      expect(r.ok).toBe(true);
      expect(lines.some((l) => l.includes(`${n} pending source${n > 1 ? "s" : ""} skipped, left pending`))).toBe(true);
      expect(lines.some((l) => l.includes("Nothing to compile."))).toBe(true);
      expect((await sources(root)).every((s) => s.status === "pending")).toBe(true);
    }
    expect(readFileSync(join(veille, "raw/n1/source.md"), "utf8")).toContain("status: pending");
  });
});

describe("MCP add", () => {
  test("takes a text as what the space holds, refuses a URL in a notes space and an `as` of a content the space leaves out", async () => {
    const { dir } = instance();
    const call = async (root: string, args: object) => {
      const env = { ...process.env, CORTEX_ROOT: root } as Record<string, string>;
      delete env.CORTEX_SPACE;
      const proc = Bun.spawn(["bun", CLI, "mcp"], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "", n = 0;
      const rpc = async (method: string, params?: object) => {
        const id = ++n;
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); proc.stdin.flush();
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (msg.id === id) return msg.result; continue; }
          const { value, done } = await reader.read();
          if (done) throw new Error("mcp ended");
          buf += value;
        }
      };
      try {
        await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
        const r = await rpc("tools/call", { name: "add", arguments: args });
        return { isError: !!r.isError, text: r.content[0].text as string };
      } finally { proc.stdin.end(); proc.kill(); }
    };
    const veille = dir("veille"), pro = dir("pro");
    expect(await call(veille, { text: "Une note perso.", as: "note", note: "n" })).toEqual({ isError: true, text: expect.stringContaining("space veille holds resources, not notes") });
    expect((await call(veille, { text: "Un extrait à garder.", note: "n" })).isError).toBe(false);
    expect(await call(pro, { input: "http://example.invalid/x", note: "n" })).toEqual({ isError: true, text: expect.stringContaining("space pro holds notes, not resources") });
    expect((await call(pro, { text: "Une note dans l'espace de notes.", note: "n" })).isError).toBe(false);
    expect((await sources(veille)).map((s) => s.content)).toEqual(["resource"]);
    expect((await sources(pro)).map((s) => s.content)).toEqual(["note"]);
  }, 60_000);
});
