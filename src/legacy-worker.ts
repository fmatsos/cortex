/**
 * The service worker of a site served at the root, retired. A browser that visited the instance before `cortex space migrate` holds a
 * worker of scope `/` (script `/service-worker.js`) and its caches: the pages of the old root site. A multi-space server no longer has
 * a site there, and a 404 for the worker's script does not remove it, so it would keep serving those pages offline (and when the network
 * is slow) next to the spaces'. The server answers that one URL with this script instead: the browser updates the old worker to it, it
 * deletes the caches of the root site (`cortex-wiki:/:…`, and the names from before the rename; never a space's, `cortex-wiki:/s/<name>/:…`),
 * unregisters itself and reloads the pages it controlled, which `/` and the old paths then send to the default space.
 */
export const LEGACY_WORKER = `// Retires the service worker of the site that used to be served at the root (see src/legacy-worker.ts).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("cortex-wiki:/:") || name.startsWith("brain-wiki:/:") || /^brain-[0-9a-f]{12}$/.test(name)) await caches.delete(name);
  await self.clients.claim();
  const pages = await self.clients.matchAll({ type: "window" });
  await self.registration.unregister();
  for (const page of pages) page.navigate(page.url).catch(() => {});
})()));
// until it is gone, nothing is answered from a cache: every request goes to the network
`;

/** `GET /service-worker.js` of a multi-space server: the retiring worker, never cached (the browser checks the script of a worker for updates). */
export const legacyWorker = () => new Response(LEGACY_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
