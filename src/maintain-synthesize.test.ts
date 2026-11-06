import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { lint } from "./lint";
import { applyQueueEntry, maintainCtx } from "./maintain";
import type { Message } from "./print";
import { enqueue, queueItems, readQueue } from "./queue";

// `cortex maintain synthesize` end to end on a planted wiki and queue, against a fake llama.cpp: /systemone (the noul of the
// synthesis) and /chat/completions (the `synthesize` call, scripted). Two groups of pages, Alpha and Beta, linked inside, not between.

const NOW = new Date("2026-11-06T10:00:00+01:00");
const roots: string[] = [];
const servers: { stop(close?: boolean): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })); });

type Chat = { messages: { role: string; content: string }[] };
function fake(o: { noul?: number; synth?: (b: Chat, n: number) => object } = {}) {
  const judged: any[] = [], chats: Chat[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url), b: any = await req.json();
    if (url.pathname.endsWith("/systemone")) { judged.push(b.state); return Response.json({ answers: { synthesis: { type: "noul", noul: o.noul ?? 0.9 } } }); }
    chats.push(b);
    const r = o.synth?.(b, chats.length);
    if (!r) return new Response("no script", { status: 500 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(r) } }] });
  } });
  servers.push(server);
  return { base_url: `http://127.0.0.1:${server.port}/v1`, judged, chats };
}

const GOOD = {
  title: "Alpha et Beta ensemble", description: "Ce que les groupes Alpha et Beta ont en commun.",
  body: "Les deux groupes se rejoignent sur un point [[p:0]] [[p:3]] [^x]. Alpha éclaire Beta [[p:1]], Beta nuance Alpha [[p:4]] et [[p:99]] ne dit rien. Ensemble, ils montrent que la méthode et la mesure se répondent, ce que chaque groupe ne voyait pas seul.\n\n## Tensions\nVoir [Alpha hub](/wiki/concepts/alpha-hub.md) et [le site](https://example.org).",
};
const synth = (_: Chat, n: number) => (n === 1 ? { title: "Alpha hub", description: "D.", body: "Seulement le groupe A [[p:0]] [[p:1]], et rien d'autre à dire sur ce sujet, qui ne sert à rien. ".repeat(3) } : GOOD);

const page = (title: string, o: { tags?: string[]; links?: string[]; body?: string }) =>
  `---\ntype: Concept\ntitle: ${title}\ndescription: D ${title}.\nstatus: stable\ntags: [${(o.tags ?? []).join(", ")}]\n---\n${o.body ?? `Le sujet ${title} en un paragraphe.`}\n\n## Liens\n${(o.links ?? []).map((l) => `- [${l}](/wiki/concepts/${l.toLowerCase().replace(" ", "-")}.md)`).join("\n")}\n`;

async function wiki(base_url: string, o: { judge?: boolean; entry?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cortex-synth-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", base_url, language: "French", page_path: "{type}/{slug}", ...(o.judge === false ? {} : { judge: { base_url } }) }));
  await Bun.write(join(root, "raw/2026/10/a/source.md"), "---\ntype: RawSource\ntitle: Raw a\nstatus: compiled\n---\nTexte.\n");
  const w = (p: string, text: string) => Bun.write(join(root, `wiki/concepts/${p}.md`), text);
  await w("alpha-hub", page("Alpha hub", { tags: ["llm"], links: ["Alpha one", "Alpha two"] }));
  await w("alpha-one", page("Alpha one", { links: ["Alpha hub"] }));
  await w("alpha-two", page("Alpha two", { links: ["Alpha hub"] }));
  await w("beta-hub", page("Beta hub", { tags: ["perf", "llm"], links: ["Beta one", "Beta two"] }));
  await w("beta-one", page("Beta one", { links: ["Beta hub"] }));
  await w("beta-two", page("Beta two", { links: ["Beta hub"] }));
  if (o.entry !== false) await enqueue(root, { kind: "synthesis", title: "Synthèse : Alpha hub / Beta hub", reason: "La source relie deux groupes.", pages: ["wiki/concepts/alpha-hub.md", "wiki/concepts/beta-hub.md", "wiki/concepts/alpha-one.md"], sources: ["a"] }, NOW);
  return root;
}

const text = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const snapshot = (root: string) => Object.fromEntries([...new Bun.Glob("wiki/**/*").scanSync({ cwd: root })].sort().map((p) => [p, text(root, p)]));
const run = async (root: string, o: { apply?: boolean; limit?: number } = {}) => {
  const messages: Message[] = [];
  const r = await maintainCtx(openWiki(root), "synthesize", { now: () => NOW, ...o }, (m) => messages.push(m));
  return { ...r, messages };
};
const queue = (root: string) => queueItems(readQueue(root).entries);

test("without --apply: the entries are listed, nothing is written and the model is not called", async () => {
  const s = fake({ synth });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root);
  expect(r.ok).toBe(true);
  expect(r.items).toEqual([{ action: "would-write", pages: ["wiki/concepts/alpha-hub.md", "wiki/concepts/beta-hub.md", "wiki/concepts/alpha-one.md"], note: "Synthèse : Alpha hub / Beta hub" }]);
  expect(s.chats).toHaveLength(0);
  expect(s.judged).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
});

test("--apply, judge sure: a Synthesis draft linking both groups, no note, no source; entry closed, journal; the model is asked again until both groups are linked", async () => {
  const s = fake({ synth, noul: 0.9 });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.ok).toBe(true);
  expect(r.items).toMatchObject([{ action: "written", pages: ["wiki/syntheses/alpha-et-beta-ensemble.md", "wiki/concepts/alpha-hub.md", "wiki/concepts/beta-hub.md"], note: "0.90" }]);
  // the call: both groups numbered one after the other, hub first, only titles, descriptions and summaries
  expect(s.chats).toHaveLength(2);
  const user = s.chats[0].messages[1].content;
  expect(user).toContain("Group A (around « Alpha hub »):\n[[p:0]] Alpha hub — D Alpha hub.\nLe sujet Alpha hub en un paragraphe.");
  expect(user).toContain("[[p:2]] Alpha two");
  expect(user).toContain("Group B (around « Beta hub »):\n[[p:3]] Beta hub");
  expect(s.chats[0].messages[0].content).toContain("Never use the double-quote character");
  const retry = s.chats[1].messages.at(-1)!.content;
  expect(retry).toContain("title already taken: Alpha hub");
  expect(retry).toContain("no [[p:N]] link to group B (numbers 3 to 5)");

  const made = text(root, "wiki/syntheses/alpha-et-beta-ensemble.md");
  expect(made).toContain("type: Synthesis");
  expect(made).toContain("status: draft");
  expect(made).toContain('generated: { by: "openai/m:maintain"');
  expect(made).not.toContain("sources:");
  expect(made).toMatch(/tags:\n {2}- llm\n {2}- perf\n/);
  expect(made).toContain("Les deux groupes se rejoignent sur un point [Alpha hub](/wiki/concepts/alpha-hub.md) [Beta hub](/wiki/concepts/beta-hub.md).");
  expect(made).not.toContain("[^x]");
  expect(made).not.toContain("[[p:");
  expect(made).toContain("Alpha éclaire Beta [Alpha one](/wiki/concepts/alpha-one.md), Beta nuance Alpha [Beta one](/wiki/concepts/beta-one.md) et  ne dit rien. Ensemble, ils montrent");
  expect(made).toContain("Voir Alpha hub et le site."); // a link the model wrote is only its text
  expect((await lint(root)).filter((i) => i.path.endsWith("alpha-et-beta-ensemble.md") && i.level === "error")).toEqual([]);

  // d3-mini saw the body and the titles of both groups
  expect(s.judged).toHaveLength(1);
  expect(s.judged[0].group_a).toEqual(["Alpha hub", "Alpha one", "Alpha two"]);
  expect(s.judged[0].group_b).toEqual(["Beta hub", "Beta one", "Beta two"]);
  expect(queue(root)).toMatchObject([{ kind: "synthesis", status: "done" }]);
  expect(text(root, "wiki/log.jsonl")).toContain("synthèse : « Alpha et Beta ensemble » écrite");
  // a rerun has nothing left
  const again = await run(root, { apply: true });
  expect(again.items).toEqual([]);
  expect(s.chats).toHaveLength(2);
});

test("judge not sure: no page, the proposal goes in a new entry (the old one is closed); a rerun leaves it, `cortex queue apply` writes it as it is", async () => {
  const s = fake({ synth: () => GOOD, noul: 0.5 });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["proposed"]);
  expect(Object.keys(snapshot(root)).some((p) => p.startsWith("wiki/syntheses/"))).toBe(false);
  const open = queue(root).filter((i) => i.status === "open");
  expect(open).toHaveLength(1);
  expect(queue(root)[0].status).toBe("done");
  expect(open[0]).toMatchObject({ kind: "synthesis", title: "Synthèse : Alpha hub / Beta hub", sources: ["a"] });
  expect(open[0].reason).toContain("0.50");
  expect(open[0].proposal).toContain("Title: Alpha et Beta ensemble\nDescription: Ce que les groupes Alpha et Beta ont en commun.\n\nLes deux groupes se rejoignent sur un point [Alpha hub](/wiki/concepts/alpha-hub.md)");

  s.chats.length = 0; s.judged.length = 0;
  const again = await run(root, { apply: true });
  expect(again.items.map((i) => i.action)).toEqual(["proposed"]);
  expect(s.chats).toHaveLength(0);
  expect(queue(root)).toHaveLength(2);

  const done = await applyQueueEntry(openWiki(root), open[0], () => {});
  expect(done.ok).toBe(true);
  expect(s.chats).toHaveLength(0); // the human's proposal as it is: no model, no judge
  expect(s.judged).toHaveLength(0);
  expect(text(root, "wiki/syntheses/alpha-et-beta-ensemble.md")).toContain("Alpha éclaire Beta [Alpha one]");
  expect(text(root, "wiki/syntheses/alpha-et-beta-ensemble.md")).toMatch(/tags:\n {2}- llm\n {2}- perf\n/);
  expect(queue(root).filter((i) => i.status === "open")).toEqual([]);
});

test("cortex queue apply on an entry without proposal: the model writes the page, the judge is not asked", async () => {
  const s = fake({ synth: () => GOOD });
  const root = await wiki(s.base_url);
  const item = queue(root)[0];
  const done = await applyQueueEntry(openWiki(root), item, () => {});
  expect(done.ok).toBe(true);
  expect(s.chats).toHaveLength(1);
  expect(s.judged).toHaveLength(0);
  expect(text(root, "wiki/syntheses/alpha-et-beta-ensemble.md")).toContain("type: Synthesis");
  expect(queue(root)[0].status).toBe("done");
});

test("a group whose first page is gone, or a model that never links both groups: a review entry, nothing written", async () => {
  const s = fake({ synth: () => ({ ...GOOD, body: "Rien qu'un groupe [[p:0]], et un texte assez long pour passer la longueur minimale demandée par cortex à une synthèse. ".repeat(3) }) });
  const root = await wiki(s.base_url);
  let r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["review"]);
  expect(s.chats).toHaveLength(3);
  expect(queue(root).find((i) => i.kind === "review")!.reason).toContain("synthèse valide");
  s.chats.length = 0;
  rmSync(join(root, "wiki/concepts/beta-hub.md"));
  r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["review"]);
  expect(s.chats).toHaveLength(0);
  expect(queue(root).filter((i) => i.kind === "review")).toHaveLength(1); // the same pages: not queued twice
  expect(queue(root).find((i) => i.kind === "synthesis")).toMatchObject({ status: "open" });
});

test("no judge: the entries are listed and nothing is written, even with --apply; no entry: said", async () => {
  const s = fake({ synth });
  const root = await wiki(s.base_url, { judge: false });
  const before = snapshot(root);
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["candidate"]);
  expect(s.chats).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
  const empty = await wiki(s.base_url, { entry: false });
  expect((await run(empty)).messages.map((m) => m.text)).toContain("Aucune synthèse à écrire dans la file.");
});
