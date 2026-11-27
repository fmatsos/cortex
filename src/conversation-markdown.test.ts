import { expect, test } from "bun:test";
import { absoluteLinks, conversationFilename, conversationMarkdown, flattenBlocks, normalizeTitle, wikiUrl } from "../site/src/lib/conversation-markdown";

const SITE = "https://wiki.example.org/";
const fence = (b: unknown) => `\`\`\`cortex-ui\n${JSON.stringify(b).replaceAll("`", "\\u0060")}\n\`\`\``;
const titles: Record<string, string> = { "concepts/alpha": "Alpha [draft]", "entities/beta": "Beta" };
const pageTitle = (id: string) => titles[id];

test("export: front matter, title, one heading per question, the Sources list", () => {
  const md = conversationMarkdown({
    title: 'Le "contexte" \\ la fin',
    site: SITE,
    pageTitle,
    now: new Date("2026-11-25T10:00:00.000Z"),
    created: "2026-11-20T08:00:00.000Z",
    turns: [
      { question: "Qu'est-ce que\nAlpha ?", answer: "Alpha est [une idée](/wiki/concepts/alpha.md).", pages: ["concepts/alpha"], at: "2026-11-20T08:01:00.000Z" },
      { question: "Et Beta ?", answer: "Voir [Beta](wiki/entities/beta.md#intro).", pages: ["concepts/alpha", "entities/beta"], at: "2026-11-21T09:00:00.000Z" },
    ],
  });
  expect(md.startsWith([
    "---",
    'title: "Le \\"contexte\\" \\\\ la fin"', // quotes and backslashes of the title escaped
    "date: 2026-11-20T08:00:00.000Z",
    "updated: 2026-11-21T09:00:00.000Z",
    "source: Cortex",
    "wiki: https://wiki.example.org/",
    "exchanges: 2",
    "---",
    "",
    '# Le "contexte" \\ la fin',
    "",
    "## Qu'est-ce que Alpha ?",
    "",
    "Alpha est [une idée](https://wiki.example.org/wiki/concepts/alpha/).",
    "",
    "## Et Beta ?",
    "",
    "Voir [Beta](https://wiki.example.org/wiki/entities/beta/#intro).",
    "",
    "## Sources",
    "",
  ].join("\n"))).toBe(true);
  // the pages of all the answers, once each, in order of first appearance, titles escaped, ids kept
  expect(md.endsWith("- [Alpha \\[draft\\]](https://wiki.example.org/wiki/concepts/alpha/) (`concepts/alpha`)\n- [Beta](https://wiki.example.org/wiki/entities/beta/) (`entities/beta`)\n")).toBe(true);
  expect(md.match(/\(`concepts\/alpha`\)/g)).toHaveLength(1);
});

test("export: no pages, no Sources; dates fall back to now; an empty title gets a name", () => {
  const md = conversationMarkdown({ title: "  ", site: SITE, now: new Date("2026-11-25T10:00:00.000Z"), turns: [{ question: "Q", answer: "A" }] });
  expect(md).not.toContain("## Sources");
  expect(md).toContain("date: 2026-11-25T10:00:00.000Z\nupdated: 2026-11-25T10:00:00.000Z");
  expect(md).toContain('title: "Conversation"');
  expect(md.endsWith("## Q\n\nA\n")).toBe(true);
});

test("links: wiki files become absolute page URLs, the index and the log are the site's, raw/ is not published, code is untouched", () => {
  expect(wikiUrl("/wiki/concepts/x.md", SITE)).toBe("https://wiki.example.org/wiki/concepts/x/");
  expect(wikiUrl("wiki/index.md", SITE)).toBe(SITE);
  expect(wikiUrl("wiki/log.md", SITE)).toBe("https://wiki.example.org/log/");
  const sub = "https://example.org/cortex/"; // a site under a sub-path
  expect(absoluteLinks("[a](/wiki/x.md) [b](wiki/y.md#z) [c](/raw/s.md) [d](https://other.org/wiki/x.md)", sub))
    .toBe("[a](https://example.org/cortex/wiki/x/) [b](https://example.org/cortex/wiki/y/#z) c [d](https://other.org/wiki/x.md)");
  expect(absoluteLinks("```md\n[a](/wiki/x.md)\n```\n[a](/wiki/x.md)", SITE)).toBe("```md\n[a](/wiki/x.md)\n```\n[a](https://wiki.example.org/wiki/x/)");
});

test("display blocks are flattened to standard Markdown, in the answer and in the export", () => {
  const answer = [
    "Avant.",
    fence({ type: "callout", tone: "warning", title: "Attention", text: "Ne pas `faire` ça.\nSuite." }),
    fence({ type: "table", title: "Tarifs", columns: ["Cas", "Valeur"], rows: [["a|b", "1"], ["c", "2"]] }),
    fence({ type: "steps", items: [{ title: "Un", text: "d'abord" }, { title: "Deux" }] }),
    fence({ type: "tabs", tabs: [{ label: "A", text: "texte A" }, { label: "B", text: "texte B" }] }),
    fence({ type: "facts", title: "Chiffres", items: [{ label: "N", value: "3" }] }),
    fence({ type: "pages", items: [{ path: "/wiki/concepts/alpha.md", summary: "Le début" }] }),
    "Après.",
  ].join("\n\n");
  const flat = flattenBlocks(answer, (p) => (p === "/wiki/concepts/alpha.md" ? "Alpha" : p));
  expect(flat).not.toContain("cortex-ui");
  expect(flat).toContain("> **Attention** Ne pas `faire` ça.\n> Suite.");
  expect(flat).toContain("**Tarifs**\n\n| Cas | Valeur |\n| --- | --- |\n| a\\|b | 1 |\n| c | 2 |");
  expect(flat).toContain("1. **Un** d'abord\n2. **Deux**");
  expect(flat).toContain("**A**\n\ntexte A\n\n**B**\n\ntexte B");
  expect(flat).toContain("**Chiffres**\n\n- **N** : 3");
  expect(flat).toContain("- [Alpha](/wiki/concepts/alpha.md) : Le début");
  // a fence that is not a block of the site, or not even JSON, is left as written
  const odd = "```cortex-ui\n{\"type\":\"nope\"}\n```\n\n```cortex-ui\nnot json\n```";
  expect(flattenBlocks(odd)).toBe(odd);
  const md = conversationMarkdown({ title: "T", site: SITE, pageTitle, turns: [{ question: "Q", answer }] });
  expect(md).toContain("- [Alpha \\[draft\\]](https://wiki.example.org/wiki/concepts/alpha/) : Le début");
  expect(md).not.toContain("```cortex-ui");
  expect(md).not.toMatch(/\n{3,}/);
});

test("headings of an answer go under its question; footnotes are numbered per answer; code is not rewritten", () => {
  const md = conversationMarkdown({
    title: "T", site: SITE,
    turns: [
      { question: "Q1", answer: "# Titre\n\n## Sous-titre\n\nTexte[^1].\n\n[^1]: Note un.\n\n```sh\n# commentaire\n[^1]\n```" },
      { question: "Q2", answer: "Texte[^1].\n\n[^1]: Note deux." },
    ],
  });
  expect(md).toContain("### Titre\n\n#### Sous-titre\n\nTexte[^q1-1].\n\n[^q1-1]: Note un.");
  expect(md).toContain("```sh\n# commentaire\n[^1]\n```");
  expect(md).toContain("Texte[^q2-1].\n\n[^q2-1]: Note deux.");
  expect(md.match(/^## /gm)).toHaveLength(2);
});

test("file name: slug without accents, 60 characters at most, fallback", () => {
  expect(conversationFilename("Règles du panier : durée ?")).toBe("regles-du-panier-duree.md");
  expect(conversationFilename("x".repeat(100))).toBe(`${"x".repeat(60)}.md`);
  expect(conversationFilename("a".repeat(59) + " bbb")).toBe(`${"a".repeat(59)}.md`); // the cut leaves no trailing dash
  expect(conversationFilename("日本語 ?!")).toBe("conversation.md");
  expect(conversationFilename("")).toBe("conversation.md");
});

test("title: one line, 120 characters", () => {
  expect(normalizeTitle("  une\n question   longue ")).toBe("une question longue");
  expect(normalizeTitle("é".repeat(200))).toHaveLength(120);
});

test("export: a citation of a page of a space (an answer that read several spaces) becomes the page on that space's site", () => {
  const md = absoluteLinks("Voir [A](/s/veille/wiki/concepts/alpha.md#x), [B](/spaces/pro/wiki/entities/beta.md) et [C](/wiki/concepts/gamma.md).", "https://wiki.example.org/s/pro/");
  expect(md).toBe("Voir [A](https://wiki.example.org/s/veille/wiki/concepts/alpha/#x), [B](https://wiki.example.org/s/pro/wiki/entities/beta/) et [C](https://wiki.example.org/s/pro/wiki/concepts/gamma/).");
});
