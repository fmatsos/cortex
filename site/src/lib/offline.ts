/**
 * Offline mode: pure logic shared between the service worker (`service-worker.ts`) and the indicator
 * (`offline-status.svelte`). No browser access here: everything is testable with `bun test`
 * (`src/offline.test.ts`).
 */

import { getLocale, intlLocale, t } from "./i18n/index";

/** Maximum time to wait for the network when a local copy exists (then the copy is served, the network continues in the background). */
export const NETWORK_TIMEOUT_MS = 3000;
/** Maximum number of entries kept "on the fly" (visited pages): beyond it, the oldest are removed. */
export const MAX_RUNTIME_ENTRIES = 120;
/** Average size of a wiki file (a page = its HTML + its `__data.json`, about 40 KB, measured): used to estimate the full download. */
export const AVG_WIKI_FILE_BYTES = 20 * 1024;

/** Prefix of this wiki's caches: the namespace AND the scope, because CacheStorage is shared per origin (neighboring subpaths). */
export function cachePrefix(scope: string): string {
	return `cortex-wiki:${new URL(scope).pathname}:`;
}

/** `core`: base, index and explicitly downloaded pages; `runtime`: visited pages (bounded). One version = two caches. */
export function cacheNames(scope: string, version: string) {
	const prefix = cachePrefix(scope);
	return { prefix, core: `${prefix}${version}`, runtime: `${prefix}${version}:runtime` };
}

/** Old versions of this scope's wiki only: never the cache of another application on the same domain. */
export function obsoleteCaches(existing: readonly string[], scope: string, version: string): string[] {
	const { prefix, core, runtime } = cacheNames(scope, version);
	// before the rename (the project was called "brain"): `brain-wiki:<scope>:…` caches of this scope, and `brain-<12 hex>`
	// from before the prefix, specific enough to be recognized without touching neighboring caches
	const legacy = `brain-wiki:${new URL(scope).pathname}:`;
	return existing.filter((n) => (n.startsWith(prefix) && n !== core && n !== runtime) || n.startsWith(legacy) || /^brain-[0-9a-f]{12}$/.test(n));
}

/**
 * Cache key of a static document: without search parameters (`/search/?q=…` is the same page as `/search/`)
 * nor anchor. Immutable resources have none, the function is neutral to them.
 */
export function cacheKey(href: string): string {
	const u = new URL(href);
	u.search = "";
	u.hash = "";
	return u.href;
}

/** Statuses for which a local copy is better than the response: temporary outages. 404 and 410 are real absences: never masked. */
/**
 * The server's API (`/api/…`: accounts, assistant, review) under this scope: never cached nor answered by the service worker, or a
 * signed-out visitor would still read the previous user's `/api/me`, and the sign-in redirections would meet the offline page.
 */
export function isApiPath(href: string, scope: string): boolean {
	const base = new URL(scope).pathname.replace(/\/?$/, "/");
	return new URL(href).pathname.startsWith(`${base}api/`);
}

export function isTemporaryFailure(status: number): boolean {
	return status >= 500 || status === 408 || status === 429;
}

/**
 * Manifest path (relative to the scope, possibly with a leading `/`): on-demand content (a wiki page or
 * its data) rather than base? (Tags have no page of their own: they lead to the search.) The base: resources, home, lists (`tags/`, `log/`, `graph/`, `search/`) and index.
 */
export function isContentPath(path: string): boolean {
	const p = path.replace(/^\/+/, "");
	return p.startsWith("wiki/");
}

// --- Manifest of the files (incremental update) ----------------------------------------------------------------------------

/**
 * Written by `cortex export` into `service-worker.js` once the site is built: for every file that is not under `_app/immutable/`
 * (those are named by their content), a short fingerprint of its content, by manifest path (`wiki/a/`, `graph.json`, `` for the
 * home page). `id` fingerprints the whole (it names the caches). The version of a service worker that has none (development, an
 * older export) is the site's one, and its update downloads everything again.
 */
export type Manifest = { id: string; files: Record<string, string> };

/** Placeholder of the source of the service worker, replaced by the manifest after the build (`export.ts`). */
export const MANIFEST_PLACEHOLDER = "@@CORTEX_MANIFEST@@";

/** The manifest a service worker carries, `undefined` if it has none (the placeholder was not replaced) or if it is damaged. */
export function parseManifest(raw: string): Manifest | undefined {
	try {
		const m = JSON.parse(raw) as Partial<Manifest> | null;
		return m && typeof m.id === "string" && m.files && typeof m.files === "object" ? (m as Manifest) : undefined;
	} catch { return undefined; }
}

/** Manifest path of a file of the export: `a/index.html` is the page `a/`, `index.html` the home page `` (the URLs the service worker caches). */
export function manifestPath(file: string): string {
	const f = file.replace(/\\/g, "/").replace(/^\/+/, "");
	return f === "index.html" ? "" : f.endsWith("/index.html") ? f.slice(0, -"index.html".length) : f;
}

/** Comparison of two manifests, each list sorted: what an update has to download (`added`, `changed`) and what it can keep (`same`). */
export function diffManifests(previous: Readonly<Record<string, string>> | undefined, next: Readonly<Record<string, string>>) {
	const prev = previous ?? {};
	const added: string[] = [], changed: string[] = [], same: string[] = [];
	for (const path of Object.keys(next).sort()) {
		if (!(path in prev)) added.push(path);
		else if (prev[path] === next[path]) same.push(path);
		else changed.push(path);
	}
	const removed = Object.keys(prev).filter((path) => !(path in next)).sort();
	return { added, changed, removed, same };
}

/** Key, in the base cache, under which a version keeps its manifest for the next one. Never a URL that anyone asks for. */
export const manifestKey = (scope: string) => new URL("_app/cortex-manifest.json", scope).href;

/** `_app/immutable/` entries of the cache absent from the current manifest: obsolete resources to remove from the relevant cache. */
export function staleImmutable(cached: readonly string[], scope: string, known: ReadonlySet<string>): string[] {
	const dir = new URL("_app/immutable/", scope).href;
	return cached.filter((k) => k.startsWith(dir) && !known.has(k));
}

/** Keys to remove to keep only the `max` most recent (`keys` is in insertion order, oldest first). */
export function oldestToEvict<T>(keys: readonly T[], max: number): T[] {
	return keys.length > max ? keys.slice(0, keys.length - max) : [];
}

/** Waits for `p` at most `ms` milliseconds: `undefined` if the delay is exceeded or if `p` fails. Never rejects. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
	try { return await Promise.race([p.catch(() => undefined), limit]); } finally { clearTimeout(timer); }
}

/** Runs `fn` on each element, `n` at a time. Stops (without starting a new task) at the first error, which it rethrows. */
export async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0, failure: { error: unknown } | undefined;
	const worker = async () => {
		while (!failure && next < items.length) {
			const item = items[next++]!;
			try { await fn(item); } catch (error) { failure ??= { error }; }
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
	if (failure) throw failure.error;
}

/** "1.2 MB" (en) or "1,2 Mo" (fr): units and decimal separator of the site language, one decimal below 10 only. */
export function formatBytes(bytes: number): string {
	const fmt = (n: number, unit: string) => `${(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString(intlLocale())} ${unit}`;
	if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} ${t("bytes.b")}`;
	if (bytes < 1024 * 1024) return fmt(bytes / 1024, t("bytes.kb"));
	if (bytes < 1024 ** 3) return fmt(bytes / 1024 ** 2, t("bytes.mb"));
	return fmt(bytes / 1024 ** 3, t("bytes.gb"));
}

/** Estimate of the full download: remaining files × average size. */
export const estimateBytes = (files: number) => files * AVG_WIKI_FILE_BYTES;

// --- Protocole page <-> service worker ---------------------------------------------------------------------------

export type DownloadState = "idle" | "running" | "done" | "cancelled" | "error";

/** Broadcast by the service worker to all open pages; recomputed on each `status`. */
export type OfflineState = {
	type: "state";
	/** version of the service worker that answers (the cache's) */
	version: string;
	/** `preparing`: base installation; `ready`: active (hence complete base); `error`: installation impossible */
	phase: "preparing" | "ready" | "error";
	message?: string;
	/** base: files to download for this version (`total`) and downloaded (`done`); `reused` = kept from the previous version, not downloaded */
	core: { done: number; total: number; reused: number };
	wiki: { pages: number; files: number; cached: number };
	download: { state: DownloadState; done: number; total: number; bytes: number; message?: string };
};

export type ToWorker = { type: "status" } | { type: "download-all" } | { type: "cancel" };

export const isOfflineState = (m: unknown): m is OfflineState => typeof m === "object" && m !== null && (m as { type?: unknown }).type === "state";

/** Progress as a whole percentage, bounded (0 if the total is unknown). */
export const percent = (done: number, total: number) => (total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0);

/** Fallback page of an offline navigation to a never-visited page (minimal HTML: the base is not guaranteed). */
export function offlineFallbackHtml(scope: string): string {
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	return `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(t("offline.fallback.title"))} · Cortex</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6"><h1>${esc(t("offline.fallback.title"))}</h1><p>${esc(t("offline.fallback.body"))}</p><p><a href="${esc(scope)}">${esc(t("offline.fallback.home"))}</a></p></body></html>`;
}
