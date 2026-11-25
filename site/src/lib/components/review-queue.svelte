<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { inQueue, loadDone, loadQueue, markDone, position, queueHref } from "#lib/review-queue.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// Article reached from the review queue (`?queue=review`, readable only in the browser: the pages are prerendered):
	// where the page stands in the list, and a link to the next page. Going on is always the reader's choice, validated
	// or not (a page can be skipped); nothing here validates anything or navigates by itself.
	let { id, reviewed = false }: { id: string; reviewed?: boolean } = $props();
	let from = $state(false);
	let queue = $state(loadQueue());
	let done = $state(loadDone());
	afterNavigate((nav) => {
		from = !!nav.to && inQueue(nav.to.url.searchParams);
		queue = loadQueue();
		done = loadDone();
	});
	// the validation of this page is remembered for the tab: the queue skips it from now on
	$effect(() => { if (reviewed) { markDone(id); done = loadDone(); } });
	const where = $derived(from ? position(queue, id, done) : undefined);
</script>

{#if where}
	<nav aria-label={t("review.queue")} class="bg-muted/50 shadow-surface mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border p-3 text-sm">
		<p class="flex items-center gap-2 font-medium"><Icon name="needs-review" size={16} />{t("review.queue.position", { index: where.index, total: where.total })}</p>
		<!-- the page's own message (page-actions) says the page is marked as reviewed: this one only says what comes next, so nothing is announced twice -->
		<p class="text-muted-foreground" role="status">{reviewed ? (where.next ? t("review.queue.validated") : t("review.queue.end")) : ""}</p>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if where.next}
				<Button size="sm" variant={reviewed ? "default" : "outline"} href={queueHref(toPage(where.next.id))}>{t("review.queue.next")}<span class="sr-only">{t("common.colon")}<span lang={contentLang}>{where.next.title}</span></span><Icon name="chevron-down" size={16} class="-rotate-90" /></Button>
			{:else if !reviewed}
				<span class="text-muted-foreground">{t("review.queue.end")}</span>
			{/if}
			<Button size="sm" variant="ghost" href={toRoute("/review")}>{t("review.queue.back")}</Button>
		</div>
	</nav>
{/if}
