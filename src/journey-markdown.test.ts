import { expect, test } from "bun:test";
import { relationIndex } from "../site/src/lib/graph-model";
import { DICTS, translate, type Key, type Locale, type Vars } from "../site/src/lib/i18n/index";
import { defaultJourneyTitle, journeyFilename, journeyMarkdown, pathDraftMarkdown, stripFrontMatter, type JourneyPage } from "../site/src/lib/journey-markdown";
import { parsePath } from "./reading-paths";
import { journeyQuery } from "../site/src/lib/journey";

const SITE = "https://wiki.example.org/";
const tr = (l: Locale) => (key: Key, vars?: Vars) => translate(DICTS[l], l, key, vars);
const fm = (type: string, title: string) => `---\ntype: ${type}\ntitle: ${title}\ntags: [a]\n\n---\n`;
const PAGES: JourneyPage[] = [
	{ id: "concepts/alpha", title: "Alpha [draft]", type: "Concept", description: "Alpha, the first idea.", md: `${fm("Concept", "Alpha")}# Alpha\n\nSee [Beta](/wiki/concepts/beta.md#intro) and [the raw](/raw/2026/11/x/source.md).\n\n## Detail\n\nAlpha has a note[^1].\n\n\`\`\`md\n# not a heading\n[^1]\n\`\`\`\n\n[^1]: The note of alpha.\n` },
	{ id: "concepts/beta", title: "Beta", type: "Concept", description: "", md: `${fm("Concept", "Beta")}Beta cites [Gamma](/wiki/entities/gamma.md) and [Alpha](/wiki/concepts/alpha.md).\n\nA note[^1].\n\n[^1]: The note of beta.\n` },
	{ id: "entities/gamma", title: "Gamma", type: "Entity", description: "Gamma entity", md: `${fm("Entity", "Gamma")}Gamma, cited by [Beta](/wiki/concepts/beta.md).\n` },
];
const pages = new Map(PAGES.map((p) => [p.id, p]));
// alpha <-> beta (mutual), beta -> gamma, delta -> beta
const NODES = ["concepts/alpha", "concepts/beta", "entities/gamma", "syntheses/delta"].map((id) => ({ id, title: id, description: "", type: "Concept", tags: [], degree: 0, x: 0, y: 0, community: "" }));
const relations = relationIndex({ nodes: NODES, links: [{ source: "concepts/alpha", target: "concepts/beta", mutual: true }, { source: "concepts/beta", target: "entities/gamma" }, { source: "syntheses/delta", target: "concepts/beta" }] });
const base = { site: SITE, pages, relations, now: new Date("2026-11-25T10:00:00.000Z") };
const typeLabel = (t: string) => ({ Concept: "Concept", Entity: "Entité" })[t] ?? t;

test("export: front matter, title, intro, route and one section per step (French)", () => {
	const md = journeyMarkdown({ ...base, t: tr("fr"), typeLabel, title: 'Mon "voyage"', route: ["concepts/alpha", "concepts/beta", "entities/gamma"], created: "2026-11-20T08:00:00.000Z" });
	expect(md.startsWith([
		"---",
		'title: "Mon \\"voyage\\""',
		"date: 2026-11-20T08:00:00.000Z",
		"source: Cortex",
		"wiki: https://wiki.example.org/",
		"kind: journey",
		"steps: 3",
		"route: [concepts/alpha, concepts/beta, entities/gamma]",
		"---",
		"",
		'# Mon "voyage"',
		"",
		"Itinéraire de lecture à travers le wiki Cortex, dans l'ordre parcouru. Chaque étape est reliée à la précédente par un lien du wiki.",
		"",
		"## Itinéraire",
		"",
		"1. [Alpha \\[draft\\]](https://wiki.example.org/wiki/concepts/alpha/) (Concept)",
		"2. [Beta](https://wiki.example.org/wiki/concepts/beta/) (Concept) : cite et est citée par l'étape 1",
		"3. [Gamma](https://wiki.example.org/wiki/entities/gamma/) (Entité) : est citée par l'étape 2",
		"",
		"## Étape 1 : Alpha [draft]",
		"",
		"- Page : `concepts/alpha` · Concept · https://wiki.example.org/wiki/concepts/alpha/",
		"- Résumé : Alpha, the first idea.",
		"",
	].join("\n"))).toBe(true);
	expect(md).toContain("## Étape 2 : Beta\n\n- Page : `concepts/beta` · Concept · https://wiki.example.org/wiki/concepts/beta/\n\nBeta cites");
	expect(md.endsWith("Gamma, cited by [Beta](https://wiki.example.org/wiki/concepts/beta/).\n")).toBe(true);
});

test("export: the relation of a step to the one before it, in both directions", () => {
	const md = journeyMarkdown({ ...base, t: tr("en"), title: "T", route: ["entities/gamma", "concepts/beta", "syntheses/delta", "concepts/beta"] });
	expect(md).toContain("1. [Gamma](https://wiki.example.org/wiki/entities/gamma/) (Entity)\n"); // the first step has no relation
	expect(md).toContain("2. [Beta](https://wiki.example.org/wiki/concepts/beta/) (Concept): cites step 1\n"); // beta cites gamma
	expect(md).toContain("[syntheses/delta](https://wiki.example.org/wiki/syntheses/delta/): cites step 2\n"); // delta -> beta: delta cites the previous step
	expect(md).toContain("4. [Beta](https://wiki.example.org/wiki/concepts/beta/) (Concept): is cited by step 3\n");
});

test("export: a page walked twice is given in full once", () => {
	const md = journeyMarkdown({ ...base, t: tr("fr"), title: "Aller-retour", route: ["concepts/alpha", "concepts/beta", "concepts/alpha"] });
	expect(md.match(/Alpha has a note/g)).toHaveLength(1);
	expect(md).toContain("## Étape 3 : Alpha [draft]\n\n- Page : `concepts/alpha` · Concept · https://wiki.example.org/wiki/concepts/alpha/\n\nPage déjà donnée en entier à l'étape 1.\n");
	expect(md).toContain("3. [Alpha \\[draft\\]](https://wiki.example.org/wiki/concepts/alpha/) (Concept) : cite et est citée par l'étape 2");
	expect(md).toContain("steps: 3");
});

test("export: the page as the site ships it, without its front matter, links absolute, headings under the step, footnotes per step, code untouched", () => {
	const md = journeyMarkdown({ ...base, t: tr("en"), title: "T", route: ["concepts/alpha", "concepts/beta"] });
	expect(md).not.toContain("type: Concept");
	expect(md).not.toContain("tags: [a]");
	expect(md).toContain("### Alpha\n\nSee [Beta](https://wiki.example.org/wiki/concepts/beta/#intro) and the raw."); // wiki link absolute with its fragment, link to raw/ left as its label
	expect(md).toContain("#### Detail\n"); // # -> ###, ## -> ####
	expect(md).toContain("```md\n# not a heading\n[^1]\n```"); // a fence is left as written
	expect(md).toContain("Alpha has a note[^s1-1].");
	expect(md).toContain("[^s1-1]: The note of alpha.");
	expect(md).toContain("A note[^s2-1].");
	expect(md).toContain("[^s2-1]: The note of beta.");
	expect(md).not.toMatch(/https:\/\/wiki\.example\.org\/wiki\/[^)\s]*\.md/); // no link to a .md file left
	expect(md).not.toMatch(/\n{3,}/);
	expect(md.endsWith("\n") && !md.endsWith("\n\n")).toBe(true);
});

test("export: a page the wiki no longer has, a page without its content, a page without summary", () => {
	const part = new Map(pages);
	part.set("concepts/beta", { id: "concepts/beta", title: "Beta", type: "Concept", description: "Beta summary" }); // data not loaded
	const md = journeyMarkdown({ ...base, pages: part, t: tr("en"), title: "T", route: ["concepts/beta", "x/gone"] });
	expect(md).toContain("- Summary: Beta summary\n\nThe content of this page could not be loaded: read it at the address above.\n");
	expect(md).toContain("2. [x/gone](https://wiki.example.org/wiki/x/gone/)\n");
	expect(md).toContain("## Step 2: x/gone\n\n- Page: `x/gone` · https://wiki.example.org/wiki/x/gone/\n\nThis page is no longer in the wiki.\n");
	const noSummary = journeyMarkdown({ ...base, t: tr("en"), title: "T", route: ["concepts/beta"] });
	expect(noSummary).not.toContain("- Summary");
});

test("export: the title is escaped in the front matter, ids that need it are quoted, the date falls back to now", () => {
	const odd = new Map([["a/b, c", { id: "a/b, c", title: "Odd", type: "Concept", md: "x" }]]);
	const md = journeyMarkdown({ ...base, pages: odd, relations: new Map(), t: tr("en"), title: "  Line\none \\ \"two\"  ", route: ["a/b, c"] });
	expect(md).toContain('title: "Line one \\\\ \\"two\\""\ndate: 2026-11-25T10:00:00.000Z\n');
	expect(md).toContain('route: ["a/b, c"]');
	expect(journeyMarkdown({ ...base, t: tr("en"), title: " ", route: ["concepts/beta"] })).toContain("# Journey\n");
});

test("stripFrontMatter: the block between the first two --- lines, a body that merely contains --- is kept", () => {
	expect(stripFrontMatter("---\na: 1\n\n---\nBody\n")).toBe("Body\n");
	expect(stripFrontMatter("---\r\na: 1\r\n---\r\nBody")).toBe("Body");
	expect(stripFrontMatter("Body\n\n---\n\nmore")).toBe("Body\n\n---\n\nmore");
	expect(stripFrontMatter("")).toBe("");
});

test("file name: the slug of the title, journey.md or voyage.md when nothing is left", () => {
	expect(journeyFilename("Voyage : Règles du panier → Été", "voyage")).toBe("voyage-regles-du-panier-ete.md");
	expect(journeyFilename("→ ? !", "voyage")).toBe("voyage.md");
	expect(journeyFilename("", "journey")).toBe("journey.md");
	expect(journeyFilename("x".repeat(200), "journey")).toBe(`${"x".repeat(60)}.md`);
});

test("default title: first and last pages, 120 characters at most", () => {
	const title = (id: string) => ({ a: "Alpha", b: "Beta" })[id] ?? id;
	expect(defaultJourneyTitle(["a", "b"], title, tr("fr"))).toBe("Voyage : Alpha → Beta");
	expect(defaultJourneyTitle(["a", "x", "b"], title, tr("en"))).toBe("Journey: Alpha → Beta");
	expect(defaultJourneyTitle(["a"], title, tr("en"))).toBe("Journey: Alpha");
	expect(defaultJourneyTitle([], title, tr("en"))).toBe("");
	const long = defaultJourneyTitle(["a", "b"], (id) => `${id} ${"very long title ".repeat(10)}`, tr("en"));
	expect(long.length).toBeLessThanOrEqual(120);
	expect(long).toContain(" → ");
});

test("the account page opens a journey linked to its saved copy", () => {
	expect(journeyQuery(["a/b", "c"])).toBe("view=journey&route=a%2Fb%2Cc");
	const q = new URLSearchParams(journeyQuery(["a/b", "c"], "j1"));
	expect(q.get("journey")).toBe("j1");
	expect(q.get("route")).toBe("a/b,c");
});

test("path draft: front matter with an empty goal, one root-relative step per page (a page walked twice once), a first reason; read back by the path parser", () => {
	const md = pathDraftMarkdown({ ...base, t: tr("en"), title: "My \"path\"", route: ["concepts/alpha", "concepts/beta", "entities/gamma", "concepts/beta", "syntheses/ghost"] });
	expect(md).toBe([
		"---",
		'title: "My \\"path\\""',
		'goal: ""',
		"---",
		"",
		"1. [Alpha \\[draft\\]](/wiki/concepts/alpha.md): Alpha, the first idea.",
		"2. [Beta](/wiki/concepts/beta.md): cites and is cited by step 1",
		"3. [Gamma](/wiki/entities/gamma.md): is cited by step 2. Gamma entity",
		"4. [syntheses/ghost](/wiki/syntheses/ghost.md)",
		"",
	].join("\n"));
	const p = parsePath("my-path", md);
	expect(p).toMatchObject({ title: 'My "path"', goal: "", problems: [] });
	expect(p.steps.map((x) => [x.page, x.label, x.reason])).toEqual([
		["wiki/concepts/alpha.md", "Alpha [draft]", "Alpha, the first idea."],
		["wiki/concepts/beta.md", "Beta", "cites and is cited by step 1"],
		["wiki/entities/gamma.md", "Gamma", "is cited by step 2. Gamma entity"],
		["wiki/syntheses/ghost.md", "syntheses/ghost", ""],
	]);
	expect(pathDraftMarkdown({ ...base, t: tr("fr"), title: "", route: ["concepts/beta"] })).toContain('title: "Voyage"');
});
