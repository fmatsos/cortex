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

// Offline (see docs/DESIGN.md, "Hors ligne"). Two levels:
//  - the base (`_app/` resources, pages outside `wiki/`, search index, graph) is precached at installation;
//  - wiki pages are kept as they are visited (`runtime` cache, bounded), or all at once on explicit
//    request ("Télécharger tout le wiki", `download-all` message).
// `version` = fingerprint of the data AND of the frontend (CORTEX_SITE_VERSION): a change in either changes the caches.

// Manifest paths are relative to the base path: they are resolved against the service worker's scope,
// so the site works under any subpath.
const scope = self.registration.scope;
const names = cacheNames(scope, version);
const url = (path: string) => new URL(path, scope).href;

const files = [...new Map([...immutable, ...assets, ...prerendered].map((f) => [url(f.path), f.path] as const))].map(([href, path]) => ({ href, path }));
const IMMUTABLE = new Set(immutable.map((f) => url(f.path)));
const CORE = files.filter((f) => !isContentPath(f.path));
const WIKI = files.filter((f) => isContentPath(f.path));
const WIKI_PAGES = WIKI.filter((f) => !f.path.endsWith("__data.json")).length;

// --- State broadcast to pages ----------------------------------------------------------------------------------------

let phase: OfflineState["phase"] = "ready"; // a service worker that answers `status` is active: its installation is finished
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

// Progress: at most four messages per second (one per file would saturate the pages' main thread)
let lastReport = 0;
const report_throttled = (force = false) => {
	if (!force && Date.now() - lastReport < 250) return;
	lastReport = Date.now();
	return report();
};

// --- Installation: the base only ---------------------------------------------------------------------------------------

self.addEventListener("install", (event) => {
	event.waitUntil(precache());
});

async function precache() {
	phase = "preparing";
	const cache = await caches.open(names.core);
	const have = new Set((await cache.keys()).map((r) => r.url)); // an interrupted installation resumes where it stopped
	coreDone = CORE.filter((f) => have.has(f.href)).length;
	await report_throttled(true);
	try {
		await pool(CORE.filter((f) => !have.has(f.href)), 6, async (f) => {
			// `reload`: we do not want a stale copy from the browser's HTTP cache
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
		throw error; // the installation fails: the old service worker (if any) stays active
	}
	phase = "ready";
	phaseMessage = undefined;
	// read-only site: the new version takes over without waiting for the tabs to close
	// (otherwise an old service worker, which does not know the `status` message, leaves the indicator on "Préparation")
	await self.skipWaiting();
}

// --- Activation: cleaning up this wiki only ------------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// only the old versions of THIS wiki (prefix + scope): CacheStorage is shared per origin
		for (const name of obsoleteCaches(await caches.keys(), scope, version)) await caches.delete(name);
		// hashed resources that became obsolete in the current cache
		const core = await caches.open(names.core);
		for (const key of staleImmutable((await core.keys()).map((r) => r.url), scope, IMMUTABLE)) await core.delete(key);
		// `claim`: the page that just installed the service worker benefits from it without reloading (otherwise "disponible hors ligne" would be false)
		await self.clients.claim();
		await report();
	})());
});

// --- Requests ------------------------------------------------------------------------------------------------------------

async function lookup(key: string): Promise<Response | undefined> {
	return (await (await caches.open(names.core)).match(key)) ?? (await (await caches.open(names.runtime)).match(key));
}

/** Keeps a response: in the base if the key is part of it (refreshed copy), otherwise in the bounded cache of visited pages. */
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
	// immutable files (name = content fingerprint): cache first
	if (IMMUTABLE.has(key)) return (await lookup(key)) ?? fetch(request);

	// pages and data: network first (updates are seen online), but bounded when a copy exists
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
	event.waitUntil(network.catch(() => {})); // delay exceeded: the copy is served, the late response still refreshes the cache
	return cached;
}

// --- Messages from pages -------------------------------------------------------------------------------------------------

self.addEventListener("message", (event) => {
	const message = event.data as ToWorker | undefined;
	if (message?.type === "status") event.waitUntil(report());
	else if (message?.type === "download-all") event.waitUntil(downloadAll());
	else if (message?.type === "cancel") cancelled = true;
});

/** Downloads all the wiki pages absent from the cache (resumes where it stopped). */
async function downloadAll() {
	if (download.state === "running") return;
	Object.assign(download, { state: "running", done: 0, total: 0, bytes: 0, message: undefined });
	cancelled = false;
	const [core, runtime] = await Promise.all([caches.open(names.core), caches.open(names.runtime)]);
	const inCore = new Set((await core.keys()).map((r) => r.url));
	const todo = [];
	for (const f of WIKI) {
		if (inCore.has(f.href)) continue;
		// already visited: the copy leaves the bounded cache (which could evict it) to join the base
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
