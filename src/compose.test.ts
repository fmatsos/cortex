import { expect, test } from "bun:test";
import { linkPages, pageForPrompt, repairPage, tidy, updatePage, writePage } from "./compose";
import { LIMITS } from "./limits";
import { mergeUpdate, sourceId } from "./merge";

const reply = (o: object | string, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { role: "assistant", content: typeof o === "string" ? o : JSON.stringify(o) } }] });
/** Fake server: `answers[i]` answers the i-th request. */
async function serve(answers: ((b: any) => Response)[]) {
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { const b = await req.json(); seen.push(b); return answers[Math.min(seen.length, answers.length) - 1](b); } });
  return { seen, cfg: { model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }, stop: () => server.stop(true) };
}
const body = (id: string, extra = "") => `Context rot is the loss of quality of a model as its context grows.[^${id}] ${extra}It shows from about 50 000 tokens.[^${id}]\n\n## Causes\n\nAttention is diluted over a long context, so that the model loses the thread of what it read at the start.[^${id}] Noise grows with every added token, and the useful passages drown in it, which is why long contexts need to be curated by hand and with care.[^${id}]`;
const facts = [{ claim: "Quality drops after 50k tokens", quote: 'said "50k" tokens' }, { claim: "Attention is diluted", quote: "attention is diluted" }];
const base = { kind: "Concept", title: "Context rot", description: "Quality loss", facts, id: "chroma", language: "English" };

test("tidy: frontmatter, h1, definitions and wiki links go; [[p:N]] kept in bounds; notes pointed at the id", () => {
  const t = tidy("---\ntitle: x\n---\n# Title\nSee [Attention](/wiki/concepts/a.md) and [here](../b.md#x), [web](https://x.org). [[ p : 1 ]] [[p:7]] A.[^zz]\n\n[^zz]: made up", "id", 3);
  expect(t.text).toBe("See Attention and here, [web](https://x.org). [[p:1]]  A.[^id]");
  expect(t.notes).toBe(1);
});

test("linkPages: [[p:N]] becomes the link weave writes; a page not created is its title; an unknown N disappears", () => {
  expect(linkPages("See [[p:0]], [[p:1]] and [[p:5]].", [{ title: "A [x]", path: "wiki/concepts/a.md" }, { title: "B" }])).toBe("See [A x](/wiki/concepts/a.md), B and .");
});

test("write: step name, schema, constant system with the quote rule, user with the note, pages and facts; the body is cleaned", async () => {
  const raw = `${body("whatever", "See [[p:0]] and [[p:9]] and [Qwen](/wiki/entities/q.md). ")}\n\n[^whatever]: invented`;
  const s = await serve([() => reply({ body: raw }), () => reply({ body: body("chroma") })]);
  try {
    const r = await writePage(s.cfg, { ...base, pages: [{ title: "Qwen" }, { title: "Chroma" }] });
    expect(r.noted).toBe(true);
    expect(r.body).toContain("See [[p:0]] and  and Qwen. It shows");
    expect(r.body).not.toContain("[^whatever]");
    expect(r.body).not.toContain("invented");
    expect(r.body.match(/\[\^chroma\]/g)).toHaveLength(4);
    const b = s.seen[0];
    expect(b.response_format.json_schema.name).toBe("write");
    expect(b.response_format.json_schema.schema).toMatchObject({ required: ["body"], properties: { body: { minLength: 300, maxLength: 6000 } } });
    expect(b).toMatchObject({ temperature: 0, max_tokens: 1200 });
    expect(b.messages[0].content).toContain("Never use the double-quote character inside a string value");
    expect(b.messages[0].content).toContain("English");
    expect(b.messages[1].content).toContain("Type: Concept\nTitle: Context rot");
    expect(b.messages[1].content).toContain("Note to cite: [^chroma]");
    expect(b.messages[1].content).toContain("[[p:0]] Qwen\n[[p:1]] Chroma");
    expect(b.messages[1].content).toContain("1. Quality drops after 50k tokens — source: «said '50k' tokens»"); // no straight double quote in what the model reads
    // the system is the same for another page: the server's prompt cache keeps the prefix
    await writePage(s.cfg, { ...base, title: "Other", id: "x" });
    expect(s.seen[1].messages[0].content).toBe(b.messages[0].content);
    expect(s.seen[1].messages[1].content).toContain("No page to mention.");
  } finally { s.stop(); }
});

test("write: a body without the note is asked again with the error; one that never has it still comes back, noted: false", async () => {
  const bare = body("x").replace(/\[\^x\]/g, "");
  const s = await serve([() => reply({ body: bare }), () => reply({ body: body("chroma") })]);
  try {
    expect(await writePage(s.cfg, base)).toMatchObject({ noted: true });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1].messages.at(-1).content).toContain("no note: end each factual sentence with [^chroma]");
  } finally { s.stop(); }
  const t = await serve([() => reply({ body: bare })]);
  try {
    const r = await writePage(t.cfg, base);
    expect(r.noted).toBe(false);
    expect(r.body).toBe(bare.trim());
    expect(t.seen).toHaveLength(LIMITS.pipelineRetries + 1);
  } finally { t.stop(); }
});

test("write: a server failure or nothing usable throws (no page to invent)", async () => {
  const s = await serve([() => reply("not json at all")]);
  try { await expect(writePage(s.cfg, base)).rejects.toThrow("no valid answer"); } finally { s.stop(); }
  const t = await serve([() => new Response("down", { status: 503 })]);
  try { await expect(writePage(t.cfg, base)).rejects.toThrow("503"); } finally { t.stop(); }
});

const page = `---\ntype: Concept\ntitle: Context rot\nstatus: draft\nsources:\n  - id: chroma\n    resource: /raw/chroma/source.md\n    title: Chroma\n---\nOpening.[^chroma]\n\n## Effects\n\nQuality drops.[^chroma]\n\n[^chroma]: Chroma, /raw/chroma/source.md\n`;
const lab = { title: "Lab note", resource: "/raw/lab/source.md" };

test("update: step name, nullable contradiction in the schema, the page and the facts in user; the result merges into the page", async () => {
  const id = sourceId("wiki/concepts/a.md", page, lab);
  expect(id).toBe("lab-note");
  const add = `The lab measured a second effect, a plateau after 80k tokens, on a long benchmark of its own.[^foo] The plateau lasts a while.[^foo]`;
  const s = await serve([() => reply({ section: "## Effects", addition: add, contradiction: null })]);
  try {
    const out = await updatePage(s.cfg, { title: "Context rot", body: page.split("---\n")[2], facts, id, language: "English" });
    expect(out).toMatchObject({ section: "Effects", contradiction: null, noted: true });
    expect(out.addition).toContain("[^lab-note]");
    const b = s.seen[0];
    expect(b.response_format.json_schema.name).toBe("update");
    expect(b.response_format.json_schema.schema.properties.contradiction).toEqual({ type: ["string", "null"], maxLength: 400 });
    expect(b.max_tokens).toBe(800);
    expect(b.messages[0].content).toContain("Never use the double-quote character");
    expect(b.messages[1].content).toContain("Page body:\nOpening.[^chroma]");
    expect(b.messages[1].content).not.toContain("[^chroma]: Chroma"); // definitions are noise for the model
    expect(b.messages[1].content).not.toContain("contradicts the page");
    const m = mergeUpdate("wiki/concepts/a.md", page, out, { id, ...lab })!;
    expect(m.text).toContain("Quality drops.[^chroma]\n\nThe lab measured a second effect");
    expect(m.text).toContain("[^lab-note]: Lab note, /raw/lab/source.md");
  } finally { s.stop(); }
});

test("update: a contradicts connection asks for the contradiction; a contradiction comes back cleaned", async () => {
  const add = "The lab found that quality does not drop before 80k tokens on its own benchmark, whatever the model.[^a]";
  const s = await serve([() => reply({ section: "Effects", addition: add, contradiction: "The lab says the opposite.[^b]" })]);
  try {
    const out = await updatePage(s.cfg, { title: "Context rot", body: "x", facts, id: "lab-note", contradicts: true, language: "English" });
    expect(s.seen[0].messages[1].content).toContain("This source contradicts the page: say how in `contradiction`.");
    expect(out.contradiction).toBe("The lab says the opposite.[^lab-note]");
  } finally { s.stop(); }
});

test("update: no note after the retries, the addition is still returned (noted: false)", async () => {
  const s = await serve([() => reply({ section: "Effects", addition: "A fact about the rot that is long enough to pass the minimum length of an addition, without any note at all.", contradiction: null })]);
  try {
    const out = await updatePage(s.cfg, { title: "T", body: "x", facts, id: "lab-note", language: "English" });
    expect(out.noted).toBe(false);
    expect(s.seen).toHaveLength(LIMITS.pipelineRetries + 1);
  } finally { s.stop(); }
});

test("pageForPrompt: short page whole without definitions; long page = its ## list and its first 3k tokens, said to be cut", () => {
  expect(pageForPrompt("Intro.[^a]\n\n## A\n\nText.\n\n[^a]: Src, /raw/x")).toBe("Intro.[^a]\n\n## A\n\nText.");
  const long = `Intro.\n\n${Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\n${"word ".repeat(400)}`).join("\n\n")}`;
  const cut = pageForPrompt(long);
  expect(cut.startsWith("(This page is long")).toBe(true);
  expect(cut).toContain("- Section 0\n- Section 1");
  expect(cut).not.toContain("Section 39\n\nword"); // only the first 30 titles are listed, and the beginning is cut
  expect(cut.endsWith("(cut)")).toBe(true);
  expect(cut.length).toBeLessThan(3000 * 4 + 1200);
});

test("repair: step name, errors and body in user, the corrected body back", async () => {
  const s = await serve([() => reply({ body: " Fixed body. \n" })]);
  try {
    expect(await repairPage(s.cfg, { body: "Broken.", errors: ["footnote [^x] has no sources[] entry"], language: "English" })).toBe("Fixed body.");
    expect(s.seen[0].response_format.json_schema.name).toBe("repair");
    expect(s.seen[0].messages[1].content).toBe("Problems:\n- footnote [^x] has no sources[] entry\nPage body:\nBroken.");
  } finally { s.stop(); }
});

test("tidy: an external link to a .md file keeps its link; a wiki, raw or relative .md link is reduced to its text", () => {
  const t = tidy("See [README](https://github.com/x/y/blob/main/README.md#top), [doc](http://x.org/a.md), [mail](mailto:a@b.md), [page](/wiki/concepts/a.md), [rel](notes/b.md), [raw](../raw/2026/11/x/source.md).", "id", 0);
  expect(t.text).toBe("See [README](https://github.com/x/y/blob/main/README.md#top), [doc](http://x.org/a.md), [mail](mailto:a@b.md), page, rel, raw.");
});

test("tidy: a paragraph of only links or notes joins the one before; a sentence that copies a fact's quote is dropped", async () => {
  const { tidy } = await import("./compose");
  const quote = "blocks are grouped into super-blocks, and a mixed strategy keeps more bits on the sensitive tensors.";
  const body = `Les K-quants regroupent les blocs.[^x]\n\n[[p:0]]\n\nLa technique est décrite ainsi : «${quote}»\n\n[^x]\n\n## Suite\n\nUn autre fait.\n\n[[p:1]] [[p:0]]`;
  const t = tidy(body, "x", 2, [quote]);
  expect(t.text).toBe("Les K-quants regroupent les blocs.[^x] (voir [[p:0]])\n\n## Suite\n\nUn autre fait. (voir [[p:1]], [[p:0]])");
});
