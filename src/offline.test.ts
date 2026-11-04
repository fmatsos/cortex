import { expect, test } from "bun:test";
import {
	cacheKey, cacheNames, cachePrefix, estimateBytes, formatBytes, isTemporaryFailure, isContentPath, obsoleteCaches,
	offlineFallbackHtml, oldestToEvict, percent, pool, staleImmutable, withTimeout, AVG_WIKI_FILE_BYTES,
} from "../site/src/lib/offline";

const ROOT = "https://wiki.example/";
const SUB = "https://example.org/brain/sous/";

test("le préfixe des caches porte l'espace de noms et la portée", () => {
	expect(cachePrefix(ROOT)).toBe("brain-wiki:/:");
	expect(cachePrefix(SUB)).toBe("brain-wiki:/brain/sous/:");
	expect(cacheNames(SUB, "abc")).toEqual({ prefix: "brain-wiki:/brain/sous/:", core: "brain-wiki:/brain/sous/:abc", runtime: "brain-wiki:/brain/sous/:abc:runtime" });
});

test("seules les anciennes versions du wiki de cette portée sont supprimées", () => {
	const existing = [
		"brain-wiki:/:v1", "brain-wiki:/:v1:runtime", "brain-wiki:/:v2", "brain-wiki:/:v2:runtime",
		"brain-wiki:/autre/:v1", // même wiki sous un autre sous-chemin
		"autre-app-v1", "workbox-precache-v2", "brain-abcdef012345", "brain-notes", // applications voisines, ancien nommage du wiki
	];
	expect(obsoleteCaches(existing, ROOT, "v2")).toEqual(["brain-wiki:/:v1", "brain-wiki:/:v1:runtime", "brain-abcdef012345"]);
	// la portée racine n'est pas le préfixe d'un sous-chemin
	expect(obsoleteCaches(["brain-wiki:/brain/:v1"], ROOT, "v1")).toEqual([]);
});

test("la clé de cache ignore les paramètres de recherche et l'ancre", () => {
	expect(cacheKey("https://wiki.example/search/?q=contexte&x=1#haut")).toBe("https://wiki.example/search/");
	expect(cacheKey("https://wiki.example/wiki/concepts/a/__data.json?x-sveltekit-invalidated=01")).toBe("https://wiki.example/wiki/concepts/a/__data.json");
	expect(cacheKey("https://wiki.example/")).toBe("https://wiki.example/");
});

test("une copie locale remplace les pannes temporaires, jamais une vraie absence", () => {
	for (const s of [500, 502, 503, 504, 408, 429]) expect(isTemporaryFailure(s)).toBe(true);
	for (const s of [200, 301, 304, 400, 401, 403, 404, 410]) expect(isTemporaryFailure(s)).toBe(false);
});

test("pages du wiki et socle", () => {
	expect(isContentPath("wiki/concepts/a/")).toBe(true);
	expect(isContentPath("/wiki/concepts/a/__data.json")).toBe(true);
	expect(isContentPath("tags/ia/")).toBe(true);
	expect(isContentPath("tags/ia/__data.json")).toBe(true);
	for (const p of ["", "tags/", "tags/__data.json", "log/", "search/", "search-index.json", "graph.json", "_app/immutable/x.js", "wikis/x/"]) expect(isContentPath(p)).toBe(false);
});

test("les ressources hachées absentes du manifeste sont obsolètes", () => {
	const known = new Set([`${ROOT}_app/immutable/a.js`]);
	expect(staleImmutable([`${ROOT}_app/immutable/a.js`, `${ROOT}_app/immutable/old.css`, `${ROOT}tags/`, `${ROOT}_app/version.json`], ROOT, known)).toEqual([`${ROOT}_app/immutable/old.css`]);
});

test("les caches d'exécution sont bornés : les plus anciennes entrées partent", () => {
	expect(oldestToEvict(["a", "b", "c", "d"], 3)).toEqual(["a"]);
	expect(oldestToEvict(["a", "b", "c", "d"], 1)).toEqual(["a", "b", "c"]);
	expect(oldestToEvict(["a", "b"], 3)).toEqual([]);
});

test("withTimeout : résultat, délai dépassé et échec ne rejettent jamais", async () => {
	expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
	expect(await withTimeout(new Promise<number>((r) => setTimeout(() => r(1), 80)), 10)).toBeUndefined();
	expect(await withTimeout(Promise.reject(new Error("réseau")), 50)).toBeUndefined();
});

test("pool : concurrence bornée, tout est traité, première erreur relancée sans nouvelle tâche", async () => {
	let running = 0, peak = 0;
	const seen: number[] = [];
	await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
		peak = Math.max(peak, ++running);
		await new Promise((r) => setTimeout(r, 5));
		seen.push(n);
		running--;
	});
	expect(peak).toBe(3);
	expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

	const started: number[] = [];
	await expect(pool([1, 2, 3, 4, 5, 6], 1, async (n) => { started.push(n); if (n === 2) throw new Error("boum"); })).rejects.toThrow("boum");
	expect(started).toEqual([1, 2]);
	await pool([], 4, async () => { throw new Error("jamais"); });
});

test("tailles lisibles en français", () => {
	expect(formatBytes(0)).toBe("0 o");
	expect(formatBytes(900)).toBe("900 o");
	expect(formatBytes(1536)).toBe("1,5 Ko");
	expect(formatBytes(40 * 1024)).toBe("40 Ko");
	expect(formatBytes(3.04 * 1024 * 1024)).toBe("3 Mo");
	expect(formatBytes(1.26 * 1024 * 1024)).toBe("1,3 Mo");
	expect(formatBytes(2.5 * 1024 ** 3)).toBe("2,5 Go");
	expect(estimateBytes(100)).toBe(100 * AVG_WIKI_FILE_BYTES);
});

test("avancement en pourcentage borné", () => {
	expect(percent(0, 0)).toBe(0);
	expect(percent(1, 3)).toBe(33);
	expect(percent(5, 3)).toBe(100);
});

test("la page de repli hors ligne est en français et échappe la portée", () => {
	const html = offlineFallbackHtml('https://x.example/"><script>');
	expect(html).toContain('<html lang="fr">');
	expect(html).toContain("Page indisponible hors ligne");
	expect(html).not.toContain("<script>");
});
