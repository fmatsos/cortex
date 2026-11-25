// A journey of the graph as a Markdown document, for the export (and for an agent that is asked to write an article from it):
// pure functions, no DOM, no network. The caller gives the site's URL, the pages of the route (title, type, summary and the
// full Markdown the site already ships for each page) and the links between pages; the labels come from the site's dictionaries
// (`t`), so the file speaks the language of the interface.
//
//   ---
//   title: "…"   date: ISO   source: Cortex   wiki: site URL   kind: journey   steps: n   route: [id, id, …]
//   ---
//   # title
//   (one sentence on what the file is)
//   ## Route               the steps, in order, each with how it is linked to the one before it
//   ## Step 1: title       page id, type, URL, summary, then the whole page (headings pushed down, wiki links absolute);
//   ## Step 2: …           a page walked twice is given in full once: the second time points to the first
import type { Key, Vars } from "./i18n/index";
import type { Relations } from "./graph-model";
import { absoluteLinks, collapseBlankLines, demoteHeadings, escapeLabel, normalizeTitle, oneLine, prefixNotes, slugFilename, wikiUrl, yamlString } from "./markdown-export";

/** What the export needs to know about a page of the route. `md` is the page as the site ships it, front matter included; without it the step says the content could not be loaded. */
export type JourneyPage = { id: string; title: string; type?: string; description?: string; md?: string };
export type Translate = (key: Key, vars?: Vars) => string;
export type JourneyExportOptions = {
	/** The name of the journey (saved, or the default one). */
	title: string;
	/** Page ids in the order walked; a page may come back. */
	route: readonly string[];
	/** The pages of the route by id; an id that is not in it is a page the wiki no longer has. */
	pages: ReadonlyMap<string, JourneyPage>;
	/** What each page cites and is cited by (the graph's links, whatever the filters on screen). */
	relations: ReadonlyMap<string, Relations>;
	/** Absolute URL of the site's root, with a trailing slash. */
	site: string;
	t: Translate;
	/** Label of a page type in the language of the interface; the type itself by default. */
	typeLabel?: (type: string) => string;
	/** When the journey was saved (ISO); default: `now`. */
	created?: string;
	now?: Date;
};

/** "Journey: First page → Last page" (one page: "Journey: Page"), 120 characters at most: the name a journey gets until its owner names it. */
export function defaultJourneyTitle(route: readonly string[], titleOf: (id: string) => string, t: Translate): string {
	if (!route.length) return "";
	const title = (cut: number) => {
		const name = (id: string) => { const s = oneLine(titleOf(id)); return s.length > cut ? `${s.slice(0, cut - 1).trimEnd()}…` : s; };
		const from = name(route[0]!), to = name(route.at(-1)!);
		return route.length === 1 ? t("journey.defaultTitle.one", { from }) : t("journey.defaultTitle", { from, to });
	};
	const whole = title(Infinity);
	return whole.length <= 120 ? whole : normalizeTitle(title(50));
}

/** "Alpha to Beta" becomes "alpha-to-beta.md"; `fallback` ("journey", "voyage") when the title leaves nothing to name a file with. */
export const journeyFilename = (title: string, fallback: string) => slugFilename(title, fallback);

/** The page without its front matter (the block between the first two `---` lines, when the text opens with it). */
export const stripFrontMatter = (md: string) => md.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");

/** An id as a front matter flow-sequence item: as it is when plain, quoted otherwise. */
const yamlItem = (id: string) => (/^[\p{L}\p{N}_./-]+$/u.test(id) ? id : yamlString(id));

export function journeyMarkdown(o: JourneyExportOptions): string {
	const { t, route } = o;
	const colon = t("common.colon");
	const label = o.typeLabel ?? ((type: string) => type);
	const title = normalizeTitle(o.title) || t("journey.export.fallbackTitle");
	const urlOf = (id: string) => wikiUrl(`wiki/${id}.md`, o.site);
	const first = new Map<string, number>(); // page id -> its first step (1-based)
	route.forEach((id, i) => { if (!first.has(id)) first.set(id, i + 1); });

	/** How step `i` is linked to the one before it, as the graph says it (a mutual link: both). */
	const link = (i: number) => {
		if (i === 0) return "";
		const r = o.relations.get(route[i]!), prev = route[i - 1]!;
		const cites = !!r?.cites.includes(prev), citedBy = !!r?.citedBy.includes(prev);
		return cites && citedBy ? t("journey.export.both", { n: i }) : cites ? t("journey.export.cites", { n: i }) : citedBy ? t("journey.export.citedBy", { n: i }) : "";
	};
	const typeOf = (id: string) => { const type = o.pages.get(id)?.type; return type ? label(type) : ""; };

	const list = route.map((id, i) => {
		const type = typeOf(id), rel = link(i);
		return `${i + 1}. [${escapeLabel(o.pages.get(id)?.title ?? id)}](${urlOf(id)})${type ? ` (${type})` : ""}${rel ? `${colon}${rel}` : ""}`;
	});

	const steps = route.flatMap((id, i) => {
		const page = o.pages.get(id), n = i + 1, type = typeOf(id);
		const out = [`## ${t("journey.export.step", { n, title: oneLine(page?.title ?? id) })}`, "", `- ${t("journey.export.page")}${colon}\`${id}\` · ${type ? `${type} · ` : ""}${urlOf(id)}`];
		if (!page) return [...out, "", t("journey.export.missing"), ""];
		const again = first.get(id)!;
		if (again !== n) return [...out, "", t("journey.export.again", { n: again }), ""];
		if (page.description?.trim()) out.push(`- ${t("journey.export.summary")}${colon}${oneLine(page.description)}`);
		out.push("");
		if (page.md === undefined) return [...out, t("journey.export.noContent"), ""];
		return [...out, prefixNotes(demoteHeadings(absoluteLinks(stripFrontMatter(page.md).trim(), o.site)), `s${n}-`).trim(), ""];
	});

	const doc = [
		"---",
		`title: ${yamlString(title)}`,
		`date: ${o.created ?? (o.now ?? new Date()).toISOString()}`,
		"source: Cortex",
		`wiki: ${o.site}`,
		"kind: journey",
		`steps: ${route.length}`,
		`route: [${route.map(yamlItem).join(", ")}]`,
		"---",
		"",
		`# ${title}`,
		"",
		t("journey.export.intro"),
		"",
		`## ${t("journey.export.route")}`,
		"",
		...list,
		"",
		...steps,
	].join("\n");
	return `${collapseBlankLines(doc).replace(/\n+$/, "")}\n`;
}
