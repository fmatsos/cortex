// A conversation of the assistant as a Markdown document, for the export: pure functions, no DOM, no network (the callers
// give the site's URL and the titles of the pages). The answers come as the server wrote them (`answer.md`): wiki links as
// `/wiki/x.md`, display blocks as ```cortex-ui fences (src/answer-blocks.ts), footnotes numbered per answer.
//
//   ---
//   title: "…"           date / updated: ISO dates      source: Cortex      wiki: site URL      exchanges: n
//   ---
//   # title
//   ## question 1        answer 1 (blocks flattened, wiki links absolute, headings pushed under the question)
//   ## Sources           the pages the answers cite, once each, in order

export type ExportTurn = { question: string; answer: string; pages?: string[]; at?: string };
export type ExportOptions = {
	title: string;
	turns: ExportTurn[];
	/** Absolute URL of the site's root, with a trailing slash: wiki links are written against it. */
	site: string;
	/** Title of a page by id, when known (the Sources list and the `pages` blocks name the pages with it). */
	pageTitle?: (id: string) => string | undefined;
	/** When the conversation was created (ISO); default: the date of its first answer, else `now`. */
	created?: string;
	/** Last change (ISO); default: the date of its last answer, else `now`. */
	updated?: string;
	now?: Date;
};

export const MAX_TITLE = 120;

/** One line, single spaces, at most 120 characters: the name a conversation gets from its first question. */
export const normalizeTitle = (text: string, max = MAX_TITLE) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

/** "Règles du panier : durée ?" becomes "regles-du-panier-duree.md" (60 characters at most, "conversation.md" when nothing is left). */
export function conversationFilename(title: string): string {
	const slug = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
	return `${slug || "conversation"}.md`;
}

const yamlString = (s: string) => `"${s.replace(/\s+/g, " ").trim().replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** The text of a link: one line, brackets escaped. */
const escapeLabel = (s: string) => oneLine(s).replace(/([[\]])/g, "\\$1");

// ---- display blocks ---------------------------------------------------------------------------------------------------

const FENCE = /```cortex-ui\n([\s\S]*?)\n```/g;
type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => !!x && typeof x === "object") : []);
const cell = (s: unknown) => str(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

/** A block as standard Markdown (blockquote, table, list); undefined when it is not a block the site draws. */
function blockMarkdown(b: Json, label: (path: string) => string): string | undefined {
	const title = str(b.title), head = title ? `**${title}**\n\n` : "";
	switch (b.type) {
		case "callout": return `> ${title ? `**${title}** ` : ""}${str(b.text).replace(/\n/g, "\n> ")}`;
		case "table": {
			const cols = Array.isArray(b.columns) ? b.columns.map(cell) : [];
			if (!cols.length) return undefined;
			const rows = Array.isArray(b.rows) ? b.rows.filter(Array.isArray) as unknown[][] : [];
			return `${head}| ${cols.join(" | ")} |\n|${cols.map(() => " --- |").join("")}\n${rows.map((r) => `| ${cols.map((_, i) => cell(r[i])).join(" | ")} |`).join("\n")}`;
		}
		case "steps": return `${head}${arr(b.items).map((s, i) => `${i + 1}. **${str(s.title)}**${str(s.text) ? ` ${str(s.text)}` : ""}`).join("\n")}`;
		case "tabs": return arr(b.tabs).map((x) => `**${str(x.label)}**\n\n${str(x.text)}`).join("\n\n");
		case "facts": return `${head}${arr(b.items).map((f) => `- **${str(f.label)}** : ${str(f.value)}`).join("\n")}`;
		case "pages": return `${head}${arr(b.items).map((p) => `- [${label(str(p.path))}](${str(p.path)}) : ${str(p.summary)}`).join("\n")}`;
		default: return undefined;
	}
}

/** The answer with its display blocks as Markdown; a fence that does not parse stays as it is. */
export function flattenBlocks(md: string, label: (path: string) => string = (p) => p): string {
	return md.replace(FENCE, (all, json: string) => {
		try {
			const b = JSON.parse(json) as unknown;
			const out = b && typeof b === "object" ? blockMarkdown(b as Json, label) : undefined;
			return out === undefined ? all : `\n\n${out}\n\n`;
		} catch { return all; }
	});
}

// ---- links, headings, footnotes ---------------------------------------------------------------------------------------

/** Pieces of `md` outside code fences (even indexes) and the fences themselves (odd): the rewrites below leave code alone. */
const CODE = /(```[\s\S]*?(?:```|$))/g;
const outsideCode = (md: string, f: (prose: string) => string) => md.split(CODE).map((p, i) => (i % 2 ? p : f(p))).join("");

/** URL of a wiki file (`wiki/concepts/x.md`) on the site: `wiki/concepts/x/`; the index is the home page, the log has its own. */
export function wikiUrl(path: string, site: string): string {
	const p = path.replace(/^\//, "");
	if (p === "wiki/index.md") return site;
	if (p === "wiki/log.md") return `${site}log/`;
	return `${site}${p.replace(/\.md$/, "")}/`;
}

const WIKI_LINK = /\]\(\/?(wiki\/[^)\s#]+\.md)(#[^)\s]*)?\)/g;
const RAW_LINK = /\[([^\]\n]*)\]\(\/?raw\/[^)\s]*\)/g;
/** `](/wiki/x.md#a)` becomes `](https://site/wiki/x/#a)`; a link to `raw/` (not published) is left as its label. */
export const absoluteLinks = (md: string, site: string) =>
	outsideCode(md, (p) => p.replace(RAW_LINK, "$1").replace(WIKI_LINK, (_, path: string, frag = "") => `](${wikiUrl(path, site)}${frag})`));

/** Footnote ids are numbered per answer: in one document `[^1]` of two answers would collide. */
const prefixNotes = (md: string, n: number) => outsideCode(md, (p) => p.replace(/\[\^([\w-]+)\]/g, (_, id: string) => `[^q${n}-${id}]`));

/** An answer's headings go under its question (`##`): `#`, `##` become `###`, `####`, six levels at most. */
const demoteHeadings = (md: string) => outsideCode(md, (p) => p.replace(/^(#{1,6})([ \t])/gm, (_, h: string, s: string) => `${"#".repeat(Math.min(6, h.length + 2))}${s}`));

// ---- the document -----------------------------------------------------------------------------------------------------

export function conversationMarkdown(o: ExportOptions): string {
	const now = (o.now ?? new Date()).toISOString();
	const title = normalizeTitle(o.title) || "Conversation";
	const first = o.turns.find((t) => t.at)?.at, last = [...o.turns].reverse().find((t) => t.at)?.at;
	const labelOf = (path: string) => escapeLabel(o.pageTitle?.(path.replace(/^\/?wiki\//, "").replace(/\.md$/, "")) ?? path);
	const body = o.turns.flatMap((t, i) => [
		`## ${oneLine(t.question)}`,
		"",
		prefixNotes(demoteHeadings(absoluteLinks(flattenBlocks(t.answer.trim(), labelOf), o.site)), i + 1).trim(),
		"",
	]);
	const ids = [...new Set(o.turns.flatMap((t) => t.pages ?? []))];
	const sources = ids.length
		? ["## Sources", "", ...ids.map((id) => `- [${escapeLabel(o.pageTitle?.(id) ?? id)}](${wikiUrl(`wiki/${id}.md`, o.site)}) (\`${id}\`)`), ""]
		: [];
	const doc = [
		"---",
		`title: ${yamlString(title)}`,
		`date: ${o.created ?? first ?? now}`,
		`updated: ${o.updated ?? last ?? now}`,
		"source: Cortex",
		`wiki: ${o.site}`,
		`exchanges: ${o.turns.length}`,
		"---",
		"",
		`# ${title}`,
		"",
		...body,
		...sources,
	].join("\n");
	// the blank lines a flattened block adds are collapsed; code is left as written
	return `${outsideCode(doc, (p) => p.replace(/\n{3,}/g, "\n\n")).replace(/\n+$/, "")}\n`;
}
