<script lang="ts">
	import KindBadge from "#lib/components/kind-badge.svelte";
	import { toPage } from "#lib/links.js";
	import { KINDS, kindColor, kindLabel, typeColor } from "#lib/type-meta.js";

	let { data } = $props();
	let kind = $state(""); // "" = toutes les entrées
	const total = $derived(data.entries.length);
	const counts = $derived(KINDS.map((k) => ({ ...k, n: data.entries.filter((e) => e.kind === k.kind).length })).filter((k) => k.n));
	const shown = $derived(data.entries.filter((e) => !kind || e.kind === kind));
	// les entrées arrivent triées (jour décroissant, plus récente d'abord) : un jour = une série contiguë
	const days = $derived(shown.reduce<{ day: string; entries: typeof shown }[]>((acc, e) => {
		const day = e.at.slice(0, 10);
		if (acc.at(-1)?.day === day) acc.at(-1)!.entries.push(e); else acc.push({ day, entries: [e] });
		return acc;
	}, []));
	// UTC : la date écrite dans le journal, sans décalage selon le fuseau du lecteur
	const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
	const long = (day: string) => fmt.format(new Date(`${day}T00:00:00Z`));
	const hour = (at: string) => (at.length > 10 ? at.slice(11, 16) : "");
</script>

<svelte:head><title>Journal · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Journal</h1>

{#if total}
	<p class="text-muted-foreground mt-2 text-sm" role="status">{shown.length === total ? `${total} entrées` : `${shown.length} sur ${total} entrées`}</p>
	<ul class="touch-gap mt-4 flex flex-wrap gap-2" aria-label="Filtrer par type d'entrée">
		<li>
			<button type="button" class="chip" aria-pressed={kind === ""} onclick={() => (kind = "")}>Tout <span class="text-muted-foreground">{total}</span></button>
		</li>
		{#each counts as k (k.kind)}
			<li>
				<button type="button" class="chip" aria-pressed={kind === k.kind} onclick={() => (kind = kind === k.kind ? "" : k.kind)}>
					<span class="inline-block size-2.5 rounded-full" style:background={kindColor(k.kind)} aria-hidden="true"></span>
					{k.label} <span class="text-muted-foreground">{k.n}</span>
				</button>
			</li>
		{/each}
	</ul>

	<ol class="mt-8 max-w-3xl space-y-10">
		{#each days as d (d.day)}
			<li>
				<h2 class="flex items-baseline gap-2 text-lg font-semibold first-letter:uppercase">
					<time datetime={d.day}>{long(d.day)}</time>
					<span class="text-muted-foreground text-sm font-normal">{d.entries.length} {d.entries.length > 1 ? "entrées" : "entrée"}</span>
				</h2>
				<ol class="border-border mt-4 ml-1 space-y-5 border-l pl-6">
					{#each d.entries as e, i (i)}
						<li class="relative">
							<span class="bg-background absolute top-1.5 -left-[1.9rem] flex size-3 items-center justify-center rounded-full" aria-hidden="true">
								<span class="size-2.5 rounded-full" style:background={kindColor(e.kind)}></span>
							</span>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<KindBadge kind={e.kind} />
								{#if hour(e.at)}<time datetime={e.at} class="text-muted-foreground text-xs tabular-nums">{hour(e.at)}</time>{/if}
							</div>
							<p class="wiki mt-1.5 text-[0.95rem]"><span class="sr-only">{kindLabel(e.kind)} : </span>{@html e.html}</p>
							{#if e.pages.length || e.sources.length}
								<ul class="touch-gap mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Références de l'entrée">
									{#each e.pages as p (p.id)}
										<li class="flex items-center gap-1.5">
											<span class="inline-block size-2 rounded-full" style:background={typeColor(p.type)} aria-hidden="true"></span>
											<a href={toPage(p.id)} class="text-link underline-offset-4 hover:underline">{p.title}</a>
										</li>
									{/each}
									{#each e.sources as s (s.id)}
										<li class="flex items-center gap-1.5">
											<span class="text-muted-foreground">Source</span>
											{#if s.page}
												<a href={toPage(s.page.id)} class="text-link underline-offset-4 hover:underline">{s.page.title}</a>
											{:else}
												<code class="bg-muted rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">{s.id}</code>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ol>
			</li>
		{/each}
	</ol>
{:else}
	<p class="text-muted-foreground mt-4">Le journal est vide.</p>
{/if}

<style>
	.chip {
		display: inline-flex;
		height: 1.75rem;
		align-items: center;
		gap: 0.375rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		padding-inline: 0.75rem;
		font-size: 0.875rem;
		position: relative;
	}
	.chip:hover {
		background: var(--muted);
	}
	.chip[aria-pressed="true"] {
		background: var(--secondary);
		border-color: var(--foreground);
		font-weight: 600;
	}
	@media (pointer: coarse) {
		.chip::after {
			content: "";
			position: absolute;
			inset-block: -8px;
			inset-inline: 0;
		}
	}
</style>
