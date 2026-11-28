import { spaceApi } from "./space";

/** The answer of the space's share route: `reason` is the server's own text (it answers in plain text: 400, 409 refused, 413 too big, 415 type), `status` 0 when it could not be reached. */
export type ShareResult = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Sends one share to the current space (`POST <space>/share/api`, the phone's and the extension's route): JSON (`{ title, text, url, note, as }`), or
 * `FormData` (the same fields and one or more `file` parts: the files are named and checked by the server). Never throws.
 */
export async function sendShare(body: Record<string, unknown> | FormData): Promise<ShareResult> {
	try {
		const form = body instanceof FormData;
		const r = await fetch(spaceApi("/share/api"), { method: "POST", credentials: "same-origin", headers: form ? undefined : { "content-type": "application/json" }, body: form ? body : JSON.stringify(body) });
		return r.ok ? { ok: true } : { ok: false, status: r.status, reason: (await r.text().catch(() => "")).trim() };
	} catch { return { ok: false, status: 0, reason: "" }; }
}

/** The statuses whose text explains itself: the space (or the share route) refused, and says why. */
export const refusal = (r: Extract<ShareResult, { ok: false }>): boolean => !!r.reason && [400, 409, 413, 415].includes(r.status);
