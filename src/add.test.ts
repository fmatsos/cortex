import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, pageTitle, socialPost } from "./add";

test("socialPost: the post's text from JSON-LD, without its comments; nothing on an ordinary page", () => {
  const ld = { "@context": "http://schema.org", "@type": "SocialMediaPosting", articleBody: "Le post.\n\nSuite.", datePublished: "2026-11-04T11:29:06Z",
    author: { "@type": "Person", name: "Clement" }, comment: [{ "@type": "Comment", text: "un commentaire" }] };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>un commentaire</body></html>`;
  expect(socialPost(html)).toEqual({ body: "Le post.\n\nSuite.", author: "Clement", published: "2026-11-04T11:29:06Z" });
  expect(socialPost(`<script type="application/ld+json">{"@type":"Article","articleBody":"x"}</script>`)).toBeUndefined();
  const repost = { "@type": "SocialMediaPosting", articleBody: "Mon avis.", author: { name: "Sabri" },
    sharedContent: { "@type": "WebPage", headline: "15 ans d'xp.\n\nLa suite.", author: { name: "Nicolas" } } };
  expect(socialPost(`<script type="application/ld+json">${JSON.stringify(repost)}</script>`)?.body).toBe("Mon avis.\n\n> Nicolas: 15 ans d'xp.\n>\n> La suite.");
  const pics = { "@type": "SocialMediaPosting", articleBody: "Avec images.", image: [{ "@type": "ImageObject", url: "https://i/1.jpg" }, "https://i/2.jpg"] };
  expect(socialPost(`<script type="application/ld+json">${JSON.stringify(pics)}</script>`)?.body).toBe("Avec images.\n\n![](https://i/1.jpg)\n\n![](https://i/2.jpg)");
  expect(socialPost(`<script type="application/ld+json">{oops</script>`)).toBeUndefined();
});
import { renderIndex } from "./catalog";
import { rawPath } from "./lib";
import { search } from "./search";
import { UUID } from "./test-helpers";

test("add → index → search, idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2000-01-01","kind":"update","text":"ancien"}\n');
  await Bun.write(join(root, "wiki/concepts/x.md"), "---\ntype: Concept\ntitle: Relecture\ndescription: D.\n---\nCorps sur la relecture.\n");
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée sur l'hydroponie et la relecture.\n");

  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, note, { note: "test", now });
  expect(a.duplicate).toBe(false);
  expect((await add(root, note, { note: "test", now })).duplicate).toBe(true);
  const jsonl = (await Bun.file(join(root, "wiki/log.jsonl")).text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(jsonl).toHaveLength(2); // the duplicate add writes nothing
  expect(UUID.test(a.id)).toBe(true);
  expect(rawPath(root, a.id)).toBe(`raw/2026/11/${a.id}/source.md`); // filed by month of addition
  expect(jsonl[1]).toMatchObject({ kind: "add", text: `\`${a.id}\`.`, sources: [a.id] });
  expect(jsonl[1].at).toMatch(/^2026-11-04T10:00:00[+-]\d\d:\d\d$/);
  const log = await Bun.file(join(root, "wiki/log.md")).text();
  expect(log).toContain(`## 2026-11-04\n- **Add** \`${a.id}\`.\n\n## 2000-01-01\n- **Update** ancien\n`); // without repeating the id already in the text

  expect(await renderIndex(root)).toContain("- [Relecture](/wiki/concepts/x.md) — D.");
  const hits = await search(root, "relecture");
  expect(hits.map((h) => h.area)).toEqual(["wiki", "raw"]); // wiki first
  expect((await search(root, "hydroponie", { in: "raw" }))[0].path).toContain(a.id);
});

test("pageTitle: the page side of « Page · Site » when defuddle kept the site side, otherwise defuddle", () => {
  expect(pageTitle("Hugging Face", "Qwen/Qwen3-4B-Instruct-2507 · Hugging Face", undefined, "u")).toBe("Qwen/Qwen3-4B-Instruct-2507");
  expect(pageTitle("Un article", "Un article | Le Blog", undefined, "u")).toBe("Un article");
  expect(pageTitle("Context rot - why it matters", "Context rot - why it matters", undefined, "u")).toBe("Context rot - why it matters");
  expect(pageTitle(undefined, undefined, "Titre H1", "u")).toBe("Titre H1");
  expect(pageTitle("", "", undefined, "https://x")).toBe("https://x");
});

test("add --linked-from: the source and its parent tied both ways, an unknown parent refused before anything is written", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const now = new Date("2026-11-04T10:00:00");
  const mail = await add(root, "-", { text: "# Newsletter\n\nWhat changed this week.\n", now });
  const page = join(root, "p.md");
  await Bun.write(page, "# Linked page\n\nThe details.\n");
  await expect(add(root, page, { linkedFrom: "nope", now })).rejects.toThrow("--linked-from: no source nope");
  expect((await add(root, page, { linkedFrom: mail.id, dryRun: true, now })).duplicate).toBe(false); // dry run: nothing tied
  const p = await add(root, page, { linkedFrom: mail.id, now });
  await add(root, page, { linkedFrom: mail.id, now }); // again: duplicate, not tied twice
  const fm = async (id: string) => Bun.file(join(root, rawPath(root, id)!)).text();
  expect(await fm(p.id)).toContain(`linked_from: [${mail.id}]\n`);
  expect(await fm(mail.id)).toContain(`linked: [${p.id}]\n`);
});

// the smallest bytes `imageType` takes for a PNG / a JPEG
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const imageRoot = async (cfg: object) => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), JSON.stringify(cfg));
  await Bun.write(join(root, "photo.png"), PNG);
  await Bun.write(join(root, "scan.jpg"), JPG);
  await Bun.write(join(root, "fake.png"), "not an image");
  return root;
};

test("add an image: the model's description is the source, the title its first heading, the image a blob; a duplicate costs no model call", async () => {
  const root = await imageRoot({ client: "openai", model: "qwen3-vl" });
  const calls: [number, string, string | undefined][] = [];
  const describe = async (b: Uint8Array, mime: string, cfg: { model?: string }) => { calls.push([b.length, mime, cfg.model]); return "# Facture Acme\n\nUne facture de 120 EUR.\n\n## Text\n\nTotal 120 EUR\n"; };
  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, join(root, "photo.png"), { note: "n", now, describe });
  expect(calls).toEqual([[PNG.length, "image/png", "qwen3-vl"]]);
  const text = await Bun.file(join(root, rawPath(root, a.id)!)).text();
  expect(text).toContain("title: Facture Acme\n");
  expect(text).toContain("kind: image\n");
  expect(text).toContain("content: resource\n");
  expect(text).toContain("extractor: openai:qwen3-vl\n");
  expect(text).toContain("Total 120 EUR");
  const blob = text.match(/^blob: (.+)$/m)![1];
  expect(blob).toMatch(/^\.cortex\/blobs\/[0-9a-f]{64}\.png$/);
  expect(new Uint8Array(await Bun.file(join(root, blob)).arrayBuffer())).toEqual(PNG);
  expect((await add(root, join(root, "photo.png"), { now, describe })).duplicate).toBe(true);
  expect(calls).toHaveLength(1); // same bytes: found before the model is asked
  // a model that wraps its answer in a fence, and gives no title: the file's name
  const b = await add(root, join(root, "scan.jpg"), { now, describe: async () => "```markdown\nSans titre.\n```" });
  expect(await Bun.file(join(root, rawPath(root, b.id)!)).text()).toContain("title: scan\n");
});

test("add an image: a dry run never calls the model, and what cannot describe an image fails clearly with nothing written", async () => {
  const root = await imageRoot({ client: "openai", model: "m" });
  const never = async () => { throw new Error("the model was called"); };
  const dry = await add(root, join(root, "photo.png"), { dryRun: true, describe: never });
  expect(dry).toMatchObject({ duplicate: false, ex: { kind: "image", extractor: "openai:m" } });
  expect(existsSync(join(root, "raw"))).toBe(false);
  await expect(add(root, join(root, "fake.png"), { describe: never })).rejects.toThrow("not a PNG, JPEG, WebP or GIF image");
  await expect(add(root, join(root, "photo.png"), { describe: async () => "  " })).rejects.toThrow("described nothing");
  await expect(add(root, join(root, "photo.png"), { describe: async () => { throw new Error("HTTP 500"); } })).rejects.toThrow("HTTP 500");
  for (const [cfg, msg] of [[{}, "no client is set"], [{ client: "opencode" }, "opencode client cannot take an image"], [{ client: "openai" }, "needs a model"]] as const) {
    const bare = await imageRoot(cfg);
    await expect(add(bare, join(bare, "photo.png"), { describe: never })).rejects.toThrow(msg);
    await expect(add(bare, join(bare, "photo.png"), { dryRun: true, describe: never })).rejects.toThrow(msg); // a dry run says so too
    expect(existsSync(join(bare, "raw"))).toBe(false); // never an empty source
    expect(existsSync(join(bare, ".cortex"))).toBe(false);
  }
  expect(existsSync(join(root, "raw"))).toBe(false);
});

/** A `pandoc` on the PATH for the length of `run`: a script that logs its arguments, and answers by `body` (shell) for anything but `--version`. */
async function withPandoc<T>(body: string, run: (log: string) => Promise<T>): Promise<T> {
  const bin = mkdtempSync(join(tmpdir(), "cortex-bin-")), log = join(bin, "args.log"), path = process.env.PATH;
  await Bun.write(join(bin, "pandoc"), `#!/bin/sh\n[ "$1" = "--version" ] && { echo "pandoc 9.9.1"; exit 0; }\necho "$@" > ${log}\ncat > /dev/null\n${body}\n`);
  Bun.spawnSync(["chmod", "+x", join(bin, "pandoc")]);
  process.env.PATH = `${bin}:${path}`;
  try { return await run(log); } finally { process.env.PATH = path; }
}

test("add a document: pandoc's Markdown is the source (title from its heading, else the file's name), the original a blob; a failure or no pandoc writes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const docx = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
  await Bun.write(join(root, "rapport.docx"), docx);
  await Bun.write(join(root, "page.HTM"), "<p>x</p>");
  const now = new Date("2026-11-04T10:00:00");
  await withPandoc(`printf '# Rapport annuel\\n\\nUn texte.\\n'`, async (log) => {
    const dry = await add(root, join(root, "rapport.docx"), { dryRun: true, now });
    expect(dry).toMatchObject({ duplicate: false, ex: { kind: "document", extractor: "pandoc/9.9.1" } });
    expect(existsSync(join(root, "raw"))).toBe(false);
    const a = await add(root, join(root, "rapport.docx"), { now });
    expect(await Bun.file(log).text()).toBe("-f docx -t gfm --wrap=none\n");
    const text = await Bun.file(join(root, rawPath(root, a.id)!)).text();
    expect(text).toContain("title: Rapport annuel\n");
    expect(text).toContain("kind: document\n");
    expect(text).toContain("content: resource\n");
    expect(text).toContain("extractor: pandoc/9.9.1\n");
    const blob = text.match(/^blob: (.+)$/m)![1];
    expect(blob).toEndWith(".docx");
    expect(new Uint8Array(await Bun.file(join(root, blob)).arrayBuffer())).toEqual(docx);
    await add(root, join(root, "page.HTM"), { now }); // html: the same, the format named for pandoc
    expect(await Bun.file(log).text()).toBe("-f html -t gfm --wrap=none\n");
  });
  const before = await Bun.file(join(root, "wiki/log.jsonl")).text();
  await Bun.write(join(root, "autre.odt"), new Uint8Array([0x50, 0x4b, 3, 4]));
  await withPandoc(`echo "boom" >&2; exit 3`, async () => { await expect(add(root, join(root, "autre.odt"), { now })).rejects.toThrow("pandoc failed: boom"); });
  await withPandoc(`printf '  \\n'`, async () => { await expect(add(root, join(root, "autre.odt"), { now })).rejects.toThrow("Document without text"); });
  const path = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), "cortex-empty-")); // no pandoc here, whatever the machine has
  try {
    const err = await add(root, join(root, "autre.odt"), { now }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toHaveProperty("code", "refused"); // a failure: the inbox keeps the entry
    expect((err as Error).message).toContain("pandoc not found");
    expect((err as Error).message).toContain("apt install pandoc");
  } finally { process.env.PATH = path; }
  expect(await Bun.file(join(root, "wiki/log.jsonl")).text()).toBe(before); // nothing was added by the failures
});
