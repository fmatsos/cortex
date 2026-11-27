<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import SpaceBadges from "#lib/components/space-badges.svelte";
	import type { Scope } from "#lib/space-search.js";
	import { labelOf, spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Where a search looks. By default the space of the page, said, never silent. On the search page (`choose`), someone signed in who has
	// more than one space may widen it: all their spaces, or the ones they pick. The server drops what they may not see.
	// `kind` "ask": the same choice for what the assistant reads (its own words; a conversation stays in the space it is asked in).
	let { choose = false, kind = "search", scope = $bindable<Scope>("current"), picked = $bindable<string[]>([]) }: { choose?: boolean; kind?: "search" | "ask"; scope?: Scope; picked?: string[] } = $props();
	const uid = $props.id();
	const info = $derived(spaces.available ? spaces.info : undefined);
	const wide = $derived(choose && !!account.me && spaces.list.length > 1);
	const toggle = (name: string, on: boolean) => { picked = on ? [...picked, name] : picked.filter((n) => n !== name); };
	const OPTIONS: { value: Scope; label: "spaces.search.current" | "spaces.search.all" | "spaces.search.set" }[] = [
		{ value: "current", label: "spaces.search.current" }, { value: "all", label: "spaces.search.all" }, { value: "set", label: "spaces.search.set" },
	];
</script>

{#if info && wide}
	<fieldset class="mt-3 flex flex-col gap-2">
		<legend class="text-muted-foreground mb-1 flex items-center gap-1.5 text-sm font-semibold"><Icon name="space" size={16} />{kind === "ask" ? t("spaces.ask.in") : t("spaces.search.in")}</legend>
		<div class="flex flex-wrap gap-x-6 gap-y-1">
			{#each OPTIONS as o (o.value)}
				<label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input type="radio" name="{uid}-scope" value={o.value} class="accent-primary size-4" bind:group={scope} />
					<span>{t(o.label)}{#if o.value === "current"} <strong class="font-semibold">{labelOf(info)}</strong>{/if}</span>
				</label>
			{/each}
		</div>
		{#if scope === "set"}
			<div class="border-border bg-card shadow-surface mt-1 border p-3">
				<p class="mb-2 text-sm">{kind === "ask" ? t("spaces.ask.include") : t("spaces.search.include")}</p>
				<ul class="flex flex-wrap gap-x-6 gap-y-1">
					{#each spaces.list as s (s.name)}
						<li><label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
							<input type="checkbox" class="accent-primary size-4" checked={picked.includes(s.name)} onchange={(e) => toggle(s.name, e.currentTarget.checked)} />
							<span>{labelOf(s)} <span class="text-muted-foreground text-xs">{s.name}</span></span>
							<span class="flex gap-1"><SpaceBadges content={s.content} readOnly={s.readOnly} /></span>
						</label></li>
					{/each}
				</ul>
				{#if kind === "ask" && !picked.length}<p class="text-muted-foreground mt-2 text-xs" role="status">{t("spaces.ask.none")}</p>{/if}
			</div>
		{/if}
	</fieldset>
{:else if info}
	<p class="text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5 text-sm"><Icon name="space" size={16} />{kind === "ask" ? t("spaces.ask.scope") : t("spaces.search.scope")} <strong class="text-foreground font-semibold">{labelOf(info)}</strong></p>
{/if}
