import { api, ApiError } from "./api";
import { spaceName } from "./space";

/**
 * The spaces of a multi-space `cortex serve` the visitor may see (`GET /api/spaces`, at the root of the server). Anywhere else (a
 * static site, a server of one space) the route does not answer: `available` stays false and nothing about spaces is shown.
 * Loaded once the account is known (`canCreate` depends on it), never blocking a render.
 *
 * The listing carries `name`, `title` (null: the slug is the title), `read_only` and, from a server that knows them, `content`.
 * What only a member may read (visibility, members, storage, the role) comes from `GET /s/<name>/api/space` (`detail`): 404 for
 * anyone else, who then sees the space as open and read-only for them.
 */
export type Content = "resources" | "notes";
export const CONTENTS: readonly Content[] = ["resources", "notes"];
/** Slug of a space: the same rule as the server's (lowercase letters, digits and dashes, 40 at most, starting with a letter or a digit). */
export const SPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type SpaceRow = {
	name: string;
	/** The display title, or null when none was given. */
	title: string | null;
	readOnly: boolean;
	/** What the space holds; empty when the server did not say (nothing is claimed then). */
	content: Content[];
};
export type Role = "owner" | "member";
export type Member = { id: string; name: string; role: Role };
export type SpaceDetail = {
	name: string;
	title: string | null;
	visibility: "open" | "private";
	readOnly: boolean;
	content: Content[];
	storage: "instance" | "own repo";
	members: Member[];
	you: Role;
};
export type Invite = { id: string; role: Role; expires_at: string };
export type ArchivedRow = { name: string; title: string | null; archivedAt: string };
export type CreateInput = { name: string; title?: string; content: Content[] };

/** Why a slug is refused before asking the server: "invalid" (not the slug's form) or "taken" (an active or archived space of the visitor has it); "" when it looks fine. */
export const slugProblem = (slug: string, taken: Iterable<string>): "" | "invalid" | "taken" => (!SPACE_SLUG.test(slug) ? "invalid" : new Set(taken).has(slug) ? "taken" : "");

/** What to show for a space: its title, else its slug. */
export const labelOf = (s: { name: string; title: string | null }): string => s.title || s.name;
export const asContent = (v: unknown, kind?: unknown): Content[] =>
	Array.isArray(v) ? CONTENTS.filter((c) => v.includes(c)) : kind === "notes" ? ["notes"] : [];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const asRow = (v: unknown): SpaceRow | undefined => {
	if (!isObject(v) || typeof v.name !== "string") return;
	return { name: v.name, title: typeof v.title === "string" && v.title ? v.title : null, readOnly: v.read_only === true, content: asContent(v.content, v.kind) };
};
function asDetail(v: unknown): SpaceDetail | undefined {
	if (!isObject(v) || typeof v.name !== "string") return;
	return {
		name: v.name, title: typeof v.title === "string" && v.title ? v.title : null,
		visibility: v.visibility === "private" ? "private" : "open", readOnly: v.read_only === true, content: asContent(v.content, v.kind),
		storage: v.storage === "own repo" ? "own repo" : "instance",
		members: Array.isArray(v.members) ? v.members.filter(isObject).map((m) => ({ id: String(m.id), name: String(m.name ?? ""), role: (m.role === "owner" ? "owner" : "member") as Role })) : [],
		you: v.you === "owner" ? "owner" : "member",
	};
}
/** The per-space API of a space other than the page's own (the account page and the settings reach every space). */
export const apiOf = (name: string, path: string) => `/s/${name}${path}`;

class Spaces {
	available = $state(false);
	/** `/api/spaces` answered (or failed): the pages that depend on `canCreate` know it is final. */
	loaded = $state(false);
	list = $state<SpaceRow[]>([]);
	canCreate = $state(false);
	/** The space of this page ("" when it is not one). */
	current = $state("");
	/** What each space's own `GET /api/space` said, for a member (null: not a member or unreadable: open for this visitor, nothing more known). Filled on demand. */
	details = $state<Record<string, SpaceDetail | null>>({});
	archived = $state<ArchivedRow[]>([]);
	archivedLoaded = $state(false);

	get names(): string[] { return this.list.map((s) => s.name); }
	/** The current space as the listing knows it, completed by its own detail. */
	get info(): SpaceRow | undefined {
		const row = this.list.find((s) => s.name === this.current);
		if (!row) return;
		const d = this.details[this.current];
		return { ...row, title: row.title ?? d?.title ?? null, content: row.content.length ? row.content : (d?.content ?? []), readOnly: row.readOnly || (d?.readOnly ?? false) };
	}
	/** The current space refuses writes (a note, a compilation, a validation): its favorites and journeys stay enabled. */
	get readOnly(): boolean { return this.info?.readOnly === true; }

	async load() {
		try {
			const r = await api<{ spaces?: unknown[]; canCreate?: boolean }>("/api/spaces");
			this.list = Array.isArray(r.spaces) ? r.spaces.map(asRow).filter((s): s is SpaceRow => !!s) : [];
			this.canCreate = r.canCreate === true;
			this.current = spaceName();
			this.available = !!this.current;
		} catch { this.available = false; return; } finally { this.loaded = true; }
		// a member's own view completes a listing that did not say what the space holds
		if (this.info && !this.info.content.length) void this.ensure([this.current]);
	}

	/** Reads (once) the detail of these spaces, in parallel; a 401 leaves them unknown. */
	async ensure(names: string[]) {
		await Promise.all(names.filter((n) => !(n in this.details)).map(async (n) => {
			try { this.details[n] = (await this.detail(n)) ?? null; } catch { /* signed out: unknown */ }
		}));
	}
	/** After a change from the settings: the fresh detail replaces the cached one. */
	remember(d: SpaceDetail | undefined) { if (d) this.details[d.name] = d; }

	/** `GET /s/<name>/api/space`: the detail of a space for a member; undefined for anyone else (404) or when it cannot be read. Throws on a 401 only. */
	async detail(name: string): Promise<SpaceDetail | undefined> {
		try { return asDetail(await api(apiOf(name, "/api/space"))); }
		catch (e) { if (e instanceof ApiError && e.status === 401) throw e; return undefined; }
	}

	/** Creates a space and returns its URL. Throws `ApiError` (400 invalid, 409 exists, 401 signed out, 403 refused). */
	async create({ name, title, content }: CreateInput): Promise<string> {
		return (await api<{ url: string }>("/api/spaces", { method: "POST", body: { name, ...(title ? { title } : {}), content } })).url;
	}

	async loadArchived() {
		const r = await api<{ archived?: unknown[] }>("/api/spaces/archived");
		this.archived = (Array.isArray(r.archived) ? r.archived : []).filter(isObject).map((a) => ({ name: String(a.name), title: typeof a.title === "string" && a.title ? a.title : null, archivedAt: String(a.archived_at ?? "") }));
		this.archivedLoaded = true;
	}
	/** Restores an archived space and returns its URL. Throws `ApiError` (409: the name was taken meanwhile; `detail` says so). */
	async restore(name: string): Promise<string> {
		const url = (await api<{ url: string }>(`/api/spaces/${encodeURIComponent(name)}/restore`, { method: "POST" })).url;
		this.archived = this.archived.filter((a) => a.name !== name);
		return url;
	}

	// ---- administration of one space (owners) ---------------------------------------------------------------------------
	async setSettings(name: string, patch: { title?: string | null; visibility?: "open" | "private"; read_only?: boolean; content?: Content[] }): Promise<SpaceDetail | undefined> {
		const d = asDetail(await api(apiOf(name, "/api/space"), { method: "PATCH", body: patch }));
		this.remember(d);
		return d;
	}
	async setRole(name: string, id: string, role: Role) { await api(apiOf(name, `/api/space/members/${encodeURIComponent(id)}`), { method: "PATCH", body: { role } }); }
	async removeMember(name: string, id: string) { await api(apiOf(name, `/api/space/members/${encodeURIComponent(id)}`), { method: "DELETE" }); }
	async invites(name: string): Promise<Invite[]> {
		const r = await api<{ invites?: unknown[] }>(apiOf(name, "/api/space/invites"));
		return (Array.isArray(r.invites) ? r.invites : []).filter(isObject).map((i) => ({ id: String(i.id), role: (i.role === "owner" ? "owner" : "member") as Role, expires_at: String(i.expires_at ?? "") }));
	}
	/** Creates a single-use link; the server answers a relative URL, shown as `location.origin + url`. */
	async invite(name: string, role: Role): Promise<{ id: string; url: string; expires_at: string }> {
		const r = await api<{ id: string; url: string; expires_at: string }>(apiOf(name, "/api/space/invites"), { method: "POST", body: { role } });
		return { id: r.id, url: location.origin + r.url, expires_at: r.expires_at };
	}
	async revokeInvite(name: string, id: string) { await api(apiOf(name, `/api/space/invites/${encodeURIComponent(id)}`), { method: "DELETE" }); }
	async archive(name: string, confirm: string) { await api(apiOf(name, "/api/space/archive"), { method: "POST", body: { confirm } }); }
}

export const spaces = new Spaces();
