/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from "$app/env";
import { assets, immutable, prerendered } from "$app/manifest";
import { self } from "$app/service-worker";
import {
	MAX_RUNTIME_ENTRIES, NETWORK_TIMEOUT_MS, cacheKey, cacheNames, isTemporaryFailure, isContentPath,
	obsoleteCaches, offlineFallbackHtml, oldestToEvict, pool, staleImmutable, withTimeout,
	type OfflineState, type ToWorker,
} from "#lib/offline.js";

// Hors ligne (voir DESIGN.md, « Hors ligne »). Deux niveaux :
//  - le socle (ressources `_app/`, pages hors `wiki/`, index de recherche, graphe) est précaché à l'installation ;
//  - les pages du wiki sont gardées au fil des consultations (cache `runtime`, borné), ou toutes d'un coup sur demande
//    explicite (« Télécharger tout le wiki », message `download-all`).
// `version` = empreinte des données ET du frontend (BRAIN_SITE_VERSION) : un changement de l'un ou de l'autre change les caches.

// Les chemins du manifeste sont relatifs au chemin de base : on les résout contre la portée du service worker,
// donc le site marche sous n'importe quel sous-chemin.
const scope = self.registration.scope;
const names = cacheNames(scope, version);
const url = (path: string) => new URL(path, scope).href;

const files = [...new Map([...immutable, ...assets, ...prerendered].map((f) => [url(f.path), f.path] as const))].map(([href, path]) => ({ href, path }));
const IMMUTABLE = new Set(immutable.map((f) => url(f.path)));
const CORE = files.filter((f) => !isContentPath(f.path));
const WIKI = files.filter((f) => isContentPath(f.path));
const WIKI_PAGES = WIKI.filter((f) => !f.path.endsWith("__data.json")).length;

// --- État diffusé aux pages ------------------------------------------------------------------------------------------

let phase: OfflineState["phase"] = "ready"; // un service worker qui répond à `status` est actif : son installation est terminée
let phaseMessage: string | undefined;
let coreDone = 0;
const download: OfflineState["download"] = { state: "idle", done: 0, total: 0, bytes: 0 };
let cancelled = false;

async function broadcast(message: OfflineState) {
	for (const client of await self.clients.matchAll({ includeUncontrolled: true, type: "window" })) client.postMessage(message);
}

async function snapshot(): Promise<OfflineState> {
	const [core, runtime] = await Promise.all([caches.open(names.core), caches.open(names.runtime)]);
	const have = new Set([...(await core.keys()), ...(await runtime.keys())].map((r) => r.url));
	return {
		type: "state", version, phase, message: phaseMessage,
		core: { done: phase === "ready" ? CORE.length : coreDone, total: CORE.length },
		wiki: { pages: WIKI_PAGES, files: WIKI.length, cached: WIKI.filter((f) => have.has(f.href)).length },
		download: { ...download },
	};
}
const report = async () => broadcast(await snapshot());

// Avancement : au plus quatre messages par seconde (un par fichier saturerait le fil principal des pages)
let lastReport = 0;
const report_throttled = (force = false) => {
	if (!force && Date.now() - lastReport < 250) return;
	lastReport = Date.now();
	return report();
};

// --- Installation : le socle seulement ---------------------------------------------------------------------------------

self.addEventListener("install", (event) => {
	event.waitUntil(precache());
});

async function precache() {
	phase = "preparing";
	const cache = await caches.open(names.core);
	const have = new Set((await cache.keys()).map((r) => r.url)); // une installation interrompue reprend où elle s'était arrêtée
	coreDone = CORE.filter((f) => have.has(f.href)).length;
	await report_throttled(true);
	try {
		await pool(CORE.filter((f) => !have.has(f.href)), 6, async (f) => {
			// `reload` : on ne veut pas d'une copie périmée du cache HTTP du navigateur
			const response = await fetch(new Request(f.href, { cache: "reload" }));
			if (!response.ok) throw new Error(`${response.status} ${f.path}`);
			await cache.put(f.href, response);
			coreDone++;
			void report_throttled();
		});
	} catch (error) {
		phase = "error";
		phaseMessage = error instanceof Error ? error.message : String(error);
		await report_throttled(true);
		throw error; // l'installation échoue : l'ancien service worker (s'il y en a un) reste actif
	}
	phase = "ready";
	phaseMessage = undefined;
}

// --- Activation : nettoyage du seul wiki ---------------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// uniquement les anciennes versions de CE wiki (préfixe + portée) : CacheStorage est partagé par origine
		for (const name of obsoleteCaches(await caches.keys(), scope, version)) await caches.delete(name);
		// ressources hachées devenues obsolètes dans le cache courant
		const core = await caches.open(names.core);
		for (const key of staleImmutable((await core.keys()).map((r) => r.url), scope, IMMUTABLE)) await core.delete(key);
		// `claim` : la page qui vient d'installer le service worker en profite sans recharger (sinon « disponible hors ligne » serait faux)
		await self.clients.claim();
		await report();
	})());
});

// --- Requêtes ------------------------------------------------------------------------------------------------------------

async function lookup(key: string): Promise<Response | undefined> {
	return (await (await caches.open(names.core)).match(key)) ?? (await (await caches.open(names.runtime)).match(key));
}

/** Garde une réponse : dans le socle si la clé en fait partie (copie rafraîchie), sinon dans le cache borné des pages consultées. */
async function remember(key: string, response: Response) {
	const core = await caches.open(names.core);
	if (await core.match(key)) return core.put(key, response);
	const runtime = await caches.open(names.runtime);
	await runtime.put(key, response);
	for (const old of oldestToEvict(await runtime.keys(), MAX_RUNTIME_ENTRIES)) await runtime.delete(old);
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET" || !request.url.startsWith(scope)) return;
	event.respondWith(respond(event));
});

async function respond(event: FetchEvent): Promise<Response> {
	const { request } = event;
	const key = cacheKey(request.url);
	// fichiers immuables (nom = empreinte du contenu) : le cache d'abord
	if (IMMUTABLE.has(key)) return (await lookup(key)) ?? fetch(request);

	// pages et données : le réseau d'abord (les mises à jour se voient en ligne), mais borné quand une copie existe
	const cached = await lookup(key);
	const network = fetch(request).then((response) => {
		if (response.status === 200) event.waitUntil(remember(key, response.clone()).catch(() => {}));
		return response;
	});
	if (!cached) {
		try {
			return await network;
		} catch (error) {
			if (request.mode === "navigate") return new Response(offlineFallbackHtml(scope), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
			throw error;
		}
	}
	const response = await withTimeout(network, NETWORK_TIMEOUT_MS);
	if (response && !isTemporaryFailure(response.status)) return response;
	event.waitUntil(network.catch(() => {})); // délai dépassé : la copie est servie, la réponse tardive rafraîchit quand même le cache
	return cached;
}

// --- Messages des pages --------------------------------------------------------------------------------------------------

self.addEventListener("message", (event) => {
	const message = event.data as ToWorker | undefined;
	if (message?.type === "status") event.waitUntil(report());
	else if (message?.type === "download-all") event.waitUntil(downloadAll());
	else if (message?.type === "cancel") cancelled = true;
});

/** Télécharge toutes les pages du wiki absentes du cache (reprend où l'on s'était arrêté). */
async function downloadAll() {
	if (download.state === "running") return;
	Object.assign(download, { state: "running", done: 0, total: 0, bytes: 0, message: undefined });
	cancelled = false;
	const [core, runtime] = await Promise.all([caches.open(names.core), caches.open(names.runtime)]);
	const inCore = new Set((await core.keys()).map((r) => r.url));
	const todo = [];
	for (const f of WIKI) {
		if (inCore.has(f.href)) continue;
		// déjà consultée : la copie quitte le cache borné (qui pourrait l'évincer) pour rejoindre le socle
		const seen = await runtime.match(f.href);
		if (seen) { await core.put(f.href, seen); await runtime.delete(f.href); } else todo.push(f);
	}
	download.total = todo.length;
	await report_throttled(true);
	try {
		await pool(todo, 4, async (f) => {
			if (cancelled) throw new DOMException("annulé", "AbortError");
			const response = await fetch(f.href);
			if (!response.ok) throw new Error(`${response.status} ${f.path}`);
			const blob = await response.blob();
			await core.put(f.href, new Response(blob, { status: response.status, statusText: response.statusText, headers: response.headers }));
			download.done++;
			download.bytes += blob.size;
			void report_throttled();
		});
		download.state = "done";
	} catch (error) {
		const aborted = error instanceof DOMException && error.name === "AbortError";
		download.state = aborted ? "cancelled" : "error";
		download.message = aborted ? undefined : error instanceof Error ? error.message : String(error);
	}
	await report_throttled(true);
}
