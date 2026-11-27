// What the Markdown exports share (a conversation of the assistant, a journey of the graph): pure functions, no DOM, no
// network. The title and the file name, the front matter's strings, the links of a wiki page made absolute, the headings and
// the footnotes of a page made to live under a heading of another document.

export const MAX_TITLE = 120;

/** One line, single spaces, at most 120 characters: the name a saved conversation or journey gets by default. */
export const normalizeTitle = (text: string, max = MAX_TITLE) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

/** "Règles du panier : durée ?" becomes "regles-du-panier-duree.md" (60 characters at most, `fallback` when nothing is left). */
export function slugFilename(title: string, fallback: string): string {
	const slug = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
	return `${slug || fallback}.md`;
}

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** A front matter string: one line, double-quoted, backslashes and quotes escaped. */
export const yamlString = (s: string) => `"${oneLine(s).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
/** The text of a link: one line, brackets escaped. */
export const escapeLabel = (s: string) => oneLine(s).replace(/([[\]])/g, "\\$1");

/** Pieces of `md` outside code fences (even indexes) and the fences themselves (odd): the rewrites below leave code alone. */
const CODE = /(```[\s\S]*?(?:```|$))/g;
export const outsideCode = (md: string, f: (prose: string) => string) => md.split(CODE).map((p, i) => (i % 2 ? p : f(p))).join("");

/** Three blank lines or more become one blank line (a block flattened or a page stripped of its front matter leaves some); code is left as written. */
export const collapseBlankLines = (md: string) => outsideCode(md, (p) => p.replace(/\n{3,}/g, "\n\n"));

/** URL of a wiki file (`wiki/concepts/x.md`) on the site: `wiki/concepts/x/`; the index is the home page, the log has its own. */
export function wikiUrl(path: string, site: string): string {
	const p = path.replace(/^\//, "");
	if (p === "wiki/index.md") return site;
	if (p === "wiki/log.md") return `${site}log/`;
	return `${site}${p.replace(/\.md$/, "")}/`;
}

const WIKI_LINK = /\]\(\/?(wiki\/[^)\s#]+\.md)(#[^)\s]*)?\)/g;
const SPACE_LINK = /\]\(\/(?:s|spaces)\/([a-z0-9][a-z0-9-]{0,39})\/(wiki\/[^)\s#]+\.md)(#[^)\s]*)?\)/g;
const RAW_LINK = /\[([^\]\n]*)\]\(\/?raw\/[^)\s]*\)/g;
/** `](/wiki/x.md#a)` becomes `](https://site/wiki/x/#a)`; a link to `raw/` (not published) is left as its label. */
export const absoluteLinks = (md: string, site: string) =>
	outsideCode(md, (p) => p.replace(RAW_LINK, "$1").replace(WIKI_LINK, (_, path: string, frag = "") => `](${wikiUrl(path, site)}${frag})`)
		// an answer that read several spaces cites `/s/<space>/wiki/x.md`: the page on that space's site, whatever space the export was made in
		.replace(SPACE_LINK, (_, space: string, path: string, frag = "") => `](${wikiUrl(path, new URL(`/s/${space}/`, site).href)}${frag})`));

/** Footnote ids get a prefix per part (`q2-`, `s3-`): in one document the `[^1]` of two parts would collide. */
export const prefixNotes = (md: string, prefix: string) => outsideCode(md, (p) => p.replace(/\[\^([\w-]+)\]/g, (_, id: string) => `[^${prefix}${id}]`));

/** Headings go `by` levels down (`#` under a `##` becomes `###` with `by` = 2), six levels at most. */
export const demoteHeadings = (md: string, by = 2) => outsideCode(md, (p) => p.replace(/^(#{1,6})([ \t])/gm, (_, h: string, s: string) => `${"#".repeat(Math.min(6, h.length + by))}${s}`));
