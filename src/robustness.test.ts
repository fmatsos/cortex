import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { load } from "./backends/backend";
import { killGrace, startOpencode } from "./backends/opencode";
import { render } from "./export";
import { renderIndex } from "./index";
import { normUrl } from "./lib";
import { lint } from "./lint";
import { logAdd } from "./log";
import { newPage } from "./naming";
import { isUnder, realPath } from "./paths";
import { collator } from "./text";

const tmp = (p = "cortex-rob-") => mkdtempSync(join(tmpdir(), p));
const put = async (root: string, p: string, c: string) => { await Bun.write(join(root, p), c); };
const page = (title: string, body = "") => `---\ntype: Concept\ntitle: ${title}\ndescription: D.\n---\n${body}\n`;
const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

const savedPath = process.env.PATH;
afterEach(() => { process.env.PATH = savedPath; killGrace.ms = 3_000; });

// --- REL-12 : the raw folder is claimed atomically -------------------------------------------------

test("REL-12 : un dossier raw pris entre le sondage et le mkdir donne le suffixe suivant, sans écraser", async () => {
  const root = tmp();
  await put(root, "cortex.json", '{"raw_path":"{slug}"}');
  // a dangling symlink is invisible to existsSync (the probe says "free") but mkdir fails with EEXIST
  mkdirSync(join(root, "raw"), { recursive: true });
  symlinkSync(join(root, "ailleurs"), join(root, "raw/mon-titre"));
  const r = await add(root, "-", { note: "n", text: `# Mon titre\n\n${words(60, "a")}\n` });
  expect(r.id).toBe("mon-titre-2");
  expect(readFileSync(join(root, "raw/mon-titre-2/source.md"), "utf8")).toContain("title: Mon titre");
  expect(existsSync(join(root, "ailleurs"))).toBe(false); // nothing written through the link
  expect(readdirSync(join(root, "raw/mon-titre-2"))).toEqual(["source.md"]); // no tmp file left behind
});

test("REL-12 : deux ajouts concurrents du même titre gardent chacun leur source.md", async () => {
  const root = tmp();
  await put(root, "cortex.json", '{"raw_path":"{slug}"}');
  const [a, b] = await Promise.all([
    add(root, "-", { note: "n", text: `# Même titre\n\n${words(60, "a")}\n` }),
    add(root, "-", { note: "n", text: `# Même titre\n\n${words(60, "b")}\n` }),
  ]);
  expect(a.id).not.toBe(b.id);
  const texts = [a.id, b.id].map((id) => readFileSync(join(root, "raw", id, "source.md"), "utf8"));
  expect(texts.some((t) => t.includes("a59"))).toBe(true);
  expect(texts.some((t) => t.includes("b59"))).toBe(true);
});

// --- REL-14 : opencode server output is drained, then stopped with SIGTERM/SIGKILL --------------------

function fakeOpencode(script: string): string {
  const dir = tmp("cortex-fake-oc-");
  writeFileSync(join(dir, "opencode"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, "opencode"), 0o755);
  process.env.PATH = `${dir}:${savedPath}`;
  return dir;
}

test("REL-14 : un serveur bavard (8 Mo sur stdout) ne se bloque pas après le démarrage", async () => {
  const marker = join(tmp(), "done");
  fakeOpencode(`echo "opencode server listening on http://127.0.0.1:1234"\nhead -c 8000000 /dev/zero | tr '\\0' x\necho ok > ${marker}\nsleep 30`);
  const s = await startOpencode();
  expect(s.url).toBe("http://127.0.0.1:1234");
  const t0 = Date.now();
  while (!existsSync(marker) && Date.now() - t0 < 8_000) await Bun.sleep(50);
  expect(existsSync(marker)).toBe(true);
  s.close();
  await s.exited;
}, 15_000);

test("REL-14 : close() envoie SIGTERM puis SIGKILL si le serveur l'ignore", async () => {
  killGrace.ms = 200;
  fakeOpencode(`trap '' TERM\necho "listening on http://127.0.0.1:1"\nwhile true; do sleep 1; done`);
  const s = await startOpencode();
  const t0 = Date.now();
  s.close();
  expect(await s.exited).toBe(137); // 128 + SIGKILL
  expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
}, 15_000);

// --- REL-15 : load() only reports a missing package for that exact package ------------------------------

test("REL-15 : load() : paquet absent → message propre ; toute autre erreur est relancée telle quelle", async () => {
  const err = await load("paquet-qui-nexiste-pas-xyz").catch((e: Error) => e);
  expect((err as Error).message).toBe("SDK absent : bun add paquet-qui-nexiste-pas-xyz");
  expect((err as Error).message).not.toContain("--cwd");

  const dir = tmp("cortex-load-");
  writeFileSync(join(dir, "casse.mjs"), "export const x = ;\n");
  const syntax = await load(join(dir, "casse.mjs")).catch((e: Error) => e);
  expect((syntax as Error).message).not.toContain("SDK absent");

  writeFileSync(join(dir, "dep.mjs"), 'import "dependance-absente-xyz";\n');
  const dep = await load(join(dir, "dep.mjs")).catch((e: Error) => e);
  expect((dep as Error).message).not.toContain("SDK absent");
  expect((dep as Error).message).toContain("dependance-absente-xyz");
});

test("REL-15 : plus aucune mention de « --cwd cli » dans src/ ni docs/", () => {
  const hits = Bun.spawnSync(["grep", "-rn", "--exclude=robustness.test.ts", "cwd cli", join(import.meta.dir), join(import.meta.dir, "../docs")]).stdout.toString();
  expect(hits).toBe("");
});

// --- REL-17 : one collator, whatever the runtime locale -----------------------------------------------------

test("REL-17 : index.md est trié par le collateur partagé (fr, numérique)", async () => {
  expect(collator.resolvedOptions()).toMatchObject({ locale: "fr", numeric: true });
  const root = tmp();
  for (const [i, t] of ["Zèbre", "b10", "Éclair", "b2", "apple"].entries()) await put(root, `wiki/concepts/p${i}.md`, page(t));
  const lines = (await renderIndex(root)).split("\n").filter((l) => l.startsWith("- ["));
  expect(lines.map((l) => l.match(/^- \[([^\]]+)\]/)![1])).toEqual(["apple", "b2", "b10", "Éclair", "Zèbre"]);
});

// --- REL-18 : URL normalization ------------------------------------------------------------------------------

test("REL-18 : paramètres triés, utm/fbclid/gclid retirés, ref et source conservés", () => {
  expect(normUrl("https://a.com/x?b=2&a=1")).toBe(normUrl("https://a.com/x?a=1&b=2"));
  expect(normUrl("https://a.com/x?utm_source=z&fbclid=1&gclid=2&a=1#frag")).toBe("https://a.com/x?a=1");
  expect(normUrl("https://a.com/x?source=un")).not.toBe(normUrl("https://a.com/x?source=deux"));
  expect(normUrl("https://a.com/x?ref=un")).toBe("https://a.com/x?ref=un");
});

// --- REL-20 / FAC-15 : one "is it under" helper ------------------------------------------------------------------

test("FAC-15 : isUnder suit les liens symboliques, sauf followSymlinks: false", () => {
  const root = tmp();
  mkdirSync(join(root, "wiki/c"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "s");
  writeFileSync(join(root, "wiki/c/ok.md"), "x");
  symlinkSync("../secret.txt", join(root, "wiki/piege.md"));
  symlinkSync("../hors/nouveau.md", join(root, "wiki/pendant.md")); // dangling, target outside
  expect(isUnder(root, "wiki", "wiki/c/ok.md")).toBe(true);
  expect(isUnder(root, "wiki", join(root, "wiki/c/nouveau/neuf.md"))).toBe(true); // does not exist yet
  expect(isUnder(root, "wiki", "wiki/piege.md")).toBe(false);
  expect(isUnder(root, "wiki", "wiki/pendant.md")).toBe(false);
  expect(isUnder(root, "wiki", "wiki/piege.md", { followSymlinks: false })).toBe(true);
  expect(isUnder(root, "wiki", "wiki/../secret.txt")).toBe(false);
  expect(isUnder(root, "wiki", "wiki")).toBe(false);
  expect(isUnder(root, "wiki", "wiki", { self: true })).toBe(true);
  expect(isUnder(root, "wiki", "wikipedia/x.md")).toBe(false);
  expect(realPath(join(root, "wiki/c/a/b"))).toBe(join(realPath(root), "wiki/c/a/b"));
});

test("REL-20 : cortex log add --page refuse un lien symbolique qui sort de wiki/", async () => {
  const root = tmp();
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "cortex.json"), "{}");
  writeFileSync(join(root, "wiki/concepts/ok.md"), page("Ok"));
  symlinkSync("../../cortex.json", join(root, "wiki/concepts/piege.md"));
  expect((await logAdd(root, "update", "ok", [], ["wiki/concepts/ok.md"])).pages).toEqual(["wiki/concepts/ok.md"]);
  await expect(logAdd(root, "update", "piège", [], ["wiki/concepts/piege.md"])).rejects.toThrow("page introuvable sous wiki/");
});

// --- REL-21 : footnotes inside code, relative .md links ---------------------------------------------------------------

test("REL-21 : les [^id] dans un bloc de code ou du code en ligne ne sont pas réécrits", () => {
  const body = [
    "Vrai.[^a] Et `[^b]` en ligne, ou ``[^c]`` aussi.",
    "",
    "```md",
    "Texte[^d]",
    "",
    "[^d]: définition dans le code",
    "```",
    "",
    "~~~",
    "[^e]",
    "~~~",
    "",
    "[^a]: Vraie note avec `[^f]`.",
  ].join("\n");
  const { html, notes } = render(body, "wiki/concepts/x.md", new Set());
  expect(notes.map((n) => n.id)).toEqual(["a"]); // only the real footnote
  expect(html.match(/class="fn-ref"/g)).toHaveLength(1);
  for (const k of ["b", "c", "d", "e"]) expect(html).toContain(`[^${k}]`);
  expect(html).toContain("[^d]: définition dans le code"); // not swallowed as a definition either
  expect(notes[0].html).toContain("<code>[^f]</code>");
});

test("REL-21 : lint avertit d'un lien .md qui n'est pas relatif à la racine", async () => {
  const root = tmp();
  await put(root, "wiki/concepts/a.md", page("A", "Voir [x](../concepts/x.md), [y](autre.md#frag), [ok](/wiki/concepts/a.md) et [web](https://ex.com/a.md)."));
  const msgs = (await lint(root)).filter((i) => i.msg.startsWith("lien relatif")).map((i) => i.msg);
  expect(msgs).toEqual([
    "lien relatif vers un .md : ../concepts/x.md (utilise un lien depuis la racine : /wiki/….md)",
    "lien relatif vers un .md : autre.md#frag (utilise un lien depuis la racine : /wiki/….md)",
  ]);
});

// --- REL-27 : long titles ---------------------------------------------------------------------------------------------------

test("REL-27 : deux titres longs au même début de 50 caractères ne sont pas « déjà pris »", async () => {
  const root = tmp();
  await put(root, "cortex.json", "{}");
  const head = "Une très longue introduction partagée par deux titres d'articles";
  const p1 = await newPage(root, "Source", `${head} : première partie`);
  const p2 = await newPage(root, "Source", `${head} : seconde partie`);
  expect(p1).not.toBe(p2);
  await expect(newPage(root, "Source", `${head} : PREMIÈRE partie`)).rejects.toThrow("une page porte déjà ce titre");
});
