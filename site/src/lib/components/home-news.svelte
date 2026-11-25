<script lang="ts">
	import { hourOf, groupDays } from "#lib/log-view.js";
	import { toPage, toRoute } from "#lib/links.js";
	import type { Brief } from "#lib/news.js";
	import { intlLocale, t } from "#lib/i18n/index.js";

	// Home page news: days, and under each day one sentence per brief (what happened, from structured data: no kind badge,
	// the verb tells the kind), then the time and the pages. The vertical rule and the square markers are decorative.
	let { news }: { news: Brief[] } = $props();
	const days = $derived(groupDays(news).map((d) => ({ ...d, label: dayHeading(d.day) })));

	// UTC: the date written in the log. Built at render time: the visitor may switch language.
	const dayHeading = (day: string) => new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

	// the Source page's title is a link inside the sentence: it is a placeholder in the translated lead, split back here
	const SOURCE = "\0";
	const lead = (b: Brief): string => {
		const titled = !!b.source, many = b.sources > 1;
		switch (b.kind) {
			case "add": return titled ? t("home.news.addedTitled", { source: SOURCE }) : many ? t("home.news.addedMany", { count: b.sources }) : t("home.news.added");
			case "addIngest": return titled ? t("home.news.addedCompiledTitled", { source: SOURCE }) : many ? t("home.news.addedCompiledMany", { count: b.sources }) : t("home.news.addedCompiled");
			case "ingest": return titled ? t("home.news.compiledTitled", { source: SOURCE }) : many ? t("home.news.compiledMany", { count: b.sources }) : b.sources ? t("home.news.compiledOne") : t("home.news.compiled");
			case "update": return t("home.news.update");
			case "lint": return t("home.news.lint");
			default: return t("home.news.query");
		}
	};
	// counts only when the export read them from the automatic text, otherwise the number of distinct pages referenced
	const tail = (b: Brief): string => {
		if (b.kind !== "ingest" && b.kind !== "addIngest") return "";
		if (!b.counts) return b.referenced ? t("home.news.referenced", { count: b.referenced }) : "";
		const parts = [b.counts.created && t("home.news.created", { count: b.counts.created }), b.counts.updated && t("home.news.updated", { count: b.counts.updated })].filter(Boolean) as string[];
		return parts.length ? new Intl.ListFormat(intlLocale(), { type: "unit", style: "long" }).format(parts) : t("home.news.nothing");
	};
	const sentence = (b: Brief) => {
		const l = lead(b), tl = tail(b);
		const s = b.text ? t("home.news.sentenceText", { lead: l, text: b.text }) : tl ? t("home.news.sentence", { lead: l, tail: tl }) : `${l}.`;
		const i = s.indexOf(SOURCE);
		return i < 0 || !b.source ? { before: s, after: "" } : { before: s.slice(0, i), after: s.slice(i + 1) };
	};
	// the pages read as one sentence « A, B and 2 other pages »: the locale gives the separators, every title stays a link
	const pageParts = (b: Brief) => {
		const items = [...b.pages.map((p) => p.title), ...(b.more ? [t("home.news.more", { count: b.more })] : [])];
		let i = 0; // elements come back in order: two pages may share a title
		return new Intl.ListFormat(intlLocale(), { type: "conjunction", style: "long" }).formatToParts(items).map((part) => (part.type === "element" ? (i < b.pages.length ? { page: b.pages[i++]! } : { text: part.value }) : { text: part.value }));
	};
	const entry = (b: Brief) => `${toRoute("/log")}#${b.id}`;
</script>

<!-- one continuous rule for the whole block: days and briefs hang on it -->
<ol class="border-muted-foreground/50 mt-3 ml-[3px] flex flex-col gap-5 border-l pl-5">
	{#each days as d (d.day)}
		<li class="relative">
			<span class="bg-muted-foreground absolute top-[7px] -left-[25px] size-[9px]" aria-hidden="true"></span>
			<h3 class="text-base font-semibold first-letter:uppercase"><time datetime={d.day}>{d.label}</time></h3>
			<ol class="mt-2 flex flex-col gap-4">
				{#each d.entries as b (b.id)}
					{@const s = sentence(b)}
					{@const hour = hourOf(b.at)}
					<li class="relative">
						<span class="bg-muted-foreground absolute top-2 -left-6 size-[7px]" aria-hidden="true"></span>
						<p class="text-base leading-normal [overflow-wrap:anywhere] {b.text ? 'line-clamp-3' : ''}">{s.before}{#if b.source}<a href={toPage(b.source.id)} class="text-link link-content underline-offset-4 hover:underline">{b.source.title}</a>{s.after}{/if}</p>
						<p class="text-muted-foreground mt-0.5 text-sm leading-snug [overflow-wrap:anywhere]">
							<a href={entry(b)} class="link-content hover:underline underline-offset-4">{#if hour}<time datetime={b.at}>{hour}</time><span class="sr-only">{t("common.colon")}{t("home.news.entry")}</span>{:else}{t("home.news.entry")}{/if}</a>
							{#if b.pages.length}<span class="mx-1.5" aria-hidden="true">·</span>{#each pageParts(b) as part}{#if "page" in part}<a href={toPage(part.page.id)} class="text-link link-content underline-offset-4 hover:underline">{part.page.title}</a>{:else}{part.text}{/if}{/each}{/if}
						</p>
					</li>
				{/each}
			</ol>
		</li>
	{/each}
</ol>
