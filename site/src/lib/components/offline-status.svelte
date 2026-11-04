<script lang="ts">
	import { onMount, tick } from "svelte";
	import { dev, version } from "$app/env";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { type OfflineState, estimateBytes, formatBytes, isOfflineState, percent } from "#lib/offline.js";
	import type { IconName } from "#lib/icons.js";

	// Statut du mode hors ligne, toujours consultable : un bouton discret (en bas à gauche) ouvre un panneau avec l'état
	// (Préparation, Disponible, Échec + Réessayer), la version conservée, la connexion et le téléchargement complet du wiki.
	// Les changements importants sont aussi annoncés quelques secondes dans la région `aria-live`.
	const KEY = "brain:offline-ready";
	const MESSAGE_MS = 6000;

	let offline = $state(false);
	let supported = $state(true); // service worker disponible (contexte sécurisé, navigateur récent)
	let registered = $state<boolean | undefined>(undefined); // `undefined` : pas encore vérifié (l'enregistrement a lieu au chargement de la page)
	let failed = $state(false); // l'installation s'est terminée en échec
	let waiting = $state(false); // une nouvelle version est installée et attend la fermeture des onglets
	let sw = $state<OfflineState>();
	let open = $state(false);
	let announce = $state(""); // message temporaire, lu par les lecteurs d'écran
	let root = $state<HTMLDivElement>();
	let toggle = $state<HTMLButtonElement | null>(null);
	let registration: ServiceWorkerRegistration | undefined;
	// un service worker actif qui ne répond pas à `status` (version d'avant le panneau) a fini d'installer : il est prêt
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
	const left = $derived(sw ? sw.wiki.files - sw.wiki.cached : 0); // fichiers du wiki pas encore gardés
	const allCached = $derived(!!sw && left === 0);

	const label = $derived(
		offline ? "Hors ligne"
		: phase === "ready" ? "Disponible hors ligne"
		: phase === "preparing" ? "Préparation hors ligne"
		: phase === "error" ? "Échec de la préparation hors ligne"
		: "Mode hors ligne indisponible",
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
			// une fois par version du site : le message revient si elle change, pas à chaque chargement
			if (!wasReady) {
				try {
					if (localStorage.getItem(KEY) === e.data.version) return;
					localStorage.setItem(KEY, e.data.version);
				} catch { /* stockage indisponible : annoncé à chaque chargement */ }
				say("Disponible hors ligne");
			}
		} else if (e.data.phase === "error" && !wasFailed) say("Échec de la préparation hors ligne");
	}

	function track(worker: ServiceWorker | null | undefined, reg: ServiceWorkerRegistration) {
		worker?.addEventListener("statechange", () => {
			if (worker.state === "redundant" && !reg.active) failed = true; // installation sans issue : pas de service worker de repli
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

	// la nouvelle version vient de prendre le relais (skipWaiting + claim) : on lui redemande son état
	function onController() { waiting = false; post({ type: "status" }); }

	onMount(() => {
		offline = !navigator.onLine;
		const sync = (e: Event) => { offline = e.type === "offline"; say(offline ? "Hors ligne" : "De nouveau en ligne"); };
		addEventListener("online", sync);
		addEventListener("offline", sync);
		supported = "serviceWorker" in navigator;
		let check: ReturnType<typeof setTimeout>;
		if (supported) {
			navigator.serviceWorker.addEventListener("message", onMessage);
			navigator.serviceWorker.addEventListener("controllerchange", onController);
			// SvelteKit enregistre le service worker à l'événement `load` : on regarde ensuite, avec un court délai
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
		// une première installation qui échoue supprime l'enregistrement : seul un rechargement le recrée (SvelteKit l'enregistre au chargement)
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

	const cachedLabel = $derived(sw ? `${sw.wiki.cached} sur ${sw.wiki.files}` : "");
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div bind:this={root} class="fixed bottom-3 left-3 z-30 print:hidden">
	{#if open}
		<div id={panelId} role="region" aria-label="Mode hors ligne" class="bg-popover text-popover-foreground absolute bottom-full left-0 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border p-3 text-sm shadow-lg">
			<h2 class="flex items-center gap-2 font-semibold">
				<Icon name={icon} size={16} class={phase === "error" ? "text-destructive" : phase === "preparing" ? "motion-safe:animate-spin" : ""} />
				{label}
			</h2>

			{#if phase === "unsupported"}
				<p class="text-muted-foreground mt-2">Ce navigateur ne permet pas le mode hors ligne (service worker indisponible ou page non sécurisée). Le site reste lisible en ligne.</p>
			{:else if phase === "inactive"}
				<p class="text-muted-foreground mt-2">{dev ? "Le mode hors ligne n'est pas actif en développement." : "Le mode hors ligne n'a pas pu être activé sur cette page."}</p>
				{#if !dev}<Button variant="outline" size="sm" class="mt-3" onclick={retry}><Icon name="retry" size={16} />Réessayer</Button>{/if}
			{:else if phase === "error"}
				<p class="mt-2">Les pages n'ont pas pu être préparées pour la lecture hors ligne. Le site reste lisible en ligne.</p>
				{#if sw?.message}<p class="text-muted-foreground mt-1 text-xs break-words">Détail : {sw.message}</p>{/if}
				<Button variant="outline" size="sm" class="mt-3" onclick={retry}><Icon name="retry" size={16} />Réessayer</Button>
			{:else if phase === "preparing"}
				<p class="text-muted-foreground mt-2">Préparation des pages de base…{sw ? ` ${percent(sw.core.done, sw.core.total)} %` : ""}</p>
				{#if sw}<progress class="accent-primary mt-2 h-2 w-full" max={sw.core.total} value={sw.core.done} aria-label="Préparation hors ligne"></progress>{/if}
			{:else}
				<p class="text-muted-foreground mt-2">Le socle du site et la recherche fonctionnent sans réseau. Les pages que vous consultez sont gardées{offline ? "" : " ; vous pouvez aussi tout télécharger"}.</p>

				{#if sw}
					<div class="mt-3 border-t pt-3">
						{#if download?.state === "running"}
							<p role="status">Téléchargement du wiki : {percent(download.done, download.total)} % ({formatBytes(download.bytes)})</p>
							<progress class="accent-primary mt-2 h-2 w-full" max={download.total} value={download.done} aria-label="Téléchargement du wiki"></progress>
							<Button variant="outline" size="sm" class="mt-2" onclick={() => post({ type: "cancel" })}>Annuler</Button>
						{:else if allCached}
							<p class="flex items-center gap-2" role="status"><Icon name="success" size={16} />Tout le wiki est disponible hors ligne ({sw.wiki.pages} pages).</p>
						{:else}
							{#if download?.state === "error"}
								<p class="text-destructive mb-2 flex items-start gap-2" role="status"><Icon name="error" size={16} class="mt-0.5" />Téléchargement interrompu{download.message ? ` : ${download.message}` : ""}. Les pages déjà reçues sont conservées.</p>
							{:else if download?.state === "cancelled"}
								<p class="text-muted-foreground mb-2" role="status">Téléchargement annulé. Les pages déjà reçues sont conservées.</p>
							{:else if download?.state === "done"}
								<p class="mb-2" role="status">Téléchargement terminé.</p>
							{/if}
							<Button variant="outline" size="sm" disabled={offline} onclick={() => post({ type: "download-all" })}>
								<Icon name="download" size={16} />{download?.state === "error" ? "Réessayer le téléchargement" : "Télécharger tout le wiki"}
							</Button>
							<p class="text-muted-foreground mt-2 text-xs">
								{offline ? "Reconnectez-vous pour télécharger." : `Environ ${formatBytes(estimateBytes(left))} (estimation), ${cachedLabel} fichiers déjà conservés.`}
							</p>
						{/if}
					</div>
				{/if}
			{/if}

			<dl class="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
				<dt>Connexion</dt><dd>{offline ? "hors ligne" : "en ligne"}</dd>
				{#if sw}<dt>Version locale</dt><dd><code>{sw.version}</code></dd>{/if}
				{#if sw && sw.version !== version}<dt>Cette page</dt><dd><code>{version}</code></dd>{/if}
			</dl>
			{#if waiting}<p class="text-muted-foreground mt-2 text-xs">Une nouvelle version est prête : elle prendra le relais quand tous les onglets du site seront fermés.</p>{/if}
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
			aria-label="Mode hors ligne : {label}"
			onclick={toggleOpen}
		>
			<Icon name={icon} size={18} class={phase === "preparing" && !offline ? "motion-safe:animate-spin" : ""} />
		</Button>
		<!-- toujours dans le DOM : une région `aria-live` doit exister avant que son texte change -->
		<div aria-live="polite" class="pointer-events-none">
			{#if offline || announce}
				<p class="bg-background text-muted-foreground rounded-md border px-2.5 py-1 text-xs shadow-sm">{offline && !announce ? "Hors ligne" : announce}</p>
			{/if}
		</div>
	</div>
</div>
