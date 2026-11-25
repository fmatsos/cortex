<script lang="ts">
	import NameDialog from "#lib/components/account/name-dialog.svelte";
	import SignInDialog from "#lib/components/account/sign-in-dialog.svelte";
	import { t } from "#lib/i18n/index.js";
	import type { JourneyFlow } from "./journey-flow.svelte.js";

	// The dialogs of the journey panel's Save button: the name of a journey saved for the first time (its first and last pages by
	// default) and the invitation to sign in. They sit outside the panel: the page behind a modal is inert.
	let { flow }: { flow: JourneyFlow } = $props();
</script>

<NameDialog bind:open={flow.saveOpen} heading={t("journey.saveDialog.title")} description={t("journey.saveDialog.text")} label={t("journey.saveDialog.label")} confirm={t("journey.saveDialog.confirm")} failure={t("journey.save.failed")}
	value={flow.defaultTitle} onsave={(title) => flow.submitName(title)} />

<SignInDialog bind:open={flow.signInOpen} heading={t("journey.signInDialog.title")} text={t("journey.signInDialog.text")} />
