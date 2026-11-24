import { expect, test } from "bun:test";
import { answerSegments, blockRegistry, flattenBlocks } from "./answer-blocks";
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
