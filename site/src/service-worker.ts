/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from "$app/env";
import { assets, immutable, prerendered } from "$app/manifest";
import { self } from "$app/service-worker";

// Hors ligne : tout le site prérendu (pages, __data.json, index de recherche, graphe, ressources _app/) est mis en cache
// à l'installation. `version` est l'empreinte des données (BRAIN_SITE_VERSION) : même wiki, même service worker.
const CACHE = `brain-${version}`;

// Les chemins du manifeste sont relatifs au chemin de base : on les résout contre la portée du service worker,
// donc le site marche sous n'importe quel sous-chemin.
const url = (path: string) => new URL(path, self.registration.scope).href;
const IMMUTABLE = new Set(immutable.map((f) => url(f.path)));
const PRECACHE = [...new Set([...immutable, ...assets, ...prerendered].map((f) => url(f.path)))];

self.addEventListener("install", (event) => {
	// `reload` : on ne veut pas d'une copie périmée du cache HTTP du navigateur
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
	// `claim` : la page qui vient d'installer le service worker en profite sans recharger (sinon « disponible hors ligne » serait faux)
	event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;

	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		// fichiers immuables (nom = empreinte du contenu) : le cache d'abord
		if (IMMUTABLE.has(request.url)) return (await cache.match(request.url)) ?? fetch(request);
		// pages et données : le réseau d'abord (les mises à jour se voient en ligne), le cache sinon
		try {
			const response = await fetch(request);
			if (response.status === 200) void cache.put(request, response.clone());
			return response;
		} catch (error) {
			// `ignoreSearch` : /search/?q=… retombe sur la page /search/
			const cached = await cache.match(request, { ignoreSearch: true });
			if (cached) return cached;
			throw error;
		}
	})());
});
