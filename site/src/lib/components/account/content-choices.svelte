<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { CONTENTS, type Content } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// What a space holds: Resources, Notes, or both (at least one). The error is announced in an `aria-live` region that exists
	// from the first render; `invalid` (the form was submitted with none) marks the checkboxes.
	let { value = $bindable([]), disabled = false, invalid = false }: { value?: Content[]; disabled?: boolean; invalid?: boolean } = $props();
	const uid = $props.id();
	const toggle = (c: Content, on: boolean) => { value = on ? CONTENTS.filter((x) => x === c || value.includes(x)) : value.filter((x) => x !== c); };
	const error = $derived(invalid && !value.length ? t("spaces.content.required") : "");
</script>

<fieldset class="flex flex-col gap-2" aria-describedby="{uid}-error" {disabled}>
	<legend class="mb-1 text-sm font-semibold">{t("spaces.content.legend")} <span class="text-muted-foreground font-normal">· {t("spaces.content.atLeastOne")}</span></legend>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each CONTENTS as c (c)}
			<label for="{uid}-{c}" class="has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:checked]:border-primary border-input flex cursor-pointer items-start gap-2.5 border p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
				<input id="{uid}-{c}" type="checkbox" name="content" value={c} class="accent-primary mt-1 size-4 shrink-0" checked={value.includes(c)} aria-invalid={error ? "true" : undefined} onchange={(e) => toggle(c, e.currentTarget.checked)} />
				<span>
					<strong class="flex items-center gap-1.5 text-sm"><Icon name={c === "notes" ? "journal" : "space"} size={16} />{t(c === "notes" ? "spaces.content.notes" : "spaces.content.resources")}</strong>
					<small class="text-muted-foreground mt-1 block text-xs">{t(c === "notes" ? "spaces.content.notes.hint" : "spaces.content.resources.hint")}</small>
				</span>
			</label>
		{/each}
	</div>
	<p id="{uid}-error" role="alert" class="text-destructive text-sm empty:hidden">{error}</p>
</fieldset>
