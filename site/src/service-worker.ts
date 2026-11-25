/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from "$app/env";
import { assets, immutable, prerendered } from "$app/manifest";
import { self } from "$app/service-worker";
import {
	MANIFEST_PLACEHOLDER, MAX_RUNTIME_ENTRIES, NETWORK_TIMEOUT_MS, cacheKey, cacheNames, diffManifests, isApiPath, isTemporaryFailure, isContentPath,
	manifestKey, obsoleteCaches, offlineFallbackHtml, oldestToEvict, parseManifest, pool, staleImmutable, withTimeout,
	type OfflineState, type ToWorker,
} from "#lib/offline.js";

// Offline (see docs/DESIGN.md, "Hors ligne"). Two levels:
//  - the base (`_app/` resources, pages outside `wiki/`, search index, graph) is precached at installation;
//  - wiki pages are kept as they are visited (`runtime` cache, bounded), or all at once on explicit
//    request ("Download the whole wiki", `download-all` message).
//
// Incremental update. `cortex export` writes into this file, once the site is built, a manifest: a content fingerprint of
// every file that is not under `_app/immutable/` (those are named by their content). A new version keeps the manifest of its
// predecessor in its base cache: at installation it copies from the previous caches what has not changed (same fingerprint,
// or an immutable file, same URL) and downloads only the rest, so that one changed page costs one page and not the whole
// site. Without a manifest (development, older export) everything is downloaded again, as before.
// `version` (frontend fingerprint) names the caches of a service worker without a manifest; with one, the manifest's `id`
// does: a change to any file changes the caches.

// Manifest paths are relative to the base path: they are resolved against the service worker's scope,
// so the site works under any subpath.
const scope = self.registration.scope;
const MANIFEST = parseManifest(MANIFEST_PLACEHOLDER); // `export.ts` replaces the placeholder in the built file
const names = cacheNames(scope, MANIFEST?.id ?? version);
const MANIFEST_KEY = manifestKey(scope);
const url = (path: string) => new URL(path, scope).href;
const rel = (path: string) => path.replace(/^\/+/, "");

const files = [...new Map([...immutable, ...assets, ...prerendered].map((f) => [url(f.path), f.path] as const))].map(([href, path]) => ({ href, path }));
const IMMUTABLE = new Set(immutable.map((f) => url(f.path)));
// Cascadia Code (~219 KB, real code only) is not part of the base: a page that uses it asks for it, and it is kept then
const LAZY = /cascadia-code/;
const CORE = files.filter((f) => !isContentPath(f.path) && !LAZY.test(f.path));
const CORE_HREFS = new Set(CORE.map((f) => f.href));
const WIKI = files.filter((f) => isContentPath(f.path));
const WIKI_PAGES = WIKI.filter((f) => !f.path.endsWith("__data.json")).length;

// --- State broadcast to pages ----------------------------------------------------------------------------------------

let phase: OfflineState["phase"] = "ready"; // a service worker that answers `status` is active: its installation is finished
let phaseMessage: string | undefined;
let coreDone = 0;
let coreTotal = 0; // files this installation downloads (not the ones it keeps from the previous version)
let coreReused = 0;
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
		core: phase === "ready" ? { done: CORE.length, total: CORE.length, reused: coreReused } : { done: coreDone, total: coreTotal, reused: coreReused },
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

// --- Installation: the base, and what the previous version had kept -----------------------------------------------------

self.addEventListener("install", (event) => {
	event.waitUntil(precache());
});

/** A previous version of this wiki's caches (still there: they are only removed at activation) and what it can give to this one. */
type Previous = { core: Cache; runtime?: Cache; coreKeys: Set<string>; runtimeKeys: Set<string>; unchanged: ReadonlySet<string>; wholeWiki: boolean };

/** The previous versions, newest first. A cache that has no manifest (older version) only gives its immutable files. */
async function previousVersions(): Promise<Previous[]> {
	const all = await caches.keys();
	const previous: Previous[] = [];
	for (const name of all.filter((n) => n.startsWith(names.prefix) && !n.endsWith(":runtime") && n !== names.core).reverse()) {
		const core = await caches.open(name);
		const runtime = all.includes(`${name}:runtime`) ? await caches.open(`${name}:runtime`) : undefined;
		const stored: Record<string, string> | undefined = await core.match(MANIFEST_KEY).then((r) => r?.json(), () => undefined).catch(() => undefined);
		const coreKeys = new Set((await core.keys()).map((r) => r.url));
		const wiki = Object.keys(stored ?? {}).filter(isContentPath);
		previous.push({
			core, runtime, coreKeys, runtimeKeys: new Set((await runtime?.keys() ?? []).map((r) => r.url)),
			unchanged: new Set(MANIFEST && stored ? diffManifests(stored, MANIFEST.files).same : []),
			// "Download the whole wiki" was done: its new pages follow
			wholeWiki: wiki.length > 0 && wiki.every((p) => coreKeys.has(url(p))),
		});
	}
	return previous;
}

type Job = { f: (typeof files)[number]; tier: "core" | "runtime"; needed: boolean };

async function precache() {
	phase = "preparing";
	coreDone = coreTotal = coreReused = 0;
	const [cache, runtime] = await Promise.all([caches.open(names.core), caches.open(names.runtime)]);
	// an interrupted installation resumes where it stopped (what is there belongs to this very manifest)
	const have = new Set([...(await cache.keys()), ...(await runtime.keys())].map((r) => r.url));
	await report_throttled(true);
	try {
		if (MANIFEST) await cache.put(MANIFEST_KEY, new Response(JSON.stringify(MANIFEST.files), { headers: { "content-type": "application/json" } }));
		const previous = await previousVersions();
		const wholeWiki = previous.some((p) => p.wholeWiki);
		// per file: kept from a previous version (same content), or downloaded
		const copies: { job: Job; from: Cache }[] = [];
		const jobs: Job[] = [];
		for (const f of files) {
			if (have.has(f.href)) continue;
			const holders = previous.filter((p) => p.coreKeys.has(f.href) || p.runtimeKeys.has(f.href));
			// the base is always kept; the rest (pages, Cascadia) where the previous version had it, and all of the wiki if it had all of it
			const tier = CORE_HREFS.has(f.href) || holders.some((p) => p.coreKeys.has(f.href)) || (wholeWiki && isContentPath(f.path)) ? "core" : holders.length ? "runtime" : undefined;
			if (!tier) continue;
			const job: Job = { f, tier, needed: CORE_HREFS.has(f.href) };
			const same = holders.find((p) => IMMUTABLE.has(f.href) || p.unchanged.has(rel(f.path)));
			if (same) copies.push({ job, from: same.coreKeys.has(f.href) ? same.core : same.runtime! });
			else jobs.push(job);
		}
		await pool(copies, 8, async ({ job, from }) => {
			try {
				const kept = await from.match(job.f.href);
				if (!kept) throw new Error("gone");
				await (job.tier === "core" ? cache : runtime).put(job.f.href, kept);
				coreReused++;
			} catch { jobs.push(job); } // evicted in the meantime: downloaded after all
		});
		coreTotal = jobs.length;
		coreDone = 0;
		await report_throttled(true);
		await pool(jobs, 6, async ({ f, tier, needed }) => {
			try {
				// `reload`: we do not want a stale copy from the browser's HTTP cache
				const response = await fetch(new Request(f.href, { cache: "reload" }));
				if (!response.ok) throw new Error(`${response.status} ${f.path}`);
				await (tier === "core" ? cache : runtime).put(f.href, response);
			} catch (error) {
				if (needed) throw error;
				// a page that an earlier version had kept: refreshed when it is visited again, not worth a failed installation
			}
			coreDone++;
			void report_throttled();
		});
		for (const old of oldestToEvict(await runtime.keys(), MAX_RUNTIME_ENTRIES)) await runtime.delete(old);
	} catch (error) {
		phase = "error";
		phaseMessage = error instanceof Error ? error.message : String(error);
		await report_throttled(true);
		throw error; // the installation fails: the old service worker (if any) stays active
	}
	phase = "ready";
	phaseMessage = undefined;
	// read-only site: the new version takes over without waiting for the tabs to close
	// (otherwise an old service worker, which does not know the `status` message, leaves the indicator on "preparing")
	await self.skipWaiting();
}

// --- Activation: cleaning up this wiki only ------------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// only the old versions of THIS wiki (prefix + scope): CacheStorage is shared per origin
		for (const name of obsoleteCaches(await caches.keys(), scope, MANIFEST?.id ?? version)) await caches.delete(name);
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
	if (request.method !== "GET" || !request.url.startsWith(scope) || isApiPath(request.url, scope)) return; // the API goes straight to the network
	event.respondWith(respond(event));
});

async function respond(event: FetchEvent): Promise<Response> {
	const { request } = event;
	const key = cacheKey(request.url);
	// immutable files (name = content fingerprint): cache first
	// (one that is not in the base, see LAZY, is kept in it as soon as a page has asked for it)
	if (IMMUTABLE.has(key)) {
		return (await lookup(key)) ?? fetch(request).then((response) => {
			if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(names.core).then((core) => core.put(key, copy)).catch(() => {})); }
			return response;
		});
	}

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
			if (cancelled) throw new DOMException("cancelled", "AbortError");
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
