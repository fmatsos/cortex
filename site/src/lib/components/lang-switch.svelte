<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { lang, type LangChoice } from "#lib/lang.svelte.js";
	import { defaultLocale, LOCALE_NAMES, t } from "#lib/i18n/index.js";

	// Interface language only (never the wiki content): "default" = the export's language (cortex.json `language`).
	// Same pattern as the theme selector: a native <select>, label visible from `sm`, 44 px under a coarse pointer.
	let { class: className = "" } = $props();
</script>

<label class="text-muted-foreground flex items-center gap-1.5 text-sm {className}">
	<span class="sr-only sm:not-sr-only">{t("lang.label")}</span>
	<span class="relative flex items-center">
		<Icon name="language" size={16} class="text-muted-foreground pointer-events-none absolute left-2" />
		<select
			class="bg-card text-foreground border-input focus-visible:ring-ring/50 h-8 pointer-coarse:h-11 rounded-md border pr-2 pl-8 text-sm focus-visible:ring-3"
			value={lang.choice}
			onchange={(e) => lang.set(e.currentTarget.value as LangChoice)}
		>
			<option value="system">{t("lang.default", { name: LOCALE_NAMES[defaultLocale] })}</option>
			<option value="en" lang="en">{LOCALE_NAMES.en}</option>
			<option value="fr" lang="fr">{LOCALE_NAMES.fr}</option>
		</select>
	</span>
</label>
