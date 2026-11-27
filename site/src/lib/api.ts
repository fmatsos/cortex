/**
 * The API of `cortex serve`: the account and the spaces at the root of the server (`/api/me*`, `/api/spaces*`), and the data of the
 * space of the page under its prefix (`/s/<space>/api/conversations*`, `journeys*`, `me/state`, `space*`; see space.ts): JSON, cookie session, never cached.
 */
export class ApiError extends Error {
	/** `detail`: what the server said (`{ error }` of its answer), in its own language: shown as it is for a refusal that explains itself (409). */
	constructor(readonly status: number, message: string, readonly detail = "") { super(message); }
}

/** JSON call. Throws `ApiError` on a non-2xx answer (401: not signed in) and on a network failure (status 0); `detail` carries the server's message. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: init.method ?? "GET",
			credentials: "same-origin",
			headers: init.body === undefined ? undefined : { "content-type": "application/json" },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: init.signal,
		});
	} catch (e) {
		if ((e as Error)?.name === "AbortError") throw e;
		throw new ApiError(0, "network");
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: unknown };
		throw new ApiError(res.status, `HTTP ${res.status}`, typeof body?.error === "string" ? body.error : "");
	}
	return (await res.json().catch(() => ({}))) as T;
}
