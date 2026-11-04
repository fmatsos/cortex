<script lang="ts">
	import { theme, type Mode } from "#lib/theme.svelte.js";

	// Choix explicite du thème (le mécanisme : attribut data-theme sur <html>, mémorisé dans localStorage)
	let { class: className = "" } = $props();
</script>

<label class="text-muted-foreground flex items-center gap-1.5 text-sm {className}">
	<span class="sr-only sm:not-sr-only">Thème</span>
	<select
		class="bg-background text-foreground border-input focus-visible:ring-ring/50 h-8 pointer-coarse:h-11 rounded-lg border px-2 text-sm focus-visible:ring-3"
		value={theme.mode}
		onchange={(e) => theme.set(e.currentTarget.value as Mode)}
	>
		<option value="system">Système</option>
		<option value="light">Clair</option>
		<option value="dark">Sombre</option>
	</select>
</label>
