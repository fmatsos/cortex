import { api } from "./api";
import { spaceName } from "./space";

/**
 * The spaces of a multi-space `cortex serve` the visitor may see (`GET /api/spaces`, at the root of the server). Anywhere else (a
 * static site, a server of one space) the route does not answer: `available` stays false and nothing about spaces is shown.
 * Loaded once the account is known (`canCreate` depends on it), never blocking a render.
 */
class Spaces {
	available = $state(false);
	names = $state<string[]>([]);
	canCreate = $state(false);
	/** The space of this page ("" when it is not one). */
	current = $state("");

	async load() {
		try {
			const r = await api<{ spaces?: { name: string }[]; canCreate?: boolean }>("/api/spaces");
			this.names = Array.isArray(r.spaces) ? r.spaces.map((s) => s.name) : [];
			this.canCreate = r.canCreate === true;
			this.current = spaceName();
			this.available = !!this.current;
		} catch { this.available = false; }
	}

	/** Creates a space and returns its URL. Throws `ApiError` (400 invalid name, 409 exists, 401 signed out, 403 refused). */
	async create(name: string): Promise<string> {
		return (await api<{ url: string }>("/api/spaces", { method: "POST", body: { name } })).url;
	}
}

export const spaces = new Spaces();
