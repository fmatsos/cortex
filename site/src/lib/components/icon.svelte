<script lang="ts">
	import { ICONS, strokeFor, type IconName } from "#lib/icons.js";
	import { cn } from "#lib/utils.js";

	// Pack d'icônes du projet (voir lib/icons.ts). Décorative par défaut (aria-hidden) ; avec `label`, l'icône porte
	// son propre nom accessible (role="img"). Un bouton garde de préférence son texte visible : l'icône l'accompagne.
	// `filled` : réservé à l'étoile active.
	let { name, size = 20, label, filled = false, class: className, style }: { name: IconName; size?: number; label?: string; filled?: boolean; class?: string; style?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? "currentColor" : "none"}
	stroke="currentColor"
	stroke-width={strokeFor(size)}
	stroke-linecap="round"
	stroke-linejoin="round"
	focusable="false"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
	class={cn("shrink-0", className)}
	{style}
>{@html ICONS[name]}</svg>
