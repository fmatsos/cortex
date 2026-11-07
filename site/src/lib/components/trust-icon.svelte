<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import type { IconName } from "#lib/icons.js";

	// Secondary state (draft, unverified, review…): icon alone, meaning in `title` on hover and in sr-only text for screen readers.
	let { icon, label, class: cls = "" }: { icon: IconName; label: string; class?: string } = $props();
</script>

<span class="text-muted-foreground inline-flex items-center {cls}" title={label}><Icon name={icon} size={16} /><span class="sr-only">{label}</span></span>
