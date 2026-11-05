<script lang="ts">
	import { onMount, tick } from "svelte";
	import { dev, version } from "$app/env";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { type OfflineState, estimateBytes, formatBytes, isOfflineState, percent } from "#lib/offline.js";
	import type { IconName } from "#lib/icons.js";
	import { storageKey } from "#lib/storage.js";
	import { t } from "#lib/i18n/index.js";

	// Offline mode status, always accessible: a discreet button (bottom left) opens a panel with the state
	// (preparing, available, failed + retry), the kept version, the connection and the full download of the wiki.
	// Important changes are also announced for a few seconds in the `aria-live` region.
	const KEY = storageKey("offline-ready");
	const MESSAGE_MS = 6000;

	let offline = $state(false);
	let supported = $state(true); // service worker available (secure context, recent browser)
	let registered = $state<boolean | undefined>(undefined); // `undefined`: not checked yet (registration happens on page load)
	let failed = $state(false); // the installation ended in failure
	let waiting = $state(false); // a new version is installed and waits for the tabs to close
	let sw = $state<OfflineState>();
	let open = $state(false);
	let announce = $state(""); // temporary message, read by screen readers
	let root = $state<HTMLDivElement>();
	let toggle = $state<HTMLButtonElement | null>(null);
	let registration: ServiceWorkerRegistration | undefined;
	// an active service worker that does not answer `status` (pre-panel version) has finished installing: it is ready
	let silent = $state(false);
	let quiet: ReturnType<typeof setTimeout>;
	const uid = $props.id();
	const panelId = `hl-${uid}`;

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
	function say(message: string) {
		announce = message;
		clearTimeout(timer);
		timer = setTimeout(() => (announce = ""), MESSAGE_MS);
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
		sw = e.data;
		if (e.data.phase === "ready") {
			failed = false;
			// once per site version: the message comes back if it changes, not on every load
			if (!wasReady) {
				try {
					if (localStorage.getItem(KEY) === e.data.version) return;
					localStorage.setItem(KEY, e.data.version);
				} catch { /* storage unavailable: announced on every load */ }
				say(t("offline.ready"));
			}
		} else if (e.data.phase === "error" && !wasFailed) say(t("offline.failed"));
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

	function toggleOpen() {
		open = !open;
		if (open) post({ type: "status" });
	}
	async function close(refocus: boolean) {
		open = false;
		if (refocus) { await tick(); toggle?.focus(); }
	}
	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) close(false);
	}
	function onWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === "Escape") { e.preventDefault(); close(true); }
	}

	const cachedLabel = $derived(sw ? t("offline.cachedOf", { cached: sw.wiki.cached, files: sw.wiki.files }) : "");
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div bind:this={root} class="fixed bottom-3 left-3 z-30 print:hidden">
	{#if open}
		<div id={panelId} role="region" aria-label={t("offline.title")} class="bg-popover text-popover-foreground absolute bottom-full left-0 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border p-3 text-sm shadow-lg">
			<h2 class="flex items-center gap-2 font-semibold">
				<Icon name={icon} size={16} class={phase === "error" ? "text-destructive" : phase === "preparing" ? "motion-safe:animate-spin" : ""} />
				{label}
			</h2>

			{#if phase === "unsupported"}
				<p class="text-muted-foreground mt-2">{t("offline.unsupported")}</p>
			{:else if phase === "inactive"}
				<p class="text-muted-foreground mt-2">{dev ? t("offline.dev") : t("offline.inactive")}</p>
				{#if !dev}<Button variant="outline" size="sm" class="mt-3" onclick={retry}><Icon name="retry" size={16} />{t("common.retry")}</Button>{/if}
			{:else if phase === "error"}
				<p class="mt-2">{t("offline.error")}</p>
				{#if sw?.message}<p class="text-muted-foreground mt-1 text-xs break-words">{t("common.detail", { detail: sw.message })}</p>{/if}
				<Button variant="outline" size="sm" class="mt-3" onclick={retry}><Icon name="retry" size={16} />{t("common.retry")}</Button>
			{:else if phase === "preparing"}
				<p class="text-muted-foreground mt-2">{t("offline.preparingBase")}{sw ? ` ${t("common.percent", { n: percent(sw.core.done, sw.core.total) })}` : ""}</p>
				{#if sw}<progress class="accent-primary mt-2 h-2 w-full" max={sw.core.total} value={sw.core.done} aria-label={t("offline.preparing")}></progress>{/if}
			{:else}
				<p class="text-muted-foreground mt-2">{offline ? t("offline.readyText.offline") : t("offline.readyText")}</p>

				{#if sw}
					<div class="mt-3 border-t pt-3">
						{#if download?.state === "running"}
							<p role="status">{t("offline.downloading", { percent: t("common.percent", { n: percent(download.done, download.total) }), size: formatBytes(download.bytes) })}</p>
							<progress class="accent-primary mt-2 h-2 w-full" max={download.total} value={download.done} aria-label={t("offline.download")}></progress>
							<Button variant="outline" size="sm" class="mt-2" onclick={() => post({ type: "cancel" })}>{t("common.cancel")}</Button>
						{:else if allCached}
							<p class="flex items-center gap-2" role="status"><Icon name="success" size={16} />{t("offline.allCached", { count: sw.wiki.pages })}</p>
						{:else}
							{#if download?.state === "error"}
								<p class="text-destructive mb-2 flex items-start gap-2" role="status"><Icon name="error" size={16} class="mt-0.5" />{download.message ? t("offline.interruptedWith", { detail: download.message }) : t("offline.interrupted")}</p>
							{:else if download?.state === "cancelled"}
								<p class="text-muted-foreground mb-2" role="status">{t("offline.cancelled")}</p>
							{:else if download?.state === "done"}
								<p class="mb-2" role="status">{t("offline.done")}</p>
							{/if}
							<Button variant="outline" size="sm" disabled={offline} onclick={() => post({ type: "download-all" })}>
								<Icon name="download" size={16} />{download?.state === "error" ? t("offline.retryDownload") : t("offline.downloadAll")}
							</Button>
							<p class="text-muted-foreground mt-2 text-xs">
								{offline ? t("offline.reconnect") : t("offline.estimate", { size: formatBytes(estimateBytes(left)), cached: cachedLabel })}
							</p>
						{/if}
					</div>
				{/if}
			{/if}

			<dl class="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
				<dt>{t("offline.connection")}</dt><dd>{offline ? t("offline.state.offline") : t("offline.state.online")}</dd>
				{#if sw}<dt>{t("offline.localVersion")}</dt><dd><code>{sw.version}</code></dd>{/if}
				{#if sw && sw.version !== version}<dt>{t("offline.thisPage")}</dt><dd><code>{version}</code></dd>{/if}
			</dl>
			{#if waiting}<p class="text-muted-foreground mt-2 text-xs">{t("offline.waiting")}</p>{/if}
		</div>
	{/if}

	<div class="flex items-center gap-2">
		<Button
			bind:ref={toggle}
			variant="outline"
			size="icon"
			class="bg-background {phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}"
			aria-expanded={open}
			aria-controls={open ? panelId : undefined}
			aria-label={t("offline.buttonLabel", { label })}
			onclick={toggleOpen}
		>
			<Icon name={icon} size={18} class={phase === "preparing" && !offline ? "motion-safe:animate-spin" : ""} />
		</Button>
		<!-- always in the DOM: an `aria-live` region must exist before its text changes -->
		<div aria-live="polite" class="pointer-events-none">
			{#if offline || announce}
				<p class="bg-background text-muted-foreground rounded-md border px-2.5 py-1 text-xs shadow-sm">{offline && !announce ? t("offline.offline") : announce}</p>
			{/if}
		</div>
	</div>
</div>
