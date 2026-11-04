<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { hasTerms, hitRanges, hitTerms, type HitTerms } from "#lib/article.js";
	import { parseQuery } from "#lib/query.js";
	import { toRoute } from "#lib/links.js";

	// Lecture d'un résultat de recherche (UX26) : quand l'adresse porte `?q=`, les termes trouvés sont surlignés dans le corps
	// (`<mark>`), « Aller au passage trouvé » mène au premier, puis « Passage suivant / précédent » parcourt les autres ;
	// « Retour aux résultats » revient à la recherche (au même endroit si on en vient). Le surlignage s'efface à volonté.
	let { container, q, pageId, fromSearch }: { container?: HTMLElement; q: string; pageId: string; fromSearch: boolean } = $props();

	const terms = $derived(hitTerms(parseQuery(q)));
	const key = $derived(`${pageId}|${q}`);
	let dismissed = $state("");
	const active = $derived(hasTerms(terms) && dismissed !== key);

	let marks = $state<HTMLElement[]>([]);
	let at = $state(-1);
	let announce = $state("");
	const MAX = 300;

	/** Enveloppe chaque plage trouvée d'un `<mark data-hit>` (hors appels de note) ; renvoie les marques dans l'ordre du texte. */
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

	// le corps est un `{@html}` : le surlignage se repose quand la page ou la requête change, et se retire au nettoyage
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
		announce = `Passage ${at + 1} sur ${marks.length} : ${around}`;
	};

	const searchHref = $derived(`${toRoute("/search")}?q=${encodeURIComponent(q)}`);
	// venu de la recherche : le retour de l'historique restitue les résultats, le filtre et la position
	const back = (e: MouseEvent) => { if (fromSearch && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); history.back(); } };
</script>

{#if active}
	<section aria-labelledby="hits-title" class="bg-card mb-6 rounded-lg border p-3 text-sm print:hidden">
		<h2 id="hits-title" class="flex items-center gap-2 font-semibold"><Icon name="search" size={16} />Recherche « {q.trim()} »</h2>
		<p class="text-muted-foreground mt-1">
			{#if marks.length}{marks.length >= MAX ? `${MAX} passages ou plus` : `${marks.length} passage${marks.length > 1 ? "s" : ""}`} surligné{marks.length > 1 ? "s" : ""} dans le texte.
			{:else}Aucun passage du texte ne reprend ces termes à l'identique : ils figurent peut-être dans le titre, la description, ou sous une forme voisine.{/if}
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			{#if marks.length}
				<Button size="sm" onclick={() => go(at < 0 ? 0 : at + 1)}>
					<Icon name="chevron-down" size={16} />{at < 0 ? "Aller au passage trouvé" : "Passage suivant"}
				</Button>
				{#if at >= 0}
					<Button variant="outline" size="sm" onclick={() => go(at - 1)}><Icon name="chevron-down" size={16} class="rotate-180" />Passage précédent</Button>
					<span class="text-muted-foreground" aria-hidden="true">{at + 1} / {marks.length}</span>
				{/if}
			{/if}
			<Button variant="outline" size="sm" href={searchHref} onclick={back}><Icon name="back" size={16} />Retour aux résultats</Button>
			<Button variant="ghost" size="sm" onclick={() => (dismissed = key)}><Icon name="clear" size={16} />Effacer le surlignage</Button>
		</div>
		<p role="status" class="sr-only">{announce}</p>
	</section>
{/if}

<style>
	/* le passage courant se distingue des autres marques (anneau, pas seulement la couleur) */
	:global(.wiki mark[data-hit][data-current]) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	:global(.wiki mark[data-hit]) {
		scroll-margin-top: var(--anchor-offset);
	}
</style>
