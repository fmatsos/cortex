import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { buildSiteData } from "./export";
import { fromResource, type Page } from "./doc";
import { isReservedPage, readPages, related, type Related } from "./lib";
import { mcpRoot } from "./test-helpers";

/** The pre-REL-10 `related`, verbatim: it recomputes every page's links per call. The oracle for T10. */
function relatedOld(docs: Page[], path: string): Related[] {
  const links = (d: { body: string }) => new Set([...d.body.matchAll(/\]\((\/wiki\/[^)#\s]+)/g)].map((m) => fromResource(m[1])));
  const resources = (d: Page) => new Set<string>((d.fm.sources ?? []).flatMap((s) => (s.resource ? [s.resource] : [])));
  const pages = docs.filter((d) => !isReservedPage(d.path));
  const me = pages.find((d) => d.path === fromResource(path));
  if (!me) throw new Error(`Page wiki introuvable : ${path}`);
  const out = links(me), mine = resources(me), tags = new Set<string>(me.fm.tags ?? []);
  const hits: Related[] = [];
  for (const d of pages) {
    if (d === me) continue;
    const reasons: Related["reasons"] = [];
    let score = 0;
    const plus = (n: number, why: Related["reasons"][number]) => { score += n; reasons.push(why); };
    if (out.has(d.path)) plus(3, { kind: "out" });
    if (links(d).has(me.path)) plus(3, { kind: "in" });
    for (const r of resources(d)) if (mine.has(r)) plus(2, { kind: "source", value: r });
    for (const t of d.fm.tags ?? []) if (tags.has(t)) plus(1, { kind: "tag", value: t });
    if (score) hits.push({ path: d.path, title: String(d.fm.title ?? ""), score, reasons });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/**
 * Deterministic wiki of `n` pages with `links` links each (a pseudo-random permutation walk, duplicates, self links,
 * links to missing pages and to index.md included), 40 tags, and one raw source cited by every 10th page.
 */
async function bigRoot(n: number, links: number) {
  const root = mkdtempSync(join(tmpdir(), "cortex-scale-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const raws = Math.ceil(n / 10);
  const rawRes = (k: number) => `/raw/2026/11/00000000-0000-7000-8000-${String(k).padStart(12, "0")}/source.md`;
  const writes: Promise<unknown>[] = [];
  for (let k = 0; k < raws; k++)
    writes.push(Bun.write(join(root, rawRes(k)), `---\ntype: RawSource\ntitle: R${k}\nurl: https://example.com/${k}\nnote: n\nstatus: compiled\n---\nTexte ${k}.\n`));
  const path = (i: number) => `wiki/${i % 7 === 0 ? "sources" : i % 3 === 0 ? "entities" : "concepts"}/p${String(i).padStart(5, "0")}.md`;
  for (let i = 0; i < n; i++) {
    const type = i % 7 === 0 ? "Source" : i % 3 === 0 ? "Entity" : "Concept";
    const body: string[] = [`Page ${i}, un paragraphe avec du **gras** et un mot rare zz${i}.`];
    for (let k = 0; k < links; k++) {
      const t = (i * 31 + k * 97 + (k * k) * 13) % (n + 5); // some targets are out of range: missing pages
      body.push(k % 11 === 10 ? "[Index](/wiki/index.md)" : `[P${t}](/${path(t)}${k % 5 === 0 ? "#x" : ""})`);
    }
    const tags = [`t${i % 40}`, `t${(i * 7) % 40}`, `t${(i * 13) % 40}`].join(", ");
    const src = i % 10 === 0 ? `sources:\n  - id: r\n    resource: ${rawRes(i / 10)}\n    title: R\n` : "";
    writes.push(Bun.write(join(root, path(i)), `---\ntype: ${type}\ntitle: Page ${i}\ndescription: D ${i}.\ntags: [${tags}]\n${src}---\n${body.join(" ")}\n[^r]: n\n`));
  }
  await Promise.all(writes);
  await Bun.write(join(root, "wiki/index.md"), "# Index\n");
  return root;
}

test("T10 related : liens précalculés == related d'avant, sur la fixture mcpRoot", async () => {
  const { linkGraph } = await import("./lib");
  const { pages } = await readPages(await mcpRoot());
  const graph = linkGraph(pages);
  for (const p of ["/wiki/concepts/a.md", "wiki/concepts/b.md", "wiki/entities/c.md"]) {
    const old = relatedOld(pages, p);
    expect(related(pages, p)).toEqual(old); // wrapper with the old signature
    expect(related(pages, p, graph)).toEqual(old); // precomputed link sets
  }
  // captured from the code before the change
  expect(related(pages, "/wiki/concepts/a.md", graph)).toEqual([
    { path: "wiki/concepts/b.md", title: "Beta", score: 6, reasons: [{ kind: "out" }, { kind: "source", value: "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md" }, { kind: "tag", value: "ctx" }] },
    { path: "wiki/entities/c.md", title: "Gamma", score: 6, reasons: [{ kind: "in" }, { kind: "source", value: "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md" }, { kind: "tag", value: "llm" }] },
  ]);
  expect(() => related(pages, "/wiki/concepts/nope.md", graph)).toThrow("introuvable");
});

test("T10 related : même sortie que l'ancien sur un wiki dense (liens doubles, auto-liens, cibles absentes)", async () => {
  const w = openWiki(await bigRoot(120, 12));
  const pages = await w.pages(), graph = await w.linkGraph();
  for (const d of pages.filter((p) => !isReservedPage(p.path)).slice(0, 60)) {
    const old = relatedOld(pages, d.path);
    expect(related(pages, d.path, graph)).toEqual(old);
    expect(related(pages, d.path)).toEqual(old);
  }
  expect(await openWiki(await bigRoot(0, 0)).links()).toEqual(new Map()); // empty wiki
});

test("openWiki : links() et backlinks() sont mémoïsés et cohérents", async () => {
  const w = openWiki(await mcpRoot());
  expect(await w.links()).toBe(await w.links());
  expect(await w.backlinks()).toBe(await w.backlinks());
  expect([...(await w.links()).get("wiki/concepts/a.md")!]).toEqual(["wiki/concepts/b.md"]);
  expect([...(await w.links()).get("wiki/entities/c.md")!]).toEqual(["wiki/concepts/a.md"]);
  expect([...(await w.backlinks()).get("wiki/concepts/a.md")!]).toEqual(["wiki/entities/c.md"]);
  expect((await w.links()).has("wiki/index.md")).toBe(false); // reserved pages are not nodes
});

test("échelle : buildSiteData sur 2 000 pages × 20 liens", async () => {
  const root = await bigRoot(2000, 20);
  const t0 = performance.now();
  const { data, graph, search } = await buildSiteData(root, () => {});
  const ms = performance.now() - t0;
  console.log(`buildSiteData 2000 pages x 20 liens : ${(ms / 1000).toFixed(2)} s`);
  expect(data.pages).toHaveLength(2000);
  expect(graph.links.length).toBeGreaterThan(10_000);
  expect(search.docs).toHaveLength(2000);
  expect(data.pages.every((p) => p.related.length <= 8)).toBe(true);
  expect(ms).toBeLessThan(10_000); // measured 1.3 s after REL-10 (26.8 s before: O(n²) body scans); 10 s keeps the margin for a slow CI
}, 120_000);
