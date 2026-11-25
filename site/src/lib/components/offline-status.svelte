<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import { dev, version } from "$app/env";
	import Icon from "#lib/components/icon.svelte";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { type OfflineState, estimateBytes, formatBytes, isOfflineState, percent } from "#lib/offline.js";
	import type { IconName } from "#lib/icons.js";
	import { storageKey } from "#lib/storage.js";
	import { t } from "#lib/i18n/index.js";

	// Offline mode status. It owns the service worker state and gives its menu section to the caller (the preferences menu):
	// the state (preparing, available, failed + retry), the kept version, the connection and the full download of the wiki.
	// Every change (state, connection, download) is announced in an `aria-live` region. Only what the visitor triggers
	// (a download) or a real connection change is also shown, for a few seconds, in a small toast; the toast stays while the
	// visitor is offline or a download runs. A state found at load (offline mode ready, installation failed) is for screen
	// readers only: it must not stay on screen. No permanent floating button.
	let { children }: { children?: Snippet<[{ section: Snippet; refresh: () => void; offline: boolean; attention: boolean }]> } = $props();
	const KEY = storageKey("offline-ready");
	const MESSAGE_MS = 4000;

	let offline = $state(false);
	let supported = $state(true); // service worker available (secure context, recent browser)
	let registered = $state<boolean | undefined>(undefined); // `undefined`: not checked yet (registration happens on page load)
	let failed = $state(false); // the installation ended in failure
	let waiting = $state(false); // a new version is installed and waits for the tabs to close
	let sw = $state<OfflineState>();
	let announce = $state(""); // temporary message, read by screen readers
	let note = $state(""); // the part of it that is also shown in the toast
	let toastEl = $state<HTMLElement | null>(null);
	let registration: ServiceWorkerRegistration | undefined;
	// an active service worker that does not answer `status` (pre-panel version) has finished installing: it is ready
	let silent = $state(false);
	let quiet: ReturnType<typeof setTimeout>;
	const uid = $props.id();
	const headId = `hl-${uid}`;

	type Phase = "unsupported" | "inactive" | "preparing" | "ready" | "error";
	const phase = $derived<Phase>(
		!supported ? "unsupported"
		: failed || sw?.phase === "error" ? "error"
		: sw?.phase === "ready" || silent ? "ready"
		: registered === false ? "inactive"
		: "preparing",
	);
	const download = $derived(sw?.download);
	const left = $derived(sw ? sw.wiki.files - sw.wiki.cached : 0); // wiki files not yet kept
	const allCached = $derived(!!sw && left === 0);

	const label = $derived(
		offline ? t("offline.offline")
		: phase === "ready" ? t("offline.ready")
		: phase === "preparing" ? t("offline.preparing")
		: phase === "error" ? t("offline.failed")
		: t("offline.unavailable"),
	);
	const icon = $derived<IconName>(offline ? "offline" : phase === "ready" ? "offline-ready" : phase === "preparing" ? "retry" : phase === "error" ? "error" : "offline");

	let timer: ReturnType<typeof setTimeout>;
	function say(message: string, visual = true) {
		announce = message;
		note = visual ? message : "";
		clearTimeout(timer);
		timer = setTimeout(() => (announce = note = ""), MESSAGE_MS);
	}

	const post = (message: { type: "status" | "download-all" | "cancel" }) => {
		const target = registration?.active ?? navigator.serviceWorker.controller;
		target?.postMessage(message);
		if (target && message.type === "status") { clearTimeout(quiet); quiet = setTimeout(() => { if (!sw) silent = true; }, 2000); }
	};

	function onMessage(e: MessageEvent) {
		if (!isOfflineState(e.data)) return;
		clearTimeout(quiet);
		silent = false;
		const wasReady = sw?.phase === "ready", wasFailed = failed || sw?.phase === "error";
		const before = sw?.download?.state;
		const known = !!sw; // transitions only count once a first state is known: a reload does not replay an old download result
		sw = e.data;
		const now = e.data.download?.state;
		if (known && now !== before) {
			if (now === "running") say(t("offline.download"));
			else if (now === "done") say(t("offline.done"));
			else if (now === "cancelled") say(t("offline.cancelled"));
			else if (now === "error") say(e.data.download?.message ? t("offline.interruptedWith", { detail: e.data.download.message }) : t("offline.interrupted"));
		}
		if (e.data.phase === "ready") {
			failed = false;
			// once per site version: the message comes back if it changes, not on every load
			if (!wasReady) {
				try {
					if (localStorage.getItem(KEY) === e.data.version) return;
					localStorage.setItem(KEY, e.data.version);
				} catch { /* storage unavailable: announced on every load */ }
				say(t("offline.ready"), false);
			}
		} else if (e.data.phase === "error" && !wasFailed) say(t("offline.failed"), false);
	}

	function track(worker: ServiceWorker | null | undefined, reg: ServiceWorkerRegistration) {
		worker?.addEventListener("statechange", () => {
			if (worker.state === "redundant" && !reg.active) failed = true; // installation with no way out: no fallback service worker
			if (worker.state === "activated") { failed = false; post({ type: "status" }); }
			waiting = !!reg.waiting;
		});
	}

	async function watch() {
		const reg = await navigator.serviceWorker.getRegistration();
		registered = !!reg;
		if (!reg) return;
		registration = reg;
		track(reg.installing, reg);
		track(reg.waiting, reg);
		reg.addEventListener("updatefound", () => track(reg.installing, reg));
		waiting = !!reg.waiting;
		if (reg.active) post({ type: "status" });
	}

	// the new version has just taken over (skipWaiting + claim): ask it for its state again
	function onController() { waiting = false; post({ type: "status" }); }

	onMount(() => {
		offline = !navigator.onLine;
		if (offline) say(t("offline.offline"), false); // the toast already shows the offline state
		const sync = (e: Event) => { offline = e.type === "offline"; say(offline ? t("offline.offline") : t("offline.backOnline")); };
		addEventListener("online", sync);
		addEventListener("offline", sync);
		supported = "serviceWorker" in navigator;
		let check: ReturnType<typeof setTimeout>;
		if (supported) {
			navigator.serviceWorker.addEventListener("message", onMessage);
			navigator.serviceWorker.addEventListener("controllerchange", onController);
			// SvelteKit registers the service worker on the `load` event: look afterwards, with a short delay
			const start = () => { check = setTimeout(watch, 300); };
			if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
			navigator.serviceWorker.ready.then((reg) => { registration = reg; reg.active?.postMessage({ type: "status" }); });
		}
		return () => {
			removeEventListener("online", sync);
			removeEventListener("offline", sync);
			if (supported) {
				navigator.serviceWorker.removeEventListener("message", onMessage);
				navigator.serviceWorker.removeEventListener("controllerchange", onController);
			}
			clearTimeout(quiet);
			clearTimeout(timer);
			clearTimeout(check);
		};
	});

	function retry() {
		failed = false;
		// a first installation that fails removes the registration: only a reload recreates it (SvelteKit registers it on load)
		if (registration && (registration.installing || registration.waiting || registration.active)) {
			registration.update().catch(() => { failed = true; });
		} else location.reload();
	}

	const refresh = () => post({ type: "status" });
	const attention = $derived(offline || phase === "error");
	const running = $derived(download?.state === "running");

	// The visual toast: the user-triggered note, else the download progress, else the offline notice. It lives in the top layer
	// (`popover="manual"`): the header is a size container, which would otherwise make it the anchor of a fixed element.
	const toastText = $derived(
		note ||
		(running && download ? t("offline.downloading", { percent: t("common.percent", { n: percent(download.done, download.total) }), size: formatBytes(download.bytes) }) : "") ||
		(offline ? t("offline.offline") : ""),
	);
	$effect(() => {
		if (!toastEl) return;
		const shown = toastEl.matches(":popover-open");
		if (toastText && !shown) toastEl.showPopover();
		else if (!toastText && shown) toastEl.hidePopover();
	});

	const cachedLabel = $derived(sw ? t("offline.cachedOf", { cached: sw.wiki.cached, files: sw.wiki.files }) : "");
</script>

{#snippet section()}
	<div role="group" aria-labelledby={headId} class="text-sm">
		<div id={headId} class="text-muted-foreground px-2 py-1.5 text-xs font-semibold">{t("offline.title")}</div>
		<p class="flex items-center gap-2 px-2 pb-1 font-medium {phase === 'error' ? 'text-destructive' : ''}">
			<Icon name={icon} size={16} class={phase === "preparing" && !offline ? "motion-safe:animate-spin" : ""} />
			{label}
		</p>

		{#if phase === "unsupported"}
			<p class="text-muted-foreground px-2 pb-1 text-xs">{t("offline.unsupported")}</p>
		{:else if phase === "inactive"}
			<p class="text-muted-foreground px-2 pb-1 text-xs">{dev ? t("offline.dev") : t("offline.inactive")}</p>
			{#if !dev}<DropdownMenu.Item onSelect={retry}><Icon name="retry" size={16} />{t("common.retry")}</DropdownMenu.Item>{/if}
		{:else if phase === "error"}
			<p class="px-2 pb-1 text-xs">{t("offline.error")}</p>
			{#if sw?.message}<p class="text-muted-foreground px-2 pb-1 text-xs break-words">{t("common.detail", { detail: sw.message })}</p>{/if}
			<DropdownMenu.Item onSelect={retry}><Icon name="retry" size={16} />{t("common.retry")}</DropdownMenu.Item>
		{:else if phase === "preparing"}
			<p class="text-muted-foreground px-2 pb-1 text-xs">{t("offline.preparingBase")}{sw ? ` ${t("common.percent", { n: percent(sw.core.done, sw.core.total) })}` : ""}</p>
			{#if sw}<progress class="accent-primary mx-2 mb-1 h-2 w-[calc(100%-1rem)]" max={Math.max(1, sw.core.total)} value={sw.core.done} aria-label={t("offline.preparing")}></progress>{/if}
		{:else}
			<p class="text-muted-foreground px-2 pb-1 text-xs">{offline ? t("offline.readyText.offline") : t("offline.readyText")}</p>

			{#if sw}
				{#if running && download}
					<p class="px-2 pb-1 text-xs">{t("offline.downloading", { percent: t("common.percent", { n: percent(download.done, download.total) }), size: formatBytes(download.bytes) })}</p>
					<progress class="accent-primary mx-2 mb-1 h-2 w-[calc(100%-1rem)]" max={download.total} value={download.done} aria-label={t("offline.download")}></progress>
					<DropdownMenu.Item onSelect={() => post({ type: "cancel" })}><Icon name="clear" size={16} />{t("common.cancel")}</DropdownMenu.Item>
				{:else if allCached}
					<p class="flex items-center gap-2 px-2 pb-1 text-xs"><Icon name="success" size={16} />{t("offline.allCached", { count: sw.wiki.pages })}</p>
				{:else}
					{#if download?.state === "error"}
						<p class="text-destructive flex items-start gap-2 px-2 pb-1 text-xs"><Icon name="error" size={16} class="mt-0.5" />{download.message ? t("offline.interruptedWith", { detail: download.message }) : t("offline.interrupted")}</p>
					{:else if download?.state === "cancelled"}
						<p class="text-muted-foreground px-2 pb-1 text-xs">{t("offline.cancelled")}</p>
					{:else if download?.state === "done"}
						<p class="px-2 pb-1 text-xs">{t("offline.done")}</p>
					{/if}
					<DropdownMenu.Item disabled={offline} onSelect={() => post({ type: "download-all" })}>
						<Icon name="download" size={16} />{download?.state === "error" ? t("offline.retryDownload") : t("offline.downloadAll")}
					</DropdownMenu.Item>
					<p class="text-muted-foreground px-2 pt-1 text-xs">
						{offline ? t("offline.reconnect") : t("offline.estimate", { size: formatBytes(estimateBytes(left)), cached: cachedLabel })}
					</p>
				{/if}
			{/if}
		{/if}

		<dl class="text-muted-foreground mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 pb-1 text-xs">
			<dt>{t("offline.connection")}</dt><dd>{offline ? t("offline.state.offline") : t("offline.state.online")}</dd>
			{#if sw}<dt>{t("offline.localVersion")}</dt><dd><code>{sw.version}</code></dd>{/if}
			{#if sw && sw.version !== version}<dt>{t("offline.thisPage")}</dt><dd><code>{version}</code></dd>{/if}
		</dl>
		{#if waiting}<p class="text-muted-foreground px-2 pb-1 text-xs">{t("offline.waiting")}</p>{/if}
	</div>
{/snippet}

{@render children?.({ section, refresh, offline, attention })}

<!-- always in the DOM: an `aria-live` region must exist before its text changes. The visual toast repeats it, hidden from assistive technology -->
<div aria-live="polite" class="sr-only">{announce}</div>
<div bind:this={toastEl} popover="manual" aria-hidden="true" class="bg-popover border-input shadow-overlay text-muted-foreground pointer-events-none fixed inset-auto bottom-3 left-3 m-0 w-fit max-w-[calc(100vw-1.5rem)] overflow-visible rounded-none border px-2.5 py-1 text-xs print:hidden">{toastText}</div>
