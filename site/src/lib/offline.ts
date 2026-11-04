/**
 * Mode hors ligne : logique pure partagée entre le service worker (`service-worker.ts`) et l'indicateur
 * (`offline-status.svelte`). Aucun accès au navigateur ici : tout est testable avec `bun test`
 * (`cli/src/offline.test.ts`).
 */

/** Durée maximale d'attente du réseau quand une copie locale existe (puis on sert la copie, le réseau continue en tâche de fond). */
export const NETWORK_TIMEOUT_MS = 3000;
/** Nombre maximal d'entrées gardées « à la volée » (pages consultées) : au-delà, les plus anciennes sont retirées. */
export const MAX_RUNTIME_ENTRIES = 120;
/** Taille moyenne d'un fichier du wiki (une page = son HTML + son `__data.json`, environ 40 Ko, mesuré) : sert à estimer le téléchargement complet. */
export const AVG_WIKI_FILE_BYTES = 20 * 1024;

/** Préfixe des caches de ce wiki : l'espace de noms ET la portée, car CacheStorage est partagé par origine (sous-chemins voisins). */
export function cachePrefix(scope: string): string {
	return `brain-wiki:${new URL(scope).pathname}:`;
}

/** `core` : socle, index et pages téléchargées explicitement ; `runtime` : pages consultées (borné). Une version = deux caches. */
export function cacheNames(scope: string, version: string) {
	const prefix = cachePrefix(scope);
	return { prefix, core: `${prefix}${version}`, runtime: `${prefix}${version}:runtime` };
}

/** Anciennes versions du seul wiki de cette portée : jamais le cache d'une autre application du même domaine. */
export function obsoleteCaches(existing: readonly string[], scope: string, version: string): string[] {
	const { prefix, core, runtime } = cacheNames(scope, version);
	return existing.filter((n) => n.startsWith(prefix) && n !== core && n !== runtime);
}

/**
 * Clé de cache d'un document statique : sans paramètres de recherche (`/search/?q=…` est la même page que `/search/`)
 * ni ancre. Les ressources immuables n'en ont pas, la fonction leur est neutre.
 */
export function cacheKey(href: string): string {
	const u = new URL(href);
	u.search = "";
	u.hash = "";
	return u.href;
}

/** Statuts pour lesquels une copie locale vaut mieux que la réponse : pannes temporaires. 404 et 410 sont de vraies absences : jamais masquées. */
export function isTemporaryFailure(status: number): boolean {
	return status >= 500 || status === 408 || status === 429;
}

/**
 * Chemin du manifeste (relatif à la portée, éventuellement avec `/` initial) : contenu à la demande (une page du wiki ou
 * d'un tag, ou sa donnée) plutôt que socle ? Le socle : ressources, accueil, listes (`tags/`, `log/`, `graph/`, `search/`) et index.
 */
export function isContentPath(path: string): boolean {
	const p = path.replace(/^\/+/, "");
	return p.startsWith("wiki/") || (p.startsWith("tags/") && p !== "tags/" && p !== "tags/__data.json");
}

/** Entrées de `_app/immutable/` du cache absentes du manifeste courant : ressources obsolètes à retirer du cache concerné. */
export function staleImmutable(cached: readonly string[], scope: string, known: ReadonlySet<string>): string[] {
	const dir = new URL("_app/immutable/", scope).href;
	return cached.filter((k) => k.startsWith(dir) && !known.has(k));
}

/** Clés à retirer pour ne garder que les `max` plus récentes (`keys` est dans l'ordre d'insertion, le plus ancien d'abord). */
export function oldestToEvict<T>(keys: readonly T[], max: number): T[] {
	return keys.length > max ? keys.slice(0, keys.length - max) : [];
}

/** Attend `p` au plus `ms` millisecondes : `undefined` si le délai est dépassé ou si `p` échoue. Ne rejette jamais. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
	try { return await Promise.race([p.catch(() => undefined), limit]); } finally { clearTimeout(timer); }
}

/** Exécute `fn` sur chaque élément, `n` à la fois. S'arrête (sans lancer de nouvelle tâche) à la première erreur, qu'elle relance. */
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

/** « 1,2 Mo » : unités françaises, une décimale au-delà de 10 Ko seulement quand elle compte. */
export function formatBytes(bytes: number): string {
	const fmt = (n: number, unit: string) => `${(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toString().replace(".", ",")} ${unit}`;
	if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} o`;
	if (bytes < 1024 * 1024) return fmt(bytes / 1024, "Ko");
	if (bytes < 1024 ** 3) return fmt(bytes / 1024 ** 2, "Mo");
	return fmt(bytes / 1024 ** 3, "Go");
}

/** Estimation du téléchargement complet : fichiers restants × taille moyenne. */
export const estimateBytes = (files: number) => files * AVG_WIKI_FILE_BYTES;

// --- Protocole page <-> service worker ---------------------------------------------------------------------------

export type DownloadState = "idle" | "running" | "done" | "cancelled" | "error";

/** Diffusé par le service worker à toutes les pages ouvertes ; recalculé à chaque `status`. */
export type OfflineState = {
	type: "state";
	/** version du service worker qui répond (celle du cache) */
	version: string;
	/** `preparing` : installation du socle ; `ready` : actif (donc socle complet) ; `error` : installation impossible */
	phase: "preparing" | "ready" | "error";
	message?: string;
	core: { done: number; total: number };
	wiki: { pages: number; files: number; cached: number };
	download: { state: DownloadState; done: number; total: number; bytes: number; message?: string };
};

export type ToWorker = { type: "status" } | { type: "download-all" } | { type: "cancel" };

export const isOfflineState = (m: unknown): m is OfflineState => typeof m === "object" && m !== null && (m as { type?: unknown }).type === "state";

/** Avancement en pourcentage entier, borné (0 si le total est inconnu). */
export const percent = (done: number, total: number) => (total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0);

/** Page de repli d'une navigation hors ligne sur une page jamais consultée (HTML minimal : le socle n'est pas garanti). */
export function offlineFallbackHtml(scope: string): string {
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Page indisponible hors ligne · Second cerveau</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6"><h1>Page indisponible hors ligne</h1><p>Cette page n'a pas encore été consultée sur cet appareil et le réseau est inaccessible.</p><p><a href="${esc(scope)}">Retour à l'accueil</a></p></body></html>`;
}
