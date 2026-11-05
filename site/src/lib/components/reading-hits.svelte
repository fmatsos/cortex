<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { hasTerms, hitRanges, hitTerms, type HitTerms } from "#lib/article.js";
	import { parseQuery } from "#lib/query.js";
	import { toRoute } from "#lib/links.js";
	import { t as tr } from "#lib/i18n/index.js";

	// Reading a search result (UX26): when the address carries `?q=`, the found terms are highlighted in the body
	// (`<mark>`), "Aller au passage trouvé" leads to the first, then "Passage suivant / précédent" walks through the others;
	// "Retour aux résultats" goes back to the search (to the same place if you came from it). The highlighting can be cleared at will.
	let { container, q, pageId, fromSearch }: { container?: HTMLElement; q: string; pageId: string; fromSearch: boolean } = $props();

	const terms = $derived(hitTerms(parseQuery(q)));
	const key = $derived(`${pageId}|${q}`);
	let dismissed = $state("");
	const active = $derived(hasTerms(terms) && dismissed !== key);

	let marks = $state<HTMLElement[]>([]);
	let at = $state(-1);
	let announce = $state("");
	const MAX = 300;

	/** Wraps each found range in a `<mark data-hit>` (outside footnote calls); returns the marks in text order. */
	function markHits(root: HTMLElement, t: HitTerms): HTMLElement[] {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => (n.parentElement?.closest("mark, script, style, .fn-ref") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
		});
		const nodes: Text[] = [];
		while (walker.nextNode()) nodes.push(walker.currentNode as Text);
		const out: HTMLElement[] = [];
		for (const node of nodes) {
			if (out.length >= MAX) break;
			const rs = hitRanges(node.data, t);
			if (!rs.length) continue;
			const frag = document.createDocumentFragment();
			let from = 0;
			for (const [a, b] of rs) {
				if (a > from) frag.append(node.data.slice(from, a));
				const m = document.createElement("mark");
				m.dataset.hit = "";
				m.textContent = node.data.slice(a, b);
				frag.append(m);
				out.push(m);
				from = b;
			}
			if (from < node.data.length) frag.append(node.data.slice(from));
			node.replaceWith(frag);
		}
		return out;
	}
	function unmark(root: HTMLElement) {
		for (const m of root.querySelectorAll("mark[data-hit]")) m.replaceWith(m.textContent ?? "");
		root.normalize();
	}

	// the body is an `{@html}`: the highlighting is reapplied when the page or the query changes, and removed on cleanup
	$effect(() => {
		void pageId;
		if (!container || !active) return;
		const root = container, found = markHits(root, terms);
		marks = found;
		at = -1;
		announce = "";
		return () => { unmark(root); marks = []; at = -1; };
	});

	const go = (i: number) => {
		if (!marks.length) return;
		marks[at]?.removeAttribute("data-current");
		at = (i + marks.length) % marks.length;
		const m = marks[at];
		m.setAttribute("data-current", "");
		m.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
		const around = (m.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
		announce = tr("hits.announce", { n: at + 1, total: marks.length, text: around });
	};

	const searchHref = $derived(`${toRoute("/search")}?q=${encodeURIComponent(q)}`);
	// coming from the search: history back restores the results, the filter and the position
	const back = (e: MouseEvent) => { if (fromSearch && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); history.back(); } };
</script>

{#if active}
	<section aria-labelledby="hits-title" class="bg-card mb-6 rounded-lg border p-3 text-sm print:hidden">
		<h2 id="hits-title" class="flex items-center gap-2 font-semibold"><Icon name="search" size={16} />{tr("hits.title", { q: q.trim() })}</h2>
		<p class="text-muted-foreground mt-1">
			{#if marks.length}{marks.length >= MAX ? tr("hits.countMax", { count: MAX }) : tr("hits.count", { count: marks.length })}
			{:else}{tr("hits.none")}{/if}
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			{#if marks.length}
				<Button size="sm" onclick={() => go(at < 0 ? 0 : at + 1)}>
					<Icon name="chevron-down" size={16} />{at < 0 ? tr("hits.goTo") : tr("hits.next")}
				</Button>
				{#if at >= 0}
					<Button variant="outline" size="sm" onclick={() => go(at - 1)}><Icon name="chevron-down" size={16} class="rotate-180" />{tr("hits.previous")}</Button>
					<span class="text-muted-foreground" aria-hidden="true">{at + 1} / {marks.length}</span>
				{/if}
			{/if}
			<Button variant="outline" size="sm" href={searchHref} onclick={back}><Icon name="back" size={16} />{tr("hits.backToResults")}</Button>
			<Button variant="ghost" size="sm" onclick={() => (dismissed = key)}><Icon name="clear" size={16} />{tr("hits.clear")}</Button>
		</div>
		<p role="status" class="sr-only">{announce}</p>
	</section>
{/if}

<style>
	/* the current passage stands out from the other marks (ring, not only color) */
	:global(.wiki mark[data-hit][data-current]) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	:global(.wiki mark[data-hit]) {
		scroll-margin-top: var(--anchor-offset);
	}
</style>
