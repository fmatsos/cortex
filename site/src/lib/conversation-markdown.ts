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

import { absoluteLinks, collapseBlankLines, demoteHeadings, escapeLabel, MAX_TITLE, normalizeTitle, oneLine, prefixNotes, slugFilename, wikiUrl, yamlString } from "./markdown-export";

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

export { absoluteLinks, MAX_TITLE, normalizeTitle, wikiUrl };

/** "Règles du panier : durée ?" becomes "regles-du-panier-duree.md" (60 characters at most, "conversation.md" when nothing is left). */
export const conversationFilename = (title: string) => slugFilename(title, "conversation");

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

// ---- the document -----------------------------------------------------------------------------------------------------

export function conversationMarkdown(o: ExportOptions): string {
	const now = (o.now ?? new Date()).toISOString();
	const title = normalizeTitle(o.title) || "Conversation";
	const first = o.turns.find((t) => t.at)?.at, last = [...o.turns].reverse().find((t) => t.at)?.at;
	const labelOf = (path: string) => escapeLabel(o.pageTitle?.(path.replace(/^\/?wiki\//, "").replace(/\.md$/, "")) ?? path);
	const body = o.turns.flatMap((t, i) => [
		`## ${oneLine(t.question)}`,
		"",
		prefixNotes(demoteHeadings(absoluteLinks(flattenBlocks(t.answer.trim(), labelOf), o.site)), `q${i + 1}-`).trim(),
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
	return `${collapseBlankLines(doc).replace(/\n+$/, "")}\n`;
}
