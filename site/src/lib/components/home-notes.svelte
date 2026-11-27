<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import HomeNews from "#lib/components/home-news.svelte";
	import { longDay } from "#lib/changes.js";
	import { toPage, toRoute, toTag } from "#lib/links.js";
	import type { Brief } from "#lib/news.js";
	import { typeColor, typeIcon } from "#lib/type-meta.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// The home of a space that holds notes (spaces.svelte.ts: `content` has "notes"), only with what the export publishes: its
	// latest pages, the entities it knows best (people, projects, clients) and, for a space of notes alone, the news of the wiki.
	// Appointments and open actions are not part of it: the export holds no such data.
	type Card = { id: string; type: string; title: string; description: string; tags: string[]; links: number };
	let { recent, people, news = [], onlyNotes = false }: { recent: (Card & { at: string })[]; people: Card[]; news?: Brief[]; onlyNotes?: boolean } = $props();
</script>

<section id="notes-follow-up" aria-labelledby="h-notes" class="anchor-target">
	<h2 id="h-notes" class="text-2xl font-semibold tracking-tight">{t("home.notes.title")}</h2>
	<p class="text-muted-foreground mt-1 text-sm">{t("home.notes.lead")}</p>
	<div class="mt-4 grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
		<section aria-labelledby="h-recent-pages" class="bg-card flex flex-col border p-4 shadow-surface">
			<h3 id="h-recent-pages" class="flex items-center gap-2 text-lg font-semibold"><Icon name="journal" size={20} class="text-muted-foreground" />{t("home.notes.recent")}</h3>
			{#if recent.length}
				<ul class="divide-border mt-3 divide-y">
					{#each recent as p (p.id)}
						<li class="py-3">
							<a href={toPage(p.id)} lang={contentLang} class="text-link link-content flex items-start gap-2 text-base leading-snug font-semibold underline-offset-4 hover:underline">
								<Icon name={typeIcon(p.type)} size={20} class="mt-0.5 shrink-0" style="color: {typeColor(p.type)}" /><span class="min-w-0">{p.title}</span>
							</a>
							{#if p.description}<p lang={contentLang} class="mt-1 line-clamp-2 text-sm">{p.description}</p>{/if}
							<p class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
								{#each p.tags as tag (tag)}<a href={toTag(tag)} class="hover:text-foreground underline-offset-4 hover:underline">#{tag}</a>{/each}
								<time datetime={p.at}>{longDay(p.at.slice(0, 10))}</time>
							</p>
						</li>
					{/each}
				</ul>
				<a href={toRoute("/changes")} class="text-link link-content mt-2 inline-flex min-h-9 items-center gap-1 self-end text-sm underline-offset-4 hover:underline">{t("home.notes.all")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
			{:else}
				<p class="text-muted-foreground mt-3 text-sm">{t("home.notes.empty")}</p>
			{/if}
		</section>
		<div class="flex flex-col gap-6">
			{#if people.length}
				<section aria-labelledby="h-people" class="bg-card flex flex-col border p-4 shadow-surface">
					<h3 id="h-people" class="flex items-center gap-2 text-lg font-semibold"><Icon name="entity" size={20} class="text-muted-foreground" />{t("home.notes.people")}</h3>
					<ul class="touch-gap mt-3 flex flex-wrap gap-2">
						{#each people as p (p.id)}
							<li><a href={toPage(p.id)} lang={contentLang} class="hover:bg-muted bg-card focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11"><Icon name="entity" size={16} style="color: {typeColor(p.type)}" />{p.title}</a></li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if onlyNotes && news.length}
				<section aria-labelledby="h-notes-news" class="bg-card flex flex-col border p-4 shadow-surface">
					<h3 id="h-notes-news" class="flex items-center gap-2 text-lg font-semibold"><Icon name="journal" size={20} class="text-muted-foreground" />{t("home.news")}</h3>
					<HomeNews {news} />
					<a href={toRoute("/log")} class="text-link link-content mt-auto inline-flex min-h-9 items-center gap-1 self-end pt-3 text-sm underline-offset-4 hover:underline">{t("home.news.all")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
				</section>
			{/if}
		</div>
	</div>
</section>
