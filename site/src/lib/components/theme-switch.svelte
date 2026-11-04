<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { theme, type Mode } from "#lib/theme.svelte.js";

	// Explicit theme choice (the mechanism: data-theme attribute on <html>, remembered in localStorage).
	// The icon follows the current choice; it is decorative, the <select> keeps its label visible or hidden.
	let { class: className = "" } = $props();
	const ICON = { system: "system", light: "sun", dark: "moon" } as const;
</script>

<label class="text-muted-foreground flex items-center gap-1.5 text-sm {className}">
	<span class="sr-only sm:not-sr-only">Thème</span>
	<span class="relative flex items-center">
		<Icon name={ICON[theme.mode]} size={16} class="text-muted-foreground pointer-events-none absolute left-2" />
		<select
			class="bg-card text-foreground border-input focus-visible:ring-ring/50 h-8 pointer-coarse:h-11 rounded-md border pr-2 pl-8 text-sm focus-visible:ring-3"
			value={theme.mode}
			onchange={(e) => theme.set(e.currentTarget.value as Mode)}
		>
			<option value="system">Système</option>
			<option value="light">Clair</option>
			<option value="dark">Sombre</option>
		</select>
	</span>
</label>
