import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerate } from "./catalog";
import { openWiki } from "./context";
import { isReservedPage } from "./lib";
import { lint } from "./lint";
import { closeCtx, closeEntry, enqueue, enqueueCtx, openItems, parseQueueEntry, queueItems, readQueue, renderQueueMd } from "./queue";
import { mcpRoot } from "./test-helpers";

const CLI = join(import.meta.dir, "cortex.ts");
const cortex = (root: string, args: string[]) => {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, NO_COLOR: "1", CORTEX_ROOT: root } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const T0 = new Date("2026-11-01T10:00:00Z");
const read = (root: string, f: string) => readFileSync(join(root, f), "utf8");

async function seeded() {
  const root = await mcpRoot();
  await enqueue(root, { kind: "synthesis", title: "Synthèse : Alpha / Gamma", reason: "the source links two groups", pages: ["wiki/concepts/a.md", "wiki/entities/c.md"], sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"] }, T0);
  await enqueue(root, { kind: "contradiction", title: "Beta contredit", reason: "dates differ", pages: ["wiki/concepts/b.md"], proposal: "## Beta\n\nNew text." }, new Date(T0.getTime() + 60_000));
  await enqueue(root, { kind: "review", title: "À relire", reason: "judge unsure" }, new Date(T0.getTime() + 120_000));
  return root;
}

test("reserved: wiki/queue.md is a generated page, never a regular one", () => {
  expect(isReservedPage("wiki/queue.md")).toBe(true);
  expect(isReservedPage("wiki/queue.jsonl")).toBe(false);
  expect(isReservedPage("wiki/concepts/queue.md")).toBe(false);
});

test("parseQueueEntry: a valid entry, and the first error of an invalid one", () => {
  const ok: Record<string, unknown> = { at: "2026-11-01", kind: "merge", title: "t", reason: "r", status: "open" };
  expect(parseQueueEntry(ok)).toEqual({ ...ok, pages: [], sources: [] } as never);
  for (const [patch, msg] of [
    [{ kind: "zz" }, "kind:"], [{ at: "hier" }, "at:"], [{ title: "a\nb" }, "title:"], [{ reason: " " }, "reason:"], [{ status: "x" }, "status:"],
    [{ status: "done" }, "needs a ref"], [{ proposal: "" }, "proposal:"], [{ pages: ["x.md"] }, "pages:"], [{ sources: ["a b"] }, "sources:"], [{ extra: 1 }, "unknown field"],
  ] as const) expect(parseQueueEntry({ ...ok, ...patch })).toContain(msg);
  expect(parseQueueEntry([])).toContain("JSON object");
});

test("enqueue then close by reference: numbers stay, the last line for a ref wins, a clash on `at` moves it", async () => {
  const root = await seeded();
  let { entries } = readQueue(root);
  expect(entries.map((e) => e.status)).toEqual(["open", "open", "open"]);
  expect(openItems(queueItems(entries)).map((i) => [i.n, i.kind])).toEqual([[1, "synthesis"], [2, "contradiction"], [3, "review"]]);

  const done = await closeEntry(root, 2, "done", new Date(T0.getTime() + 3600_000));
  expect(done).toMatchObject({ kind: "contradiction", title: "Beta contredit", status: "done", ref: entries[1].at, pages: ["wiki/concepts/b.md"] });
  await closeEntry(root, 1, "dismissed", new Date(T0.getTime() + 3600_000)); // same second as the previous closing: `at` moves on
  entries = readQueue(root).entries;
  expect(new Set(entries.map((e) => e.at)).size).toBe(5);
  const items = queueItems(entries);
  expect(items.map((i) => [i.n, i.status])).toEqual([[1, "dismissed"], [2, "done"], [3, "open"]]); // closing never renumbers
  expect(openItems(items).map((i) => i.n)).toEqual([3]);
  expect(openItems(items, "merge")).toEqual([]);

  const w = openWiki(root);
  await expect(closeCtx(w, 2, "done")).rejects.toThrow("already done");
  await expect(closeCtx(w, 9, "done")).rejects.toThrow("not found");
  // the last line for a ref wins: an `open` entry that references a closed one reopens it
  await Bun.write(join(root, "wiki/queue.jsonl"), read(root, "wiki/queue.jsonl") + JSON.stringify({ ...entries[4], at: "2026-12-01", status: "open" }) + "\n");
  expect(queueItems(readQueue(root).entries).find((i) => i.n === 1)!.status).toBe("open");
});

test("an in-memory context stays current after an append", async () => {
  const w = openWiki(await mcpRoot());
  expect(w.queue().entries).toEqual([]);
  await enqueueCtx(w, { kind: "split", title: "Grosse page", reason: "3000 words" }, T0);
  expect(w.queue().entries).toHaveLength(1);
  expect(queueItems(w.queue().entries)[0]).toMatchObject({ n: 1, kind: "split", status: "open" });
});

test("queue.md: open entries first by kind with pages by title and folded proposal, closed ones last; deterministic", async () => {
  const root = await seeded();
  await closeEntry(root, 3, "dismissed", new Date(T0.getTime() + 3600_000));
  const md = read(root, "wiki/queue.md");
  expect(md).toBe(renderQueueMd(readQueue(root).entries, await openWiki(root).titles()));
  expect(md).toStartWith("# Queue\n\n> Generated from `wiki/queue.jsonl`");
  expect(md.indexOf("### Synthesis")).toBeLessThan(md.indexOf("### Contradiction"));
  expect(md.indexOf("## Open")).toBeLessThan(md.indexOf("## Closed"));
  expect(md).toContain("- **#1** Synthèse : Alpha / Gamma (2026-11-01): the source links two groups\n  - pages: [Alpha](/wiki/concepts/a.md), [Gamma](/wiki/entities/c.md)\n  - sources: `01a1a5c9-5e80-7075-ae13-aab03b0a8697`\n");
  expect(md).toContain("<details><summary>Proposal</summary>\n\n    ## Beta\n\n    New text.\n\n    </details>");
  expect(md).toContain("- **#3** À relire: dismissed (2026-11-01)");
  expect(md).not.toContain("### Review"); // no open review left
  expect(renderQueueMd([])).toContain("No open entry.");
});

test("cortex index regenerates queue.md, only for a wiki that has a queue", async () => {
  const root = await mcpRoot();
  await regenerate(root);
  expect(existsSync(join(root, "wiki/queue.md"))).toBe(false);
  await Bun.write(join(root, "wiki/queue.jsonl"), "");
  await regenerate(root);
  expect(read(root, "wiki/queue.md")).toContain("No open entry.");
});

test("lint: invalid line = error, queue.md edited by hand = warning, open entries past 30 days = one info", async () => {
  const root = await seeded();
  const msgs = async (now: string) => (await lint(root, new Date(now))).filter((i) => i.path.startsWith("wiki/queue")).map((i) => `${i.level} ${i.path} ${i.msg}`);
  expect(await msgs("2026-11-20T00:00:00Z")).toEqual([]);
  expect(await msgs("2026-12-01T10:01:30Z")).toEqual(["info wiki/queue.jsonl 2 open entries older than 30 days (#1, #2): cortex queue"]); // #3 is 29 days 23 h old
  await closeEntry(root, 1, "done", T0);
  expect((await msgs("2026-12-01T10:01:30Z"))[0]).toContain("1 open entry older than 30 days (#2)");
  await Bun.write(join(root, "wiki/queue.md"), "edited");
  await Bun.write(join(root, "wiki/queue.jsonl"), read(root, "wiki/queue.jsonl") + "not json\n" + '{"at":"2026-11-01","kind":"zz"}\n');
  const bad = await msgs("2026-11-20T00:00:00Z");
  expect(bad).toContain("error wiki/queue.jsonl:5 invalid JSON");
  expect(bad.some((m) => m.startsWith("error wiki/queue.jsonl:6 kind:"))).toBe(true);
  expect(bad.some((m) => m.startsWith("warning wiki/queue.md differs from its generation"))).toBe(true);
});

test("cortex queue: list, --kind, --json, done / dismiss, apply not available yet, usage and domain errors", async () => {
  const root = await seeded();
  const list = cortex(root, ["queue"]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/#1 +Synthesis +Synthèse : Alpha \/ Gamma +2026-11-01\n +the source links two groups\n#2 +Contradiction/);
  expect(JSON.parse(cortex(root, ["queue", "--json", "--kind", "review"]).out).map((i: { n: number }) => i.n)).toEqual([3]);
  expect(cortex(root, ["queue", "--kind", "zz"])).toMatchObject({ code: 2, err: "✗ --kind expects synthesis | merge | contradiction | split | review\n" });

  expect(cortex(root, ["queue", "done", "2"])).toMatchObject({ code: 0, out: "✓ #2 done: Beta contredit\n" });
  expect(cortex(root, ["queue", "dismiss", "1"]).out).toBe("✓ #1 dismissed: Synthèse : Alpha / Gamma\n");
  expect(JSON.parse(cortex(root, ["queue", "--json"]).out).map((i: { n: number }) => i.n)).toEqual([3]);
  expect(read(root, "wiki/queue.md")).toContain("- **#2** Beta contredit: done");

  expect(cortex(root, ["queue", "done", "2"])).toMatchObject({ code: 1, err: "✗ queue entry #2 is already done\n" });
  expect(cortex(root, ["queue", "done", "9"]).code).toBe(1);
  const apply = cortex(root, ["queue", "apply", "3"]);
  expect(apply.code).toBe(1);
  expect(apply.err).toContain("not available yet");
  expect(read(root, "wiki/queue.jsonl").trim().split("\n")).toHaveLength(5); // apply wrote nothing
  expect(cortex(root, ["queue", "apply", "9"]).err).toContain("not found");
  for (const a of [["done"], ["done", "x"], ["done", "0"], ["nope", "1"], ["done", "1", "2"]]) expect(cortex(root, ["queue", ...a]).code).toBe(2);
  expect(cortex(await mcpRoot(), ["queue"]).out).toBe("Empty queue.\n");
});

test("cortex lint prints the queue's stale info without counting it as a page never reviewed", async () => {
  const root = await seeded();
  const old = readFileSync(join(root, "wiki/queue.jsonl"), "utf8").replaceAll("2026-11-01T", "2020-01-01T");
  await Bun.write(join(root, "wiki/queue.jsonl"), old);
  const r = cortex(root, ["lint"]);
  expect(r.out).toContain("· wiki/queue.jsonl: 3 open entries older than 30 days (#1, #2, #3): cortex queue");
  expect(r.out).toMatch(/, 3 page\(s\) never reviewed\.\n$/); // the 3 wiki pages of the fixture, not 3 + 1
});

test("MCP queue tool: open entries by kind, pages as resources, `all` adds the closed ones", async () => {
  const { queueForAgent } = await import("./mcp");
  const root = await seeded();
  await closeEntry(root, 2, "done", new Date(T0.getTime() + 3600_000));
  expect(queueForAgent(root).map((i) => [i.n, i.kind])).toEqual([[1, "synthesis"], [3, "review"]]);
  expect(queueForAgent(root)[0].pages).toEqual(["/wiki/concepts/a.md", "/wiki/entities/c.md"]);
  expect(queueForAgent(root, "review").map((i) => i.n)).toEqual([3]);
  expect(queueForAgent(root, undefined, true).map((i) => [i.n, i.status])).toEqual([[1, "open"], [2, "done"], [3, "open"]]);
});

test("site data: the queue is exported, open entries first, with page links and the proposal rendered", async () => {
  const { buildSiteData } = await import("./export");
  const root = await seeded();
  await closeEntry(root, 1, "done", new Date(T0.getTime() + 3600_000));
  const { data } = await buildSiteData(root);
  expect(data.queue.map((e) => [e.n, e.status])).toEqual([[2, "open"], [3, "open"], [1, "done"]]);
  const c = data.queue[0];
  expect(c).toMatchObject({ kind: "contradiction", title: "Beta contredit", html: "dates differ", pages: [{ id: "concepts/b", title: "Beta", type: "Concept" }] });
  expect(c.proposal).toContain("<h2");
  expect(data.queue[2].closedAt).toStartWith("2026-11-01");
  expect(data.queue[2].sources).toEqual([{ id: "01a1a5c9-5e80-7075-ae13-aab03b0a8697" }]);
});
