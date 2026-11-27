import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createInvite, getSpace, listInvites, memberRole, removeSpaceMember, revokeInvite, setMemberRole, setSpace, spaceMembers, type Role, type User } from "./accounts";
import { checkContent, contentOf, loadConfig } from "./config";
import { spaceRoot } from "./lib";
import { archiveSpace, setContent } from "./space";

/**
 * The administration API of one space, under `/s/<space>/api/space` (`serve` calls it after the visibility check, so a visitor who may not
 * see the space never gets here): 404 to anyone who is not a member, 403 to a member who is not an owner (on anything that changes), a
 * same-origin request for every change. The slug is immutable: `title` is the display name.
 *
 *   GET    /api/space                 name, title, visibility, read_only, content, custom_schema, storage, members, you
 *   PATCH  /api/space                 { title?, visibility?, read_only?, content? }
 *   PATCH  /api/space/members/<id>    { role }          DELETE /api/space/members/<id>
 *   GET    /api/space/invites         pending invitations
 *   POST   /api/space/invites         { role? } -> a single-use link, valid 7 days (the link is the secret: nothing is e-mailed, no e-mail is matched)
 *   DELETE /api/space/invites/<id>
 *   POST   /api/space/archive         { confirm: "<name>" }: out of spaces/, not served nor searched, restorable
 */
export type AdminDeps = {
  root: string;
  say: (m: string) => void;
  store: () => Database;
  userOf: (req: Request) => Promise<User | undefined>;
  sameOrigin: (h: Headers) => boolean;
  /** One git or file change at a time for the whole server. */
  serial: <T>(f: () => Promise<T> | T) => Promise<T>;
  sync: boolean;
  /** Takes the space's site off the routes and stops it, waiting for its build to end (before its folder moves). */
  unmount: (name: string) => Promise<void>;
  /** Queues a rebuild of the space's site (the export knows what the space holds). */
  rebuild: (name: string) => void;
};

const MAX_TITLE = 120;
/** A display title as the accounts keep it (trimmed, one line, null for none), or an error message: `PATCH` and `POST /api/spaces`. */
export function checkTitle(v: unknown): { title: string | null } | { error: string } {
  if (v !== null && typeof v !== "string") return { error: '"title" must be a string or null.' };
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return [...t].length > MAX_TITLE ? { error: `"title" is at most ${MAX_TITLE} characters.` } : { title: t || null };
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);
const readJson = (req: Request) => req.json().then((b) => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}), () => ({} as Record<string, unknown>));

export function spaceAdmin(d: AdminDeps) {
  /** `rest` is the path inside the space (`/api/space…`); undefined when it is not an administration route. */
  return async (req: Request, name: string, rest: string): Promise<Response | undefined> => {
    const m = /^\/api\/space(?:\/(members|invites|archive)(?:\/([^/]+))?)?$/.exec(rest);
    if (!m) return;
    const [, area, id] = m, method = req.method === "HEAD" ? "GET" : req.method;
    let store: Database, user: User | undefined, role: Role | undefined;
    try {
      store = d.store();
      user = await d.userOf(req);
      role = user ? memberRole(store, name, user.id) : undefined;
    } catch { return fail(404, "not found"); } // fail closed
    if (!user || !role) return fail(404, "not found"); // not a member: nothing tells the space is there
    if (method !== "GET" || area === "invites") { // a member reads the space and its people; the invitations and every change are the owners'
      if (role !== "owner") return fail(403, "only an owner of this space may do that");
    }
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (!origin || !d.sameOrigin(req.headers)) return fail(403, "cross-origin request refused");
    }

    if (!area) {
      if (method === "GET") return info(name, role);
      if (method !== "PATCH") return fail(405, "method not allowed");
      const body = await readJson(req), patch: Parameters<typeof setSpace>[2] = {};
      if (body.title !== undefined) {
        const t = checkTitle(body.title);
        if ("error" in t) return fail(400, t.error);
        patch.title = t.title;
      }
      if (body.visibility !== undefined) {
        if (body.visibility !== "open" && body.visibility !== "private") return fail(400, '"visibility" must be "open" or "private".');
        patch.visibility = body.visibility;
      }
      if (body.read_only !== undefined) {
        if (typeof body.read_only !== "boolean") return fail(400, '"read_only" must be true or false.');
        patch.read_only = body.read_only;
      }
      const kind = body.content === undefined ? undefined : checkContent(body.content);
      if (kind && "error" in kind) return fail(400, kind.error);
      if (!Object.keys(patch).length && !kind) return fail(400, "expected { title?, visibility?, read_only?, content? }.");
      if (Object.keys(patch).length) setSpace(store, name, patch);
      if (kind) {
        try { await d.serial(() => setContent(d.root, name, kind.content, d.sync)); }
        catch (e) { d.say(`space ${name}: content not saved: ${(e as Error).message}`); return fail(500, `the content could not be saved: ${(e as Error).message}`); }
        d.rebuild(name);
      }
      return info(name, role);
    }

    if (area === "members") {
      if (!id) return fail(404, "not found");
      if (method === "DELETE") return change(removeSpaceMember(store, name, id));
      if (method !== "PATCH") return fail(405, "method not allowed");
      const body = await readJson(req);
      if (body.role !== "owner" && body.role !== "member") return fail(400, '"role" must be "owner" or "member".');
      return change(setMemberRole(store, name, id, body.role));
    }

    if (area === "invites") {
      if (id) return method === "DELETE" ? (revokeInvite(store, name, id) ? json({ ok: true }) : fail(404, "no such invitation")) : fail(405, "method not allowed");
      if (method === "GET") return json({ invites: listInvites(store, name, Date.now()).map((i) => ({ id: i.id, role: i.role, created_by: i.created_by, created_at: new Date(i.created_at).toISOString(), expires_at: new Date(i.expires_at).toISOString() })) });
      if (method !== "POST") return fail(405, "method not allowed");
      const body = await readJson(req), r = body.role ?? "member";
      if (r !== "owner" && r !== "member") return fail(400, '"role" must be "owner" or "member".');
      const inv = createInvite(store, name, r, user.id, Date.now());
      return json({ id: inv.id, role: r, expires_at: new Date(inv.expires_at).toISOString(), url: `/s/${name}/account/invite/?token=${inv.token}` }, 201);
    }

    // archive
    if (id || method !== "POST") return fail(id ? 404 : 405, id ? "not found" : "method not allowed");
    const body = await readJson(req);
    if (body.confirm !== name) return fail(400, `expected { confirm: "${name}" }: type the name of the space to archive it.`);
    if (existsSync(join(spaceRoot(d.root, name), ".git"))) return fail(409, "this space is its own git repository: archiving it from the web could lose work that is not pushed. Use cortex space archive on the server.");
    try {
      await d.serial(async () => {
        await d.unmount(name); // first: no export or inbox of this space may write into the folder once it moved
        await archiveSpace(d.root, name, d.sync);
      });
    } catch (e) { d.say(`space ${name}: archive failed: ${(e as Error).message}`); return fail(500, `the space could not be archived: ${(e as Error).message}`); }
    d.say(`space ${name} archived by ${user.name ?? user.id}`);
    return json({ ok: true });

    function change(r: "ok" | "unknown" | "last-owner") {
      return r === "ok" ? json({ ok: true, members: members(name) }) : r === "unknown" ? fail(404, "no such member") : fail(409, "this is the last owner of the space: name another owner first.");
    }
    function members(n: string) { return spaceMembers(store, n).map((x) => ({ id: x.id, name: x.name ?? x.email, role: x.role })); }
    async function info(n: string, you: Role) {
      const row = getSpace(store, n), config = await loadConfig(d.root).catch(() => ({} as Awaited<ReturnType<typeof loadConfig>>));
      return json({
        name: n, title: row?.title ?? null, visibility: row?.visibility ?? "open", read_only: row?.read_only ?? false,
        content: contentOf(config, n), custom_schema: !!(config.spaces?.[n]?.schema ?? config.schema),
        storage: existsSync(join(spaceRoot(d.root, n), ".git")) ? "own repo" : "instance",
        members: members(n), you,
      });
    }
  };
}
