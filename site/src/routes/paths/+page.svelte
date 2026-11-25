<script lang="ts">
	import { toPath } from "#lib/path-links.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	let { data } = $props();
</script>

<svelte:head><title>{t("paths.title")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("paths.title")}</h1>
<p class="text-muted-foreground mt-2 max-w-prose text-sm">{t("paths.lead")}</p>

{#if data.paths.length}
	<!-- rows, like the tags: the goal tells what the path is for, the number of steps how long it is -->
	<ul class="border-border mt-6 divide-y border-y">
		{#each data.paths as p (p.slug)}
			<li>
				<a href={toPath(p.slug)} class="hover:bg-muted focus-visible:outline-ring grid min-h-11 gap-x-4 gap-y-1 px-2 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 sm:grid-cols-[minmax(0,1fr)_auto]">
					<span class="min-w-0">
						<span lang={contentLang} class="text-link block font-medium [overflow-wrap:anywhere]">{p.title}</span>
						<span lang={contentLang} class="text-muted-foreground mt-0.5 block text-sm">{p.goal}</span>
					</span>
					<span class="text-muted-foreground text-sm tabular-nums sm:self-center">{t("paths.steps", { count: p.steps })}</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<div class="border-border mt-6 max-w-prose border p-4">
		<p class="font-medium">{t("paths.none")}</p>
		<p class="text-muted-foreground mt-2 text-sm">{t("paths.none.help")}</p>
	</div>
{/if}
