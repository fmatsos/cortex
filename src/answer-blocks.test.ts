import { expect, test } from "bun:test";
import { answerSegments, blockRegistry, draftMarkdown, flattenBlocks } from "./answer-blocks";
import { runExtra } from "./backends/backend";

const titles = new Map([["wiki/concepts/bun.md", "Bun"]]);

test("render_blocks: checked before it runs, named once where the answer puts it, the unnamed ones at the end", async () => {
  const r = blockRegistry();
  expect(await runExtra(r.tool, { blocks: [{ type: "table", columns: ["a"] }] })).toStartWith("invalid arguments: blocks.0.rows");
  const ok = await runExtra(r.tool, { blocks: [
    { type: "callout", tone: "warning", text: "Attention [Bun](/wiki/concepts/bun.md)" },
    { type: "facts", items: [{ label: "Version", value: "1.4" }] },
  ] });
  expect(ok).toContain("{{bloc-1}} (callout), {{bloc-2}} (facts)");
  const md = r.assemble("Intro.\n\n{{bloc-2}}\n\nSuite {{ bloc-2 }}.");
  expect(md.match(/```cortex-ui/g)).toHaveLength(2); // bloc-2 once, bloc-1 appended
  expect(md.indexOf('"facts"')).toBeLessThan(md.indexOf('"callout"'));
  expect(flattenBlocks(md)).toContain("- **Version** : 1.4");
});

test("answer segments: prose and blocks in order, text fields rendered and sanitized, missing pages and bad fences handled", () => {
  const fence = (b: unknown) => `\n\n\`\`\`cortex-ui\n${JSON.stringify(b)}\n\`\`\`\n\n`;
  const md = "Avant [Bun](/wiki/concepts/bun.md)." +
    fence({ type: "callout", tone: "info", title: "<b>T</b>", text: "Voir [Bun](/wiki/concepts/bun.md)<script>x</script>" }) +
    "Milieu." + fence({ type: "pages", items: [{ path: "/wiki/nope.md", summary: "x" }] }) + fence({ type: "nope" }) + "Fin.";
  const s = answerSegments(md, titles);
  expect(s.map((x) => ("block" in x ? x.block.type : "html"))).toEqual(["html", "callout", "html"]);
  const callout = (s[1] as { block: { title: string; html: string } }).block;
  expect(callout.title).toBe("&lt;b&gt;T&lt;/b&gt;");
  expect(callout.html).toContain('href="wiki/concepts/bun/"');
  expect(callout.html).not.toContain("<script");
  const last = (s[2] as { html: string }).html;
  expect(last).toContain("cortex-ui"); // an unreadable fence is shown, never dropped
  expect(last).not.toContain("wiki/nope"); // a pages block with no existing page is dropped
});

test("draftMarkdown: with no block known, names whole or half written are dropped from the streamed text; the rest is untouched", () => {
  expect(draftMarkdown("Intro\n\n{{bloc-1}}\n\nSuite {{ bloc-2 }} fin")).toBe("Intro\n\n\n\nSuite  fin");
  for (const half of ["{{", "{{blo", "{{bloc-1", "{{bloc-1}"]) expect(draftMarkdown(`Texte ${half}`)).toBe("Texte ");
  expect(draftMarkdown("a `{x}` b")).toBe("a `{x}` b");
});

test("registry draft: a known block is drawn where it is named (once), an unknown or half-written name dropped, an unnamed block left out; assemble keeps it for the end and the registry stays reusable", async () => {
  const r = blockRegistry();
  await runExtra(r.tool, { blocks: [{ type: "facts", items: [{ label: "V", value: "1" }] }, { type: "callout", tone: "info", text: "Note" }] });
  const d = r.draft("Intro\n\n{{bloc-1}}\n\nSuite {{ bloc-1 }} {{bloc-9}} fin {{bloc-");
  expect(d.match(/```cortex-ui/g)).toHaveLength(1); // bloc-1 once, bloc-2 not named yet
  expect(d).toContain('"facts"');
  expect(d).not.toContain("bloc");
  expect(d).toEndWith("fin ");
  const s = answerSegments(d, titles);
  expect(s.map((x) => ("block" in x ? x.block.type : "html"))).toEqual(["html", "facts", "html"]);
  const text = "Intro\n\n{{bloc-1}}\n\nSuite";
  const final = r.assemble(text);
  expect(final.match(/```cortex-ui/g)).toHaveLength(2); // the unnamed callout closes the answer
  expect(r.assemble(text)).toBe(final); // nothing is consumed by a call
  expect(r.assemble(`${text}\n\n{{bloc-2}}`)).toBe(r.draft(`${text}\n\n{{bloc-2}}`).trim()); // all named: the last draft is the final answer
});

test("render_blocks called twice: the second call adds blocks, numbering goes on, the names of the first stay valid", async () => {
  const r = blockRegistry();
  await runExtra(r.tool, { blocks: [{ type: "facts", items: [{ label: "V", value: "1" }] }] });
  const second = await runExtra(r.tool, { blocks: [{ type: "callout", tone: "warning", text: "Attention" }] });
  expect(second).toContain("{{bloc-2}} (callout)");
  const md = r.assemble("A\n\n{{bloc-1}}\n\nB\n\n{{bloc-2}}");
  expect(md.indexOf('"facts"')).toBeLessThan(md.indexOf('"callout"'));
  expect(md.match(/```cortex-ui/g)).toHaveLength(2);
});
