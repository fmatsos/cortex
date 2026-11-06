import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { suggestLinks } from "./links";
import { newPageCtx } from "./naming";
import { refresh } from "./embed";
import { buildSiteDataCtx } from "./export";
import { lint } from "./lint";
import { applyQueueEntry, maintainCtx } from "./maintain";
import type { Message } from "./print";
import { queueItems, readQueue } from "./queue";

// `cortex maintain merge` end to end on a planted wiki, against a fake llama.cpp: /embeddings (a vector per subject, read from
// the title), /systemone (the verdict of each pair of titles) and /chat/completions (the `merge` call, scripted).
//   Prompt caching / Cache de prompt : the same subject (verdict same), notes with a clashing id, inbound links with anchors
//   Context window / Context length   : overlapping (queue), UUID v7 file names: the older file is not the older `generated.at`
//   Tokenizer / Tokenization          : different (noted, never asked again)

const NOW = new Date("2026-11-06T10:00:00+01:00");
const ID_OLD = "01900000-0000-7000-8000-000000000001", ID_NEW = "01900000-0000-7000-8000-000000000002";
const roots: string[] = [];
const servers: { stop(close?: boolean): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })); });

const SUBJECT: [RegExp, number[]][] = [[/^(Prompt caching|Cache de prompt)/, [1, 0, 0, 0]], [/^(Context window|Context length)/, [0, 1, 0, 0]], [/^(Tokenizer|Tokenization)/, [0, 0, 1, 0]]];
const vec = (t: string) => SUBJECT.find(([re]) => re.test(t))?.[1] ?? [0, 0, 0, 1];

type Chat = { messages: { role: string; content: string }[] };
/** `verdicts`: by « title a | title b » (titles in path order), the answer of the judge. `merge`: the scripted model, called with its number. */
function fake(o: { verdicts?: Record<string, [string, number]>; merge?: (b: Chat, n: number) => object } = {}) {
  const judged: string[] = [], chats: Chat[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url), b: any = await req.json();
    if (url.pathname.endsWith("/embeddings")) return Response.json({ data: (b.input as string[]).map((t, index) => ({ index, embedding: vec(t) })) });
    if (url.pathname.endsWith("/systemone")) {
      const k = `${b.state.a.title} | ${b.state.b.title}`;
      judged.push(k);
      const [choice, p] = o.verdicts?.[k] ?? ["different", 0.9];
      const probabilities = { same: 0, overlapping: 0, different: 0, [choice]: p, ...(p < 1 && { [choice === "same" ? "overlapping" : "same"]: 1 - p }) };
      return Response.json({ answers: { pair: { type: "choice", choice, confidence: p, probabilities } } });
    }
    chats.push(b);
    const r = o.merge?.(b, chats.length);
    if (!r) return new Response("no script", { status: 500 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(r) } }] });
  } });
  servers.push(server);
  return { base_url: `http://127.0.0.1:${server.port}/v1`, judged, chats };
}

const GOOD = {
  title: "Prompt caching", description: "Réutilisation du préfixe d'un prompt, côté fournisseur.",
  body: `Le cache de prompt réutilise le préfixe d'un prompt déjà calculé [^anthropic]. Les lectures du cache coûtent 10 % du prix normal [^blog].\n\n## Usage\nIl réduit la latence et le coût des requêtes répétées [^anthropic]. Les écritures coûtent 25 % de plus [^anthropic-2]. Voir [Context window](/wiki/concepts/${ID_NEW}.md), [Cache de prompt](/wiki/concepts/cache-de-prompt.md) et [fiction](/wiki/concepts/nope.md).`,
};
/** The model drops two of the three notes the first time, then answers well. */
const merge = (b: Chat, n: number) => (n === 1 ? { ...GOOD, body: "Le cache de prompt réutilise le préfixe d'un prompt déjà calculé et en réduit le coût de façon très nette pour les requêtes répétées, lues dix fois moins cher [^anthropic]." } : GOOD);
const SAME: [string, number] = ["same", 0.95];
const VERDICTS = { "Cache de prompt | Prompt caching": SAME, "Context length | Context window": ["overlapping", 0.7], "Tokenization | Tokenizer": ["different", 0.9] } as Record<string, [string, number]>;

const page = (type: string, title: string, o: { status?: string; tags?: string[]; at?: string; sources?: [string, string, string][]; body: string; extra?: string }) =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\nstatus: ${o.status ?? "stable"}\ntags: [${(o.tags ?? []).join(", ")}]\n${o.at ? `generated: { by: "someone", at: ${o.at} }\n` : ""}${o.extra ?? ""}${
    o.sources ? `sources:\n${o.sources.map(([id, resource, t]) => `  - id: ${id}\n    resource: ${resource}\n    title: ${t}`).join("\n")}\n` : ""}---\n${o.body}\n`;
const R = (n: string) => `/raw/2026/10/${n}/source.md`;

async function wiki(base_url: string, o: { judge?: boolean; config?: object; longBody?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cortex-maintain-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", base_url, language: "French", page_path: "{type}/{slug}", embed: { base_url, dims: 4 }, ...(o.judge === false ? {} : { judge: { base_url } }), ...o.config }));
  for (const n of ["a", "b", "c", "d"]) await Bun.write(join(root, `raw/2026/10/${n}/source.md`), `---\ntype: RawSource\ntitle: Raw ${n}\nstatus: compiled\n---\nTexte ${n}.\n`);
  const w = (p: string, text: string) => Bun.write(join(root, `wiki/${p}.md`), text);
  await w("concepts/prompt-caching", page("Concept", "Prompt caching", {
    tags: ["llm", "perf"], at: "2026-10-01T10:00:00+02:00", sources: [["anthropic", R("a"), "Anthropic docs"]],
    body: `Le cache de prompt réutilise le préfixe d'un prompt déjà calculé [^anthropic].\n\n## Usage\nIl réduit la latence et le coût des requêtes répétées [^anthropic]. Voir [Context window](/wiki/concepts/${ID_NEW}.md).\n\n[^anthropic]: Anthropic docs, ${R("a")}`,
  }));
  await w("concepts/cache-de-prompt", page("Concept", "Cache de prompt", {
    tags: ["llm", "cost"], at: "2026-10-05T10:00:00+02:00", sources: [["anthropic", R("b"), "Un autre billet"], ["blog", R("c"), "Blog"]],
    body: `Mise en cache du préfixe d'un prompt côté fournisseur [^anthropic]. Les lectures du cache coûtent 10 % du prix normal [^blog].\n\n## Usage\nLes écritures coûtent 25 % de plus [^anthropic].\n\n[^anthropic]: Un autre billet, ${R("b")}\n[^blog]: Blog, ${R("c")}`,
  }));
  await w(`concepts/${ID_NEW}`, page("Concept", "Context window", { at: "2026-09-01T10:00:00+02:00", sources: [["d", R("d"), "Raw d"]], body: `La fenêtre de contexte borne ce que le modèle lit [^d].\n\n[^d]: Raw d, ${R("d")}` }));
  await w(`concepts/${ID_OLD}`, page("Concept", "Context length", { at: "2026-11-01T10:00:00+01:00", body: "Longueur maximale du contexte, en tokens.", extra: "" }));
  await w("concepts/tokenizer", page("Concept", "Tokenizer", { body: "Découpe le texte en tokens." }));
  await w("concepts/tokenization", page("Concept", "Tokenization", { body: "Le processus de découpe." }));
  await w("concepts/embeddings", page("Concept", "Embeddings", { body: "Vecteurs de sens.", status: "draft" }));
  await w("sources/anthropic-docs", page("Source", "Anthropic docs", {
    sources: [["a", R("a"), "Raw a"]],
    body: `Résumé [^a].\n\n## Pages liées\n- [Cache de prompt](/wiki/concepts/cache-de-prompt.md#usage)\n- [Prompt caching](/wiki/concepts/prompt-caching.md)\n- [Embeddings](/wiki/concepts/embeddings.md)\n\n[^a]: Raw a, ${R("a")}`,
  }));
  await w("syntheses/memoire", page("Synthesis", "Mémoire", { body: `Voir [le cache](/wiki/concepts/cache-de-prompt.md) et [fenêtre](/wiki/concepts/${ID_NEW}.md).` }));
  await w("concepts/ancien-cache", page("Concept", "Ancien cache", { status: "deprecated", extra: "superseded_by: /wiki/concepts/cache-de-prompt.md\n", body: "Voir [Cache de prompt](/wiki/concepts/cache-de-prompt.md)." }));
  if (o.longBody) await w("concepts/tokenizer", page("Concept", "Tokenizer", { body: "mot ".repeat(20_000) }));
  await refresh(root);
  return root;
}

const text = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const snapshot = (root: string) => Object.fromEntries([...new Bun.Glob("wiki/**/*").scanSync({ cwd: root })].sort().map((p) => [p, text(root, p)]));
const run = async (root: string, sub: string | undefined, o: { apply?: boolean; limit?: number } = {}) => {
  const messages: Message[] = [];
  const r = await maintainCtx(openWiki(root), sub, { now: () => NOW, ...o }, (m) => messages.push(m));
  return { ...r, messages };
};
const queue = (root: string) => queueItems(readQueue(root).entries);

test("without --apply: the pairs are listed with the judge's verdicts, nothing is written and the model is not called", async () => {
  const s = fake({ verdicts: VERDICTS, merge });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root, "merge");
  expect(r.ok).toBe(true);
  expect(r.items).toEqual([
    { action: "would-queue", pages: [`wiki/concepts/${ID_OLD}.md`, `wiki/concepts/${ID_NEW}.md`], note: "overlapping 0.70" },
    { action: "would-merge", pages: ["wiki/concepts/prompt-caching.md", "wiki/concepts/cache-de-prompt.md"], note: "same 0.95" },
  ]);
  expect(r.messages.map((m) => m.text)).toContain("à fusionner : « Cache de prompt » dans « Prompt caching » (same 0.95)");
  expect(r.messages.at(-1)!.text).toContain("rien n'a été modifié");
  expect(s.chats).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
  expect(existsSync(join(root, ".cortex/maintain.json"))).toBe(false);
});

test("--apply: merged page, deprecated page, links rewritten, queue, journal, state; a rerun asks and writes nothing twice", async () => {
  const s = fake({ verdicts: VERDICTS, merge });
  const root = await wiki(s.base_url);
  const r = await run(root, "merge", { apply: true });
  expect(r.ok).toBe(true);
  expect(r.items.map((i) => i.action).sort()).toEqual(["merged", "queued"]);
  // the first answer dropped notes: asked again with the missing ids named, and the pair got its units renamed (anthropic-2)
  expect(s.chats).toHaveLength(2);
  const first = s.chats[0].messages[1].content;
  expect(first).toContain("Valid footnote ids: anthropic, anthropic-2, blog");
  expect(first).toContain("[^anthropic-2]");
  expect(first).not.toContain("[^anthropic]:"); // definitions are cortex's
  expect(s.chats[0].messages[0].content).toContain("Never use the double-quote character");
  expect(s.chats[1].messages.at(-1)!.content).toMatch(/footnotes lost: anthropic-2, blog/);

  const target = text(root, "wiki/concepts/prompt-caching.md");
  expect(target).toContain('title: "Prompt caching"');
  expect(target).toContain("status: draft");
  expect(target).toContain('tags: ["llm","perf","cost"]');
  expect(target).toContain('aliases: ["Cache de prompt"]');
  expect(target).toContain("description: \"Réutilisation du préfixe d'un prompt, côté fournisseur.\"");
  expect(target).toContain(`  - id: anthropic\n    resource: ${R("a")}\n    title: Anthropic docs\n  - id: anthropic-2\n    resource: ${R("b")}\n    title: Un autre billet\n  - id: blog\n    resource: ${R("c")}\n    title: Blog`);
  expect(target).toContain(`[^anthropic-2]: Un autre billet, ${R("b")}`);
  expect(target).toContain(`[^blog]: Blog, ${R("c")}`);
  expect(target).toContain(`[Context window](/wiki/concepts/${ID_NEW}.md)`); // an existing page: kept
  expect(target).toContain(", Cache de prompt et fiction."); // the other page of the pair and an invented page: text only
  expect(target).toContain('generated: { by: "openai/m:maintain"');

  const gone = text(root, "wiki/concepts/cache-de-prompt.md");
  expect(gone).toContain("status: deprecated");
  expect(gone).toContain('superseded_by: "/wiki/concepts/prompt-caching.md"');
  expect(gone).toContain("Remplacée par [Prompt caching](/wiki/concepts/prompt-caching.md).\n\nMise en cache du préfixe d'un prompt");
  expect(gone).toContain(`[^blog]: Blog, ${R("c")}`); // its old body and notes stay

  // inbound links follow (the anchor goes, a duplicate item of « Pages liées » goes), the chain of a deprecated page too, the page itself is left alone
  const src = text(root, "wiki/sources/anthropic-docs.md");
  expect(src).toContain("- [Cache de prompt](/wiki/concepts/prompt-caching.md)\n- [Embeddings]");
  expect(src.match(/prompt-caching\.md/g)).toHaveLength(1);
  expect(src).toContain('generated: { by: "cortex-links"');
  expect(text(root, "wiki/syntheses/memoire.md")).toContain("[le cache](/wiki/concepts/prompt-caching.md)");
  expect(text(root, "wiki/concepts/ancien-cache.md")).toContain('superseded_by: "/wiki/concepts/prompt-caching.md"');
  expect(text(root, "wiki/concepts/ancien-cache.md")).toContain("(/wiki/concepts/prompt-caching.md)");

  // clean: nothing wrong on the pages written, and the deprecated page is not an orphan
  const issues = await lint(root);
  const mine = new Set(["wiki/concepts/prompt-caching.md", "wiki/concepts/cache-de-prompt.md", "wiki/sources/anthropic-docs.md", "wiki/concepts/ancien-cache.md"]);
  expect(issues.filter((i) => mine.has(i.path) && i.level !== "info")).toEqual([]);

  // queue (overlapping: one `merge` entry), journal, state (different, noted by hash), index regenerated
  expect(queue(root)).toMatchObject([{ kind: "merge", status: "open", pages: [`wiki/concepts/${ID_OLD}.md`, `wiki/concepts/${ID_NEW}.md`] }]);
  expect(text(root, "wiki/log.jsonl")).toContain("fusion : « Cache de prompt » absorbée dans « Prompt caching »");
  expect(Object.keys(JSON.parse(text(root, ".cortex/maintain.json")).merge.different)).toHaveLength(1);
  expect(text(root, "wiki/queue.md")).toContain("Fusion possible");
  expect(text(root, "wiki/log.jsonl")).toContain("maintenance merge : 1 fusion(s), 1 entrée(s) ajoutée(s) à la file");

  // a rerun: the merged pair is gone, the different pair is not asked again, the queued pair is not queued twice
  s.judged.length = 0;
  const again = await run(root, "merge", { apply: true });
  expect(again.items.map((i) => i.action)).toEqual(["already-queued"]);
  expect(s.judged).toEqual(["Context length | Context window"]);
  expect(queue(root)).toHaveLength(1);
  expect(s.chats).toHaveLength(2);
});

test("cortex queue apply on a merge entry: no new judgement, the UUID v7 file name decides the target, links follow, the entry is closed", async () => {
  const s = fake({ verdicts: { ...VERDICTS, "Cache de prompt | Prompt caching": ["different", 0.9] }, merge: () => ({ title: "Context window", description: "Fenêtre et longueur de contexte.", body: "La fenêtre de contexte, ou longueur maximale du contexte en tokens, borne ce que le modèle lit [^d]." }) });
  const root = await wiki(s.base_url);
  await run(root, "merge", { apply: true }); // overlapping: queued
  const item = queue(root).find((i) => i.kind === "merge")!;
  expect(item).toBeDefined();
  s.judged.length = 0;
  const r = await applyQueueEntry(openWiki(root), item, () => {});
  expect(r.ok).toBe(true);
  expect(s.judged).toEqual([]);
  // `generated.at` says Context window is the older page, its file name (UUID v7) says Context length: the file name wins
  const target = text(root, `wiki/concepts/${ID_OLD}.md`);
  expect(target).toContain('title: "Context window"');
  expect(target).toContain('aliases: ["Context length"]');
  expect(target).toContain(`[^d]: Raw d, ${R("d")}`);
  expect(text(root, `wiki/concepts/${ID_NEW}.md`)).toContain("status: deprecated");
  expect(text(root, `wiki/concepts/${ID_NEW}.md`)).toContain(`superseded_by: "/wiki/concepts/${ID_OLD}.md"`);
  expect(text(root, "wiki/concepts/prompt-caching.md")).toContain(`(/wiki/concepts/${ID_OLD}.md)`);
  expect(text(root, "wiki/syntheses/memoire.md")).toContain(`[fenêtre](/wiki/concepts/${ID_OLD}.md)`);
  expect(queue(root).find((i) => i.kind === "merge")).toMatchObject({ status: "done" });
  // both pages are titled « Context window » (the model kept the title of the absorbed one): not a duplicate for lint
  expect((await lint(root)).filter((i) => i.msg.includes("probable duplicate"))).toEqual([]);
  // the same entry applied again: refused as already closed by the CLI; a kind without applier says so
  await expect(applyQueueEntry(openWiki(root), { ...item, kind: "review" })).rejects.toThrow("not available yet for review entries");
});

test("the model never keeps the notes: nothing is written, one review entry, and a rerun does not add another", async () => {
  const s = fake({ verdicts: { ...VERDICTS, "Context length | Context window": ["different", 0.9] }, merge: () => ({ ...GOOD, body: "Un cache de prompt réutilise le préfixe d'un prompt déjà calculé, ce qui réduit fortement le coût des requêtes répétées dans tous les cas [^anthropic]." }) });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root, "merge", { apply: true });
  expect(r.items.filter((i) => i.action === "review")).toHaveLength(1);
  expect(s.chats).toHaveLength(3); // the answer and two retries (pipelineRetries)
  const after = snapshot(root);
  for (const p of Object.keys(before)) if (p.startsWith("wiki/concepts/") || p.startsWith("wiki/sources/")) expect(after[p]).toBe(before[p]);
  expect(queue(root)).toMatchObject([{ kind: "review", status: "open", title: "Fusion non faite : Cache de prompt / Prompt caching" }]);
  expect(queue(root)[0].reason).toContain("footnotes lost: anthropic-2, blog");
  await run(root, "merge", { apply: true });
  expect(queue(root)).toHaveLength(1);
});

test("pages too long for one call: a review entry, no model call", async () => {
  const s = fake({ verdicts: { "Tokenization | Tokenizer": SAME }, merge });
  const root = await wiki(s.base_url, { longBody: true });
  const r = await run(root, "merge", { apply: true });
  expect(r.items.find((i) => i.pages.includes("wiki/concepts/tokenizer.md"))).toMatchObject({ action: "review" });
  expect(s.chats).toHaveLength(0);
  expect(queue(root).find((i) => i.kind === "review")!.reason).toContain("trop longues");
});

test("no judge: the pairs are listed and nothing is merged, even with --apply", async () => {
  const s = fake({ verdicts: VERDICTS, merge });
  const root = await wiki(s.base_url, { judge: false });
  const before = snapshot(root);
  const r = await run(root, "merge", { apply: true });
  expect(r.items.every((i) => i.action === "candidate")).toBe(true);
  expect(r.items).toHaveLength(3);
  expect(s.chats).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
});

test("no embeddings: only the pairs of near titles are examined, and it is said", async () => {
  const s = fake({ verdicts: { "Prompt caching | Prompt caching": SAME } });
  const root = await wiki(s.base_url, { config: { embed: undefined } });
  const r = await run(root, "merge");
  expect(r.messages.some((m) => m.level === "warn" && m.text.includes("embeddings"))).toBe(true);
  expect(r.items).toEqual([]);
});

test("an unknown subcommand is a usage error that lists the subcommands", async () => {
  const root = await wiki(fake().base_url);
  await expect(maintainCtx(openWiki(root), "nope", {})).rejects.toThrow("cortex maintain <merge");
  await expect(maintainCtx(openWiki(root), undefined, {})).rejects.toThrow("Usage");
});

test("lint: deprecated without superseded_by (warning), superseded_by to a missing page or to itself (error), a deprecated page is no orphan", async () => {
  const root = await wiki(fake().base_url);
  await Bun.write(join(root, "wiki/concepts/orphan-gone.md"), page("Concept", "Gone", { status: "deprecated", body: "Rien." }));
  await Bun.write(join(root, "wiki/concepts/to-nowhere.md"), page("Concept", "Nowhere", { status: "deprecated", extra: "superseded_by: /wiki/concepts/absent.md\n", body: "Rien." }));
  await Bun.write(join(root, "wiki/concepts/to-itself.md"), page("Concept", "Itself", { status: "deprecated", extra: "superseded_by: /wiki/concepts/to-itself.md\n", body: "Rien." }));
  const issues = (await lint(root)).filter((i) => /orphan-gone|to-nowhere|to-itself/.test(i.path)).map((i) => `${i.level} ${i.path.split("/").at(-1)} ${i.msg}`);
  expect(issues).toEqual(expect.arrayContaining([
    "warning orphan-gone.md deprecated without superseded_by (the page that replaces it)",
    "error to-nowhere.md superseded_by: page not found: /wiki/concepts/absent.md",
    "error to-itself.md superseded_by points at the page itself",
  ]));
  expect(issues.some((i) => i.includes("orphan:"))).toBe(false);
});

test("export: a deprecated page carries the page that replaces it", async () => {
  const root = await wiki(fake().base_url);
  const { setLocale } = await import("../site/src/lib/i18n/index");
  let data;
  try { ({ data } = await buildSiteDataCtx(openWiki(root), () => {})); } finally { setLocale("en"); } // the export sets the process-wide locale
  const old = data.pages.find((p) => p.id === "concepts/ancien-cache")!;
  expect(old.superseded_by).toEqual({ id: "concepts/cache-de-prompt", title: "Cache de prompt", type: "Concept" });
  expect(data.pages.find((p) => p.id === "concepts/embeddings")!.superseded_by).toBeUndefined();
});

test("cortex maintain: usage errors, a listing without --apply exits 0", async () => {
  const root = await wiki(fake({ verdicts: VERDICTS }).base_url);
  const cli = async (...args: string[]) => { // async: the fake server lives in this process
    const p = Bun.spawn(["bun", join(import.meta.dir, "cortex.ts"), ...args], { env: { ...process.env, NO_COLOR: "1", CORTEX_ROOT: root }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  };
  expect(await cli("maintain")).toMatchObject({ code: 2 });
  expect((await cli("maintain")).err).toContain("cortex maintain <merge");
  expect((await cli("maintain", "merge", "--apply", "--dry-run")).code).toBe(2);
  const list = await cli("maintain", "merge");
  expect(list.code).toBe(0);
  expect(list.out).toContain("à fusionner : « Cache de prompt » dans « Prompt caching » (same 0.95)");
  expect(text(root, "wiki/concepts/cache-de-prompt.md")).not.toContain("deprecated");
});

test("after a merge: a new page cannot take the old title (the error names the replacement), and a mention of it is linked to the replacement", async () => {
  const s = fake({ verdicts: VERDICTS, merge });
  const root = await wiki(s.base_url);
  await Bun.write(join(root, "wiki/concepts/mention.md"), page("Concept", "Mention", { tags: ["llm"], body: "Le Cache de prompt est une bonne pratique pour les agents." }));
  await run(root, "merge", { apply: true });
  await expect(newPageCtx(openWiki(root), "Concept", "Cache de prompt")).rejects.toThrow("a page already has this title: wiki/concepts/prompt-caching.md");
  const found = suggestLinks(await openWiki(root).pages()).filter((l) => l.path === "wiki/concepts/mention.md");
  expect(found.map((l) => [l.term, l.target])).toEqual([["Cache de prompt", "wiki/concepts/prompt-caching.md"]]);
});
