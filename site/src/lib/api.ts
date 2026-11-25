/** The account API of `cortex serve` (`/api/me*`, `/api/conversations*`, `/api/journeys*`): JSON, cookie session, never cached. */
export class ApiError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

/** JSON call at the root of the server. Throws `ApiError` on a non-2xx answer (401: not signed in) and on a network failure (status 0). */
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
	if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
	return (await res.json().catch(() => ({}))) as T;
}
