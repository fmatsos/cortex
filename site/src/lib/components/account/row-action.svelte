<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import type { IconName } from "#lib/icons.js";
	import { t } from "#lib/i18n/index.js";

	// An icon-only action of a list row. The tooltip is `title`; the accessible name is the full sentence (`label`, which names
	// the row: « Rename the conversation « X » »). `unavailable` (the feature of a later phase is not plugged in yet): the
	// button stays focusable and keeps its name (`aria-disabled`, not `disabled`), says why in its tooltip and does nothing.
	let { icon, label, href, onclick, unavailable = false, destructive = false }: {
		icon: IconName; label: string; href?: string; onclick?: () => void; unavailable?: boolean; destructive?: boolean;
	} = $props();
	const tip = $derived(unavailable ? `${label} (${t("account.soon")})` : label);
</script>

<Button
	variant="outline"
	size="icon"
	{href}
	aria-label={label}
	title={tip}
	aria-disabled={unavailable || undefined}
	class="{destructive ? 'text-destructive hover:text-destructive' : ''} {unavailable ? 'cursor-not-allowed opacity-50' : ''}"
	onclick={(e: MouseEvent) => { if (unavailable) { e.preventDefault(); return; } onclick?.(); }}
>
	<Icon name={icon} size={18} />
</Button>
