import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { refresh } from "./embed";
import { lint } from "./lint";
import { applyQueueEntry, maintainCtx } from "./maintain";
import { parseBody } from "./maintain-split";
import type { Message } from "./print";
import { queueItems, readQueue } from "./queue";

// `cortex maintain split` end to end on a planted wiki, against a fake llama.cpp: /embeddings (a vector per subject, read from
// the text), /systemone (the verdict on a page by title, and the duplicate guard) and /chat/completions (the `split` call, scripted).
//   Big topic: two subjects (Alpha and Beta sections), short. Long page: more words than splitWords, one subject. Tidy page: one subject, short.

const NOW = new Date("2026-11-06T10:00:00+01:00");
const roots: string[] = [];
const servers: { stop(close?: boolean): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })); });

const SUBJECT: [RegExp, number[]][] = [[/Alpha/, [1, 0, 0, 0, 0]], [/Beta/, [0, 1, 0, 0, 0]], [/Gamma/, [0, 0, 1, 0, 0]], [/Zeta/, [0, 0, 0, 0, 1]]];
const vec = (t: string) => SUBJECT.find(([re]) => re.test(t))?.[1] ?? [0, 0, 0, 1, 0];

type Chat = { messages: { role: string; content: string }[] };
/** `verdicts`: by page title, the answer of the judge on its shape. `dup`: titles the duplicate guard refuses. `plan`: the scripted model, called with its number. */
function fake(o: { verdicts?: Record<string, [string, number]>; dup?: string[]; plan?: (b: Chat, n: number) => object } = {}) {
  const judged: string[] = [], chats: Chat[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url), b: any = await req.json();
    if (url.pathname.endsWith("/embeddings")) return Response.json({ data: (b.input as string[]).map((t, index) => ({ index, embedding: vec(t) })) });
    if (url.pathname.endsWith("/systemone")) {
      if (b.questions.dup) {
        const hit = o.dup?.some((t) => b.state.new_page.title === t);
        const choice = hit ? "p1" : "none", p = 0.9;
        return Response.json({ answers: { dup: { type: "choice", choice, confidence: p, probabilities: { p1: 0, none: 0, [choice]: p } } } });
      }
      judged.push(b.state.title);
      const [choice, p] = o.verdicts?.[b.state.title] ?? ["one", 0.9];
      return Response.json({ answers: { shape: { type: "choice", choice, confidence: p, probabilities: { one: 0, several: 0, unsure: 0, [choice]: p } } } });
    }
    chats.push(b);
    const r = o.plan?.(b, chats.length);
    if (!r) return new Response("no script", { status: 500 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(r) } }] });
  } });
  servers.push(server);
  return { base_url: `http://127.0.0.1:${server.port}/v1`, judged, chats };
}

const PLAN = {
  keep: { title: "Big topic", description: "L'essentiel du sujet Alpha.", sections: [0, 1] },
  pages: [{ kind: "Concept", title: "Beta subject", description: "Le sujet Beta, à part.", sections: [2, 3], intro: "Beta est le second sujet de la page d'origine, traité ici à part." }],
};
const SEVERAL: [string, number] = ["several", 0.95];

const R = (n: string) => `/raw/2026/10/${n}/source.md`;
const page = (type: string, title: string, o: { status?: string; tags?: string[]; sources?: string[]; body: string }) =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\nstatus: ${o.status ?? "stable"}\ntags: [${(o.tags ?? []).join(", ")}]\n${
    o.sources ? `sources:\n${o.sources.map((id) => `  - id: ${id}\n    resource: ${R(id)}\n    title: Raw ${id}`).join("\n")}\n` : ""}---\n${o.body}\n`;

const BIG = `Paragraphe d'ouverture sur le grand sujet.\n\n## Alpha one\nFaits Alpha un [^a].\n\n## Alpha two\nFaits Alpha deux [^a].\n\n### Détail\nUn sous-titre reste avec sa section.\n\n## Beta one\nFaits Beta un [^b].\n\n## Beta two\n\`\`\`\n## pas un titre\n\`\`\`\nFaits Beta deux [^b].\n\n## Pages liées\n- [Other page](/wiki/concepts/other-page.md)\n\n[^a]: Raw a, ${R("a")}\n[^b]: Raw b, ${R("b")}`;
const LONG = (words: number) => `Ouverture.\n\n## Un\n${"mot ".repeat(words)}\n\n## Deux\nSuite.\n\n## Trois\nFin.`;

async function wiki(base_url: string, o: { judge?: boolean; embed?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cortex-split-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", base_url, language: "French", page_path: "{type}/{slug}", ...(o.embed === false ? {} : { embed: { base_url, dims: 5 } }), ...(o.judge === false ? {} : { judge: { base_url } }) }));
  for (const n of ["a", "b"]) await Bun.write(join(root, `raw/2026/10/${n}/source.md`), `---\ntype: RawSource\ntitle: Raw ${n}\nstatus: compiled\n---\nTexte ${n}.\n`);
  const w = (p: string, text: string) => Bun.write(join(root, `wiki/${p}.md`), text);
  await w("concepts/big-topic", page("Concept", "Big topic", { tags: ["llm", "perf"], sources: ["a", "b"], body: BIG }));
  await w("concepts/long-page", page("Concept", "Long page", { body: LONG(2600) }));
  await w("concepts/tidy-page", page("Concept", "Tidy page", { body: LONG(10) }));
  await w("concepts/small-page", page("Concept", "Small page", { body: "Ouverture.\n\n## Un\nA.\n\n## Deux\nB." }));
  await w("concepts/other-page", page("Concept", "Other page", { tags: ["llm"], body: "Voir [Big topic](/wiki/concepts/big-topic.md), [Long page](/wiki/concepts/long-page.md), [Tidy page](/wiki/concepts/tidy-page.md) et [Small page](/wiki/concepts/small-page.md)." }));
  await w("concepts/zeta-existing", page("Concept", "Zeta existing", { body: "Zeta est déjà une page. [Other page](/wiki/concepts/other-page.md)" }));
  await w("concepts/mention", page("Concept", "Mention", { tags: ["llm"], body: "Le Beta subject est un sujet à part pour les agents. [Big topic](/wiki/concepts/big-topic.md)" }));
  await refresh(root);
  return root;
}

const text = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const snapshot = (root: string) => Object.fromEntries([...new Bun.Glob("wiki/**/*").scanSync({ cwd: root })].sort().map((p) => [p, text(root, p)]));
const run = async (root: string, o: { apply?: boolean; limit?: number } = {}) => {
  const messages: Message[] = [];
  const r = await maintainCtx(openWiki(root), "split", { now: () => NOW, ...o }, (m) => messages.push(m));
  return { ...r, messages };
};
const queue = (root: string) => queueItems(readQueue(root).entries);
const VERDICTS = { "Big topic": SEVERAL, "Long page": ["one", 0.9] } as Record<string, [string, number]>;

test("sections: a heading in a code fence is not one, a list of links is not movable, the definitions are set aside", () => {
  const p = parseBody(BIG);
  expect(p.pre).toBe("Paragraphe d'ouverture sur le grand sujet.");
  expect(p.blocks.map((b) => [b.heading, b.movable])).toEqual([["Alpha one", true], ["Alpha two", true], ["Beta one", true], ["Beta two", true], ["Pages liées", false]]);
  expect(p.blocks[1].text).toContain("### Détail");
  expect(p.blocks[3].text).toContain("## pas un titre");
  expect([...p.defs.keys()]).toEqual(["a", "b"]);
  expect(p.blocks[4].text).not.toContain("[^b]");
});

test("without --apply: the candidates are judged and listed, nothing is written and the model is not called", async () => {
  const s = fake({ verdicts: VERDICTS, plan: () => PLAN });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root);
  expect(r.ok).toBe(true);
  expect(r.items).toEqual([{ action: "would-split", pages: ["wiki/concepts/big-topic.md"], note: "several 0.95" }]);
  expect(s.judged.sort()).toEqual(["Big topic", "Long page"]); // the long page is a candidate by its words, the short ones are not
  expect(r.messages.at(-1)!.text).toContain("rien n'a été modifié");
  expect(s.chats).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
  expect(existsSync(join(root, ".cortex/maintain.json"))).toBe(false);
});

test("--apply: sections moved as they are, notes and sources follow, the page keeps the rest, links, queue, journal, state; a rerun does nothing", async () => {
  const s = fake({ verdicts: VERDICTS, plan: () => PLAN });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.ok).toBe(true);
  expect(r.items).toEqual([{ action: "split", pages: ["wiki/concepts/big-topic.md", "wiki/concepts/beta-subject.md"], note: "several 0.95" }]);
  expect(s.chats).toHaveLength(1);
  const sent = s.chats[0].messages;
  expect(sent[0].content).toContain("Never use the double-quote character");
  expect(sent[1].content).toContain("0. Alpha one — Faits Alpha un.\n1. Alpha two");
  expect(sent[1].content).toContain("Groups of sections close in meaning (a suggestion):\n- 0, 1\n- 2, 3");
  expect(sent[1].content).not.toContain("Faits Beta deux"); // first lines only
  expect(sent[1].content).not.toContain("Pages liées");

  const made = text(root, "wiki/concepts/beta-subject.md");
  expect(made).toContain("type: Concept");
  expect(made).toContain("status: draft");
  expect(made).toContain('generated: { by: "openai/m:maintain"');
  expect(made).toContain("description: \"Le sujet Beta, à part.\"");
  expect(made).toMatch(/tags:\n {2}- llm\n {2}- perf|tags: \["llm","perf"\]/);
  expect(made).toContain("Beta est le second sujet de la page d'origine, traité ici à part.\n\n## Beta one\nFaits Beta un [^b].\n\n## Beta two\n```\n## pas un titre\n```\nFaits Beta deux [^b].");
  expect(made).toContain("## Voir aussi\n- [Big topic](/wiki/concepts/big-topic.md)");
  expect(made).toContain(`[^b]: Raw b, ${R("b")}`);
  expect(made).not.toContain("[^a]");
  expect(made).toMatch(/sources:\n {2}- id: b\n {4}resource: \/raw\/2026\/10\/b\/source.md\n {4}title: Raw b\n/);
  expect(made).not.toContain("id: a");

  const kept = text(root, "wiki/concepts/big-topic.md");
  expect(kept).toContain("status: draft");
  expect(kept).toContain("Paragraphe d'ouverture sur le grand sujet.\n\n## Alpha one\nFaits Alpha un [^a].\n\n## Alpha two\nFaits Alpha deux [^a].\n\n### Détail\nUn sous-titre reste avec sa section.\n\n## Pages liées\n- [Other page](/wiki/concepts/other-page.md)\n\n## Voir aussi\n- [Beta subject](/wiki/concepts/beta-subject.md)");
  expect(kept).toContain(`[^a]: Raw a, ${R("a")}`);
  expect(kept).not.toContain("Beta one");
  expect(kept).not.toContain("[^b]");
  expect(kept).toContain("description: \"L'essentiel du sujet Alpha.\"");

  // a mention of the new title elsewhere becomes a link to the new page
  expect(text(root, "wiki/concepts/mention.md")).toContain("Le [Beta subject](/wiki/concepts/beta-subject.md) est un sujet");

  // clean for lint, journal, state (vectors by section hash, the one-subject page noted), index
  expect((await lint(root)).filter((i) => ["wiki/concepts/big-topic.md", "wiki/concepts/beta-subject.md"].includes(i.path) && i.level !== "info")).toEqual([]);
  expect(text(root, "wiki/log.jsonl")).toContain("découpage : « Big topic » en « Beta subject »");
  const st = JSON.parse(text(root, ".cortex/maintain.json")).split;
  expect(Object.keys(st.vectors)).toHaveLength(8); // the sections of the pages with at least three: Big topic's four, then the long and the tidy page (two sections in common)
  expect(Object.keys(st.one)).toHaveLength(1);

  // a rerun: the page has two sections left, the long page was judged one subject and is not asked again
  s.judged.length = 0;
  const again = await run(root, { apply: true });
  expect(again.items).toEqual([]);
  expect(s.judged).toEqual([]);
  expect(s.chats).toHaveLength(1);
  expect(Object.keys(JSON.parse(text(root, ".cortex/maintain.json")).split.vectors)).toHaveLength(4); // Big topic has two sections left: its vectors are dropped
});

test("a judge not sure: `several` below the threshold is queued as a split entry that `cortex queue apply` carries out without asking again; `unsure` goes to review", async () => {
  const s = fake({ verdicts: { "Big topic": ["several", 0.6], "Long page": ["unsure", 0.5] }, plan: () => PLAN });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => [i.action, i.pages[0]])).toEqual([["queued", "wiki/concepts/long-page.md"], ["queued", "wiki/concepts/big-topic.md"]]);
  expect(s.chats).toHaveLength(0);
  expect(queue(root).map((i) => [i.kind, i.pages[0]])).toEqual([["review", "wiki/concepts/long-page.md"], ["split", "wiki/concepts/big-topic.md"]]);
  expect(queue(root)[1].proposal).toContain("Groupes de sections proposés :\n- Alpha one, Alpha two\n- Beta one, Beta two");
  // a rerun does not pile them up
  await run(root, { apply: true });
  expect(queue(root)).toHaveLength(2);
  s.judged.length = 0;
  const item = queue(root).find((i) => i.kind === "split")!;
  const done = await applyQueueEntry(openWiki(root), item, () => {});
  expect(done.ok).toBe(true);
  expect(s.judged).toEqual([]);
  expect(text(root, "wiki/concepts/beta-subject.md")).toContain("Faits Beta un [^b].");
  expect(queue(root).find((i) => i.kind === "split")).toMatchObject({ status: "done" });
});

test("a plan that places a section twice or forgets one is asked again with the problem named, then goes to review: the wiki is untouched", async () => {
  const bad = { ...PLAN, pages: [{ ...PLAN.pages[0], sections: [1, 2, 3] }] }; // 1 twice, none lost
  const s = fake({ verdicts: VERDICTS, plan: () => bad });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["review"]);
  expect(s.chats).toHaveLength(3);
  expect(s.chats[1].messages.at(-1)!.content).toContain("sections used more than once: 1");
  const after = snapshot(root);
  for (const p of Object.keys(before)) if (p.startsWith("wiki/concepts/")) expect(after[p]).toBe(before[p]);
  expect(Object.keys(after).filter((p) => p.startsWith("wiki/concepts/"))).toEqual(Object.keys(before).filter((p) => p.startsWith("wiki/concepts/")));
  expect(queue(root)).toMatchObject([{ kind: "review", title: "Découpage non fait : Big topic" }]);
  expect(queue(root)[0].reason).toContain("plan valide");
});

test("a title already taken, or a near title, is refused with the reason before anything is written", async () => {
  const s = fake({ verdicts: VERDICTS, plan: (_, n) => ({ ...PLAN, pages: [{ ...PLAN.pages[0], title: n === 1 ? "Other page" : "Big topic details" }] }) });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  await run(root, { apply: true });
  expect(s.chats[1].messages.at(-1)!.content).toContain("title already taken: Other page");
  expect(s.chats[2].messages.at(-1)!.content).toContain("title too close to the title of another page: Big topic details");
  const after = snapshot(root);
  for (const p of Object.keys(after)) if (p.startsWith("wiki/concepts/")) expect(after[p]).toBe(before[p]);
  expect(Object.keys(after).filter((p) => p.startsWith("wiki/concepts/"))).toEqual(Object.keys(before).filter((p) => p.startsWith("wiki/concepts/")));
});

test("a new page that duplicates another page by meaning is refused by the guard, and nothing is created", async () => {
  const s = fake({ verdicts: VERDICTS, dup: ["Zeta view"], plan: () => ({ ...PLAN, pages: [{ ...PLAN.pages[0], title: "Zeta view", description: "Zeta, vu autrement." }] }) });
  const root = await wiki(s.base_url);
  const before = Object.keys(snapshot(root)).filter((p) => p.startsWith("wiki/concepts/"));
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["review"]);
  expect(queue(root)[0].reason).toContain("ferait doublon : wiki/concepts/zeta-existing.md");
  expect(Object.keys(snapshot(root)).filter((p) => p.startsWith("wiki/concepts/"))).toEqual(before);
  expect(text(root, "wiki/concepts/big-topic.md")).toContain("## Beta one");
});

test("no judge: the candidates are listed and nothing is cut, even with --apply", async () => {
  const s = fake({ plan: () => PLAN });
  const root = await wiki(s.base_url, { judge: false });
  const before = snapshot(root);
  const r = await run(root, { apply: true });
  expect(r.items.map((i) => i.action)).toEqual(["candidate", "candidate"]);
  expect(s.chats).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
});

test("no embeddings: only the long pages are examined, and it is said", async () => {
  const s = fake({ verdicts: VERDICTS });
  const root = await wiki(s.base_url, { embed: false });
  const r = await run(root);
  expect(r.messages.some((m) => m.level === "warn" && m.text.includes("embeddings"))).toBe(true);
  expect(s.judged).toEqual(["Long page"]);
});

test("--limit bounds the pages judged, and --apply without a model says so", async () => {
  const s = fake({ verdicts: VERDICTS });
  const root = await wiki(s.base_url);
  await run(root, { limit: 1 });
  expect(s.judged).toEqual(["Long page"]);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", base_url: s.base_url, embed: { base_url: s.base_url, dims: 5 } }));
  const r = await run(root, { apply: true });
  expect(r.ok).toBe(false);
  expect(r.messages.at(-1)!.text).toContain("a besoin d'un modèle");
});

test("the cached vectors of pages that were not examined survive a run (embeddings off): only the sections that are gone are dropped", async () => {
  const s = fake({ verdicts: VERDICTS, plan: () => PLAN });
  const root = await wiki(s.base_url);
  await run(root, { apply: true });
  const vectors = () => Object.keys(JSON.parse(text(root, ".cortex/maintain.json")).split.vectors).length;
  expect(vectors()).toBe(8);
  // no embed config any more: no page is examined by meaning, so only the page that was cut loses its vectors
  const cfg = JSON.parse(text(root, "cortex.json"));
  delete cfg.embed;
  await Bun.write(join(root, "cortex.json"), JSON.stringify(cfg));
  await run(root, { apply: true });
  expect(vectors()).toBe(4); // Big topic was cut: its four sections are gone; the other pages' vectors stay (they were wiped before)
});
