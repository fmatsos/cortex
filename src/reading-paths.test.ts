import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSiteData } from "./export";
import { lint } from "./lint";
import { maintenance } from "./maintenance";
import { parsePath, readPaths } from "./reading-paths";
import { openWiki } from "./context";
import { pathPosition, toPathNav } from "../site/src/lib/paths";

const page = (type: string, title: string, body = "", extra = "") => `---\ntype: ${type}\ntitle: ${title}\ndescription: About ${title}.\n${extra}---\n${body}\n`;
const NOW = new Date("2026-11-25T12:00:00Z");

/** Three linked pages, a lone one (orphan), a page with a broken link, a pending and a late raw source, and two paths. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-paths-"));
  const w = (f: string, text: string) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); };
  w("cortex.json", JSON.stringify({ review: true, drafts: true }));
  w("wiki/concepts/alpha.md", page("Concept", "Alpha", "See [Beta](/wiki/concepts/beta.md)."));
  w("wiki/concepts/beta.md", page("Concept", "Beta", "See [Gamma](/wiki/entities/gamma.md) and [nothing](/wiki/concepts/missing.md)."));
  w("wiki/entities/gamma.md", page("Entity", "Gamma", "Back to [Alpha](/wiki/concepts/alpha.md)."));
  w("wiki/concepts/lonely.md", page("Concept", "Lonely", "No link in or out."));
  w("wiki/concepts/old.md", page("Concept", "Old", "[Alpha](/wiki/concepts/alpha.md)", "status: deprecated\nstale_after: 2026-01-01\n"));
  w("wiki/concepts/forgotten.md", page("Concept", "Forgotten", "[Alpha](/wiki/concepts/alpha.md)", "generated: { by: x, at: 2026-02-01T10:00:00Z }\nverified: { by: y, at: 2026-01-01T10:00:00Z }\n"));
  w("wiki/index.md", "# Index\n");
  w("raw/2026/11/aaaa/source.md", "---\ntype: RawSource\ntitle: Secret title\nstatus: pending\nfetched_at: 2026-11-24T00:00:00Z\n---\ntext\n");
  w("raw/2026/11/bbbb/source.md", "---\ntype: RawSource\ntitle: Another secret\nstatus: pending\nfetched_at: 2026-11-01T00:00:00Z\n---\ntext\n");
  w("raw/2026/11/cccc/source.md", "---\ntype: RawSource\ntitle: Done\nstatus: compiled\nfetched_at: 2026-11-01T00:00:00Z\n---\ntext\n");
  w("paths/learn-alpha.md", [
    "---", "title: Learn Alpha", "goal: Understand Alpha before Gamma.", "---", "Read these in order.", "",
    "1. [Alpha](/wiki/concepts/alpha.md): the idea everything starts from, see also [Beta](/wiki/concepts/beta.md).",
    "2. [Beta](/wiki/concepts/beta.md) - the part\n   that continues over two lines.",
    "3. [Gamma](/wiki/entities/gamma.md)", "",
  ].join("\n"));
  return root;
}

test("parsePath: front matter, introduction, steps with their reason, separators and continuation lines", () => {
  const p = parsePath("demo", [
    "---", "title: Demo", "goal: A goal", "---", "Intro line.", "", "```md", "1. [Not a step](/wiki/x.md)", "```", "",
    "1. [A \\[draft\\]](/wiki/concepts/a.md#top) — first reason", "",
    "2) [B](/wiki/concepts/b.md): second", "   reason", "lazy line",
    "3. [C](/wiki/concepts/c.md)", "4. not a link", "", "After the list.",
  ].join("\n"));
  expect(p).toMatchObject({ slug: "demo", file: "paths/demo.md", title: "Demo", goal: "A goal" });
  expect(p.intro).toContain("Intro line.");
  expect(p.intro).toContain("1. [Not a step]"); // inside a fence: text, not a step
  expect(p.intro).not.toContain("After the list");
  expect(p.steps).toEqual([
    { page: "wiki/concepts/a.md", label: "A [draft]", reason: "first reason" },
    { page: "wiki/concepts/b.md", label: "B", reason: "second\nreason\nlazy line" },
    { page: "wiki/concepts/c.md", label: "C", reason: "" },
  ]);
  expect(p.problems).toEqual(["step 4 does not start with a link to a wiki page: [title](/wiki/….md)"]);
  expect(parsePath("Bad Name", "---\ntitle: T\ngoal: G\n---\n1. [A](/wiki/a.md)\n").problems[0]).toContain('file name "Bad Name.md"');
});

test("readPaths: the paths/ folder, sorted; no folder, no path; a broken front matter is reported", async () => {
  const root = fixture();
  expect((await readPaths(root)).paths.map((p) => p.slug)).toEqual(["learn-alpha"]);
  writeFileSync(join(root, "paths/bad.md"), "---\ntitle: [oops\n---\nx\n");
  const r = await readPaths(root);
  expect(r.errors.map((e) => e.path)).toEqual(["paths/bad.md"]);
  expect((await readPaths(mkdtempSync(join(tmpdir(), "cortex-nopaths-")))).paths).toEqual([]);
});

test("lint: unknown page, missing title or goal, no reason, duplicate step, step without link", async () => {
  const root = fixture();
  expect((await lint(root, NOW)).filter((i) => i.path.startsWith("paths/")).map((i) => `${i.level} ${i.msg}`)).toEqual(["warning step 3: no reason after the link (why read it here?)"]);
  writeFileSync(join(root, "paths/broken.md"), "---\ntitle: ''\n---\n1. [Ghost](/wiki/concepts/ghost.md): why\n2. [Alpha](/wiki/concepts/alpha.md): a\n3. [Alpha](/wiki/concepts/alpha.md): again\n4. plain text\n");
  writeFileSync(join(root, "paths/empty.md"), "---\ntitle: Empty\ngoal: G\n---\nOnly text.\n");
  const msgs = (await lint(root, NOW)).filter((i) => i.path.startsWith("paths/") && i.path !== "paths/learn-alpha.md").map((i) => `${i.path} ${i.level}: ${i.msg}`);
  expect(msgs).toEqual([
    "paths/broken.md error: missing title",
    "paths/broken.md error: missing goal: what the reader can do after the path",
    "paths/broken.md error: step 4 does not start with a link to a wiki page: [title](/wiki/….md)",
    "paths/broken.md error: step 1: unknown page /wiki/concepts/ghost.md",
    "paths/broken.md warning: step 3: /wiki/concepts/alpha.md is already a step of this path (only its first step is kept)",
    "paths/empty.md error: no step: an ordered list of links to wiki pages",
  ]);
});

test("export: paths are published with titles, rendered reasons and plain reasons; invalid steps and paths are dropped", async () => {
  const root = fixture();
  writeFileSync(join(root, "paths/ghosts.md"), "---\ntitle: Ghosts\ngoal: G\n---\n1. [Ghost](/wiki/concepts/ghost.md): why\n");
  writeFileSync(join(root, "paths/mixed.md"), "---\ntitle: Mixed\ngoal: G\n---\n1. [Ghost](/wiki/concepts/ghost.md): why\n2. [Alpha](/wiki/concepts/alpha.md): ok\n3. [Alpha](/wiki/concepts/alpha.md): twice\n");
  const said: string[] = [];
  const { paths } = await buildSiteData(root, (m) => said.push(m));
  expect(paths.map((p) => p.slug)).toEqual(["learn-alpha", "mixed"]); // "ghosts" has no step left
  const learn = paths[0]!;
  expect(learn).toMatchObject({ title: "Learn Alpha", goal: "Understand Alpha before Gamma." });
  expect(learn.intro).toContain("Read these in order.");
  expect(learn.steps.map((s) => [s.id, s.title, s.type])).toEqual([["concepts/alpha", "Alpha", "Concept"], ["concepts/beta", "Beta", "Concept"], ["entities/gamma", "Gamma", "Entity"]]);
  expect(learn.steps[0]!.reason).toContain('<a href="../../wiki/concepts/beta/">Beta</a>'); // relative to /paths/learn-alpha/
  expect(learn.steps[0]!.reasonText).toBe("the idea everything starts from, see also Beta.");
  expect(learn.steps[1]!.reasonText).toBe("the part that continues over two lines.");
  expect(paths[1]!.steps.map((s) => s.id)).toEqual(["concepts/alpha"]);
  expect(said.some((m) => m.includes("paths/ghosts.md") && m.includes("no step left"))).toBe(true);
  expect(said.some((m) => m.includes("unknown page wiki/concepts/ghost.md"))).toBe(true);
  // the Previous / Next of an article read in the path
  const nav = toPathNav(learn);
  expect(pathPosition(nav, "concepts/beta")).toMatchObject({ n: 2, total: 3, prev: { id: "concepts/alpha" }, next: { id: "entities/gamma" } });
  expect(pathPosition(nav, "concepts/alpha")!.prev).toBeUndefined();
  expect(pathPosition(nav, "concepts/lonely")).toBeUndefined();
});

test("export: a wiki without paths/ publishes none", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-nopaths-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "wiki/concepts/a.md"), page("Concept", "A"));
  expect((await buildSiteData(root, () => {})).paths).toEqual([]);
});

test("maintenance: orphans, broken links, pending raw sources (counts only), stale pages; same orphans and broken links as lint", async () => {
  const root = fixture(), w = openWiki(root);
  const { maintenance: m } = await buildSiteData(root, () => {}, NOW);
  expect(m.orphans.map((p) => p.title)).toEqual(["Forgotten", "Lonely", "Old"]); // nothing links to them
  expect(m.broken).toEqual([{ page: { id: "concepts/beta", title: "Beta", type: "Concept" }, targets: ["wiki/concepts/missing.md"] }]);
  expect(m.raw.pending).toBe(2);
  expect(JSON.stringify(m)).not.toMatch(/secret|aaaa|bbbb/i); // raw sources stay private
  expect(m.review).toBe(true);
  // the stale reasons depend on the export date (NOW)
  expect(m.stale.map((s) => [s.page.title, s.reasons])).toEqual([["Forgotten", [{ kind: "review", since: "2026-02-01" }]], ["Old", [{ kind: "deprecated" }, { kind: "expired", since: "2026-01-01" }]]]);

  const at = maintenance({ pages: (await w.pages()).filter((d) => d.path !== "wiki/index.md"), raws: await w.raws(), exists: () => true, review: true, now: NOW });
  expect(at.raw).toEqual({ pending: 2, late: 1, lateDays: 7 }); // bbbb was fetched 24 days before NOW
  expect(at.broken).toEqual([]);
  expect(at.stale.map((s) => s.page.title)).toEqual(["Forgotten", "Old"]); // review since 2026-02-01: 297 days
  const early = maintenance({ pages: (await w.pages()).filter((d) => d.path !== "wiki/index.md"), raws: [], exists: () => true, review: false, now: new Date("2025-12-01T00:00:00Z") });
  expect(early.stale.map((s) => [s.page.title, s.reasons.map((r) => r.kind)])).toEqual([["Old", ["deprecated"]]]); // not past stale_after yet, review notion off: only the deprecated page

  const issues = await lint(root, NOW);
  const lintOrphans = issues.filter((i) => i.msg.startsWith("orphan")).map((i) => i.path.replace(/^wiki\/concepts\/|\.md$/g, "")).sort();
  expect(lintOrphans).toEqual(["forgotten", "lonely", "old"]);
  expect(issues.filter((i) => i.msg.startsWith("broken link")).map((i) => i.path)).toEqual(["wiki/concepts/beta.md"]);
});
