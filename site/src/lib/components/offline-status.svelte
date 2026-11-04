<script lang="ts">
	import { onMount } from "svelte";
	import { version } from "$app/env";

	// « Hors ligne » tant que le navigateur l'est ; « Disponible hors ligne » quand le service worker est actif,
	// c'est-à-dire que son cache est complet (il ne s'active qu'après l'installation), une fois par version du site.
	const KEY = "brain:offline-ready";
	let offline = $state(false);
	let ready = $state(false);

	onMount(() => {
		offline = !navigator.onLine;
		const sync = (e: Event) => (offline = e.type === "offline");
		addEventListener("online", sync);
		addEventListener("offline", sync);
		let timer: ReturnType<typeof setTimeout>;
		navigator.serviceWorker?.ready.then(() => {
			try {
				if (localStorage.getItem(KEY) === version) return;
				localStorage.setItem(KEY, version);
			} catch { /* stockage indisponible : annoncé à chaque chargement */ }
			ready = true;
			timer = setTimeout(() => (ready = false), 6000);
		});
		return () => { removeEventListener("online", sync); removeEventListener("offline", sync); clearTimeout(timer); };
	});
</script>

<!-- toujours dans le DOM : une région `aria-live` doit exister avant que son texte change -->
<div aria-live="polite" class="pointer-events-none fixed bottom-3 left-3 z-30 print:hidden">
	{#if offline}
		<p class="bg-background text-muted-foreground rounded-md border px-2.5 py-1 text-xs shadow-sm">Hors ligne</p>
	{:else if ready}
		<p class="bg-background text-muted-foreground rounded-md border px-2.5 py-1 text-xs shadow-sm">Disponible hors ligne</p>
	{/if}
</div>
