<script lang="ts">
	import { tick } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import ChipButton from "#lib/components/chip-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import KindBadge from "#lib/components/kind-badge.svelte";
	import LogEntryItem from "#lib/components/log-entry.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { toRoute } from "#lib/links.js";
	import { archives, countBy, dayLabel, dayOf, dayShort, filterEntries, filterQuery, groupDays, isUnfiltered, type LogFilter, monthLabel, NO_FILTER, readFilter, withIds } from "#lib/log-view.js";
	import { KINDS, kindColor, kindDescription, kindIcon } from "#lib/type-meta.js";

	const STEP = 20; // entrées affichées par tranche
	let { data } = $props();

	// Les filtres (type, texte, période) font foi dans l'URL : la page prérendue n'en connaît aucun, ils se lisent dans le navigateur.
	let f = $state<LogFilter>({ ...NO_FILTER });
	let extra = $state(0); // tranches supplémentaires demandées
	let targetId = $state(""); // entrée visée par le lien direct (#e-…) : toujours affichée
	let ready = $state(false);
	let search = $state<HTMLInputElement | null>(null);

	const all = $derived(withIds(data.entries));
	const total = $derived(all.length);
	const filtered = $derived(filterEntries(all, f));
	const targetIdx = $derived(targetId ? filtered.findIndex((e) => e.id === targetId) : -1);
	const count = $derived(Math.max(STEP + extra, targetIdx + 1));
	const visible = $derived(filtered.slice(0, count));
	const remaining = $derived(filtered.length - visible.length);
	const days = $derived(groupDays(visible));
	const dayTotals = $derived(countBy(filtered, dayOf));

	// décomptes par facette : chaque liste tient compte des autres filtres, pas du sien
	const kindCounts = $derived(countBy(filterEntries(all, f, "kind"), (e) => e.kind));
	const kindsShown = $derived(KINDS.filter((k) => kindCounts.has(k.kind) || f.kind === k.kind));
	const kindTotal = $derived([...kindCounts.values()].reduce((a, b) => a + b, 0));
	const months = $derived(archives(filterEntries(all, f, "month")).months);
	const dayList = $derived(archives(filterEntries(all, f, "day")).days);
	const monthValue = $derived(f.month || f.day.slice(0, 7));
	const dayGroups = $derived(
		(f.month ? [f.month] : months.map((m) => m.month)).map((month) => ({ month, days: dayList.filter((d) => d.day.startsWith(month)) })).filter((g) => g.days.length),
	);

	const set = (next: Partial<LogFilter>) => {
		f = { ...f, ...next };
		extra = 0;
		targetId = "";
	};
	const reset = () => {
		set(NO_FILTER);
		void tick().then(() => search?.focus());
	};
	async function more() {
		const from = visible.length;
		extra = Math.max(extra, count - STEP) + STEP;
		await tick();
		document.getElementById(filtered[from]?.id ?? "")?.focus(); // le focus passe à la première entrée ajoutée
	}

	afterNavigate(async (nav) => {
		const url = nav.to?.url;
		if (!url) return;
		const next = readFilter(url.searchParams);
		if (filterQuery(next) !== filterQuery(f)) f = next;
		const hash = decodeURIComponent(url.hash.slice(1));
		targetId = /^e-[\w-]+$/.test(hash) ? hash : "";
		ready = true;
		if (targetId) {
			await tick();
			// laisser les entrées se replier en résumés (la hauteur de la page change) avant de se placer
			setTimeout(() => document.getElementById(targetId)?.scrollIntoView(), 120);
		}
	});
	// la saisie met l'URL à jour sur place (sans entrée d'historique)
	const query = $derived(filterQuery(f));
	$effect(() => {
		if (!ready || location.search === query) return;
		void goto(`${toRoute("/log")}${query}`, { shallow: true, replace: true, keepFocus: true, noScroll: true });
	});

	const select = "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 pointer-coarse:h-11 w-full rounded-md border px-2.5 text-sm outline-none focus-visible:ring-3";
</script>

<svelte:head><title>Journal · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Journal</h1>

{#if total}
	<div class="mt-4 grid max-w-3xl gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
		<div>
			<label for="journal-recherche" class="mb-1 block text-sm font-medium">Rechercher dans le journal</label>
			<Input id="journal-recherche" bind:ref={search} type="search" placeholder="Mot, page, source…" autocomplete="off" value={f.q} oninput={(e) => set({ q: e.currentTarget.value })} />
		</div>
		<div>
			<label for="journal-mois" class="mb-1 block text-sm font-medium">Période</label>
			<select id="journal-mois" class={select} value={monthValue} onchange={(e) => set({ month: e.currentTarget.value, day: "" })}>
				<option value="">Toutes</option>
				{#each months as m (m.month)}
					<option value={m.month}>{monthLabel(m.month)} ({m.n})</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="journal-jour" class="mb-1 block text-sm font-medium">Aller à un jour</label>
			<select id="journal-jour" class={select} value={f.day} onchange={(e) => set({ day: e.currentTarget.value, month: "" })}>
				<option value="">Tous les jours</option>
				{#each dayGroups as g (g.month)}
					<optgroup label={monthLabel(g.month)}>
						{#each g.days as d (d.day)}
							<option value={d.day}>{dayShort(d.day)} ({d.n})</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</div>
	</div>

	<ul class="touch-gap mt-4 flex flex-wrap gap-2" aria-label="Filtrer par type d'entrée">
		<li>
			<ChipButton pressed={f.kind === ""} onclick={() => set({ kind: "" })}>Tout <span class="text-muted-foreground">{kindTotal}</span></ChipButton>
		</li>
		{#each kindsShown as k (k.kind)}
			<li>
				<ChipButton pressed={f.kind === k.kind} describedby="type-{k.kind}" onclick={() => set({ kind: f.kind === k.kind ? "" : k.kind })}>
					<Icon name={kindIcon(k.kind)} size={16} style="color: {kindColor(k.kind)}" />
					{k.label} <span class="text-muted-foreground">{kindCounts.get(k.kind) ?? 0}</span>
				</ChipButton>
			</li>
		{/each}
	</ul>

	<!-- la légende naît côté client : la page prérendue garde le texte des entrées en premier (brain.test.ts compare leur ordre) -->
	{#if ready}
	<details class="group mt-3 max-w-3xl">
		<summary class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 touch-target inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-md text-sm focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
			<Icon name="chevron-down" size={16} class="motion-safe:transition-transform group-open:rotate-180" />
			Que signifient les types d'entrée ?
		</summary>
		<dl class="mt-2 space-y-2 text-sm">
			{#each KINDS as k (k.kind)}
				<div class="grid items-baseline gap-x-3 gap-y-1 sm:grid-cols-[9.5rem_1fr]">
					<dt><KindBadge kind={k.kind} /></dt>
					<dd id="type-{k.kind}" class="text-muted-foreground">{kindDescription(k.kind)}</dd>
				</div>
			{/each}
		</dl>
	</details>
	{/if}

	<p class="text-muted-foreground mt-4 text-sm" role="status">
		{filtered.length === total ? `${total} entrées` : `${filtered.length} sur ${total} entrées`}{#if filtered.length && remaining}, {visible.length} affichées{/if}
	</p>

	{#if filtered.length}
		<ol class="mt-6 max-w-3xl space-y-10">
			{#each days as d (d.day)}
				<li>
					<h2 class="flex items-baseline gap-2 text-lg font-semibold first-letter:uppercase">
						<time datetime={d.day}>{dayLabel(d.day)}</time>
						<span class="text-muted-foreground text-sm font-normal">{dayTotals.get(d.day)} {(dayTotals.get(d.day) ?? 0) > 1 ? "entrées" : "entrée"}</span>
					</h2>
					<ol class="border-border mt-4 ml-1 space-y-5 border-l pl-6">
						{#each d.entries as e (e.id)}
							<LogEntryItem entry={e} target={e.id === targetId} />
						{/each}
					</ol>
				</li>
			{/each}
		</ol>
		{#if remaining}
			<div class="mt-8">
				<Button variant="outline" onclick={more}>
					Afficher {Math.min(STEP, remaining)} entrée{Math.min(STEP, remaining) > 1 ? "s" : ""} de plus
					<span class="text-muted-foreground">({remaining} restante{remaining > 1 ? "s" : ""})</span>
				</Button>
			</div>
		{/if}
	{:else}
		<div class="mt-6 max-w-3xl">
			<p class="text-muted-foreground">Aucune entrée du journal ne correspond{f.q.trim() ? ` à « ${f.q.trim()} »` : ""}.</p>
			{#if !isUnfiltered(f)}
				<Button variant="outline" class="mt-3" onclick={reset}>
					<Icon name="clear" size={16} />
					Effacer les filtres
				</Button>
			{/if}
		</div>
	{/if}
{:else}
	<p class="text-muted-foreground mt-4">Le journal est vide.</p>
{/if}
