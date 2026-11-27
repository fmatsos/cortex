import type { Database } from "bun:sqlite";
import type { Config } from "./config";
import * as db from "./accounts";
import { openAccounts, accountsFile, randomToken, sha256, type Turn, type User } from "./accounts";
import { Refused, beginLogin, enabledProviders, finishLogin, publicOrigins, type Net, type Provider } from "./auth";

/**
 * The accounts' HTTP routes of `cortex serve` (JSON, never cached): `/api/auth/*` (providers, login, callback, logout),
 * `/api/me` (the account and its preferences), `/api/conversations` (saved assistant conversations) and `/api/journeys`
 * (saved graph journeys). Without a session, `/api/me*`, `/api/conversations*` and `/api/journeys*` answer 401; another
 * user's data answers 404 (every query carries the `user_id`).
 *
 * Security, in short: a session is an opaque random token, only its SHA-256 is stored; the cookie is HttpOnly, SameSite=Lax
 * (Strict would drop it on the way back from the provider), Secure when the public URL it was opened through is https (the
 * request never decides it). The redirect URI and the post-login redirection come from `auth.public_urls`, never from `Host`
 * or the request's scheme. Every state-changing request needs an `Origin` that is one of those origins.
 */
export type AccountDeps = {
  root: string;
  say: (m: string) => void;
  config: () => Promise<Config>;
  /** Page id → title of a space ('' outside the spaces), to name a journey by its first and last pages. */
  titles: (space: string) => Promise<Map<string, string>>;
  env?: Record<string, string | undefined>;
  net?: Net;
  now?: () => number;
};

/** Sessions slide: 14 days from the last use, renewed at most once a day. */
export const SESSION_DAYS = 14;
const DAY = 86_400_000;
const TX_MS = 600_000;
export const ACCOUNT_LIMITS = { turns: 200, chars: 1_000_000, title: 120, pagesPerTurn: 200, idLength: 300, route: 500, state: 64 * 1024, body: 8 * 1024 * 1024, perUser: 500 };

const SESSION = "cortex_session", HOST_SESSION = "__Host-cortex_session", TX = "cortex_login", SECURE_TX = "__Secure-cortex_login";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const fail = (status: number, error: string, headers?: HeadersInit) => json({ error }, status, headers);
/** Expires the session cookie under both of its names (the `__Host-` one is only deleted by a Secure Set-Cookie). */
const clearSession = (res: Response) => {
  for (const x of [cookie(HOST_SESSION, "", { path: "/", maxAge: 0, secure: true }), cookie(SESSION, "", { path: "/", maxAge: 0, secure: false })]) res.headers.append("set-cookie", x);
  return res;
};
const iso = (ms: number) => new Date(ms).toISOString();

function cookies(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] ??= part.slice(i + 1).trim();
  }
  return out;
}
const cookie = (name: string, value: string, o: { path: string; maxAge: number; secure: boolean }) =>
  `${name}=${value}; Path=${o.path}; Max-Age=${o.maxAge}; HttpOnly; SameSite=Lax${o.secure ? "; Secure" : ""}`;

/** Where in the public URLs list this request came from: its Origin, else the host the proxy forwards, else Host. Only ever picks a configured entry. */
function pickOrigin(req: Request, origins: string[]): string {
  const hosts = [req.headers.get("origin"), req.headers.get("x-forwarded-host")?.split(",")[0], req.headers.get("host")].filter(Boolean) as string[];
  for (const h of hosts) {
    const host = h.includes("://") ? (() => { try { return new URL(h).host; } catch { return ""; } })() : h.trim();
    const hit = origins.find((o) => new URL(o).host === host);
    if (hit) return hit;
  }
  return origins[0]!;
}

/** `?return=`: a path of this site only. Anything else (other site, `//host`, backslash, control characters, an API URL) becomes `/`. */
export function safeReturn(r: string | null, origin: string): string {
  if (!r || !r.startsWith("/") || r.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(r)) return "/";
  try {
    const u = new URL(r, origin);
    return u.origin !== origin || u.pathname.startsWith("/api/") ? "/" : u.pathname + u.search + u.hash;
  } catch { return "/"; }
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);

type Checked<T> = { ok: T } | { error: string; status?: number };
const bad = (error: string, status = 400) => ({ error, status });

function checkTitle(v: unknown): Checked<string | undefined> {
  if (v === undefined || v === null) return { ok: undefined };
  if (typeof v !== "string") return bad('"title" must be a string.');
  const t = normalize(v);
  return [...t].length > ACCOUNT_LIMITS.title ? bad(`"title" is at most ${ACCOUNT_LIMITS.title} characters.`) : { ok: t || undefined };
}
function checkIds(v: unknown, what: string, max: number): Checked<string[]> {
  if (!Array.isArray(v) || v.length < (what === "route" ? 1 : 0) || v.length > max) return bad(`"${what}" must be a list of ${what === "route" ? `1 to ${max}` : `at most ${max}`} page ids.`);
  return v.every((x) => typeof x === "string" && x.length > 0 && x.length <= ACCOUNT_LIMITS.idLength) ? { ok: v as string[] } : bad(`"${what}" holds page ids (non-empty strings of at most ${ACCOUNT_LIMITS.idLength} characters).`);
}
function checkTurns(v: unknown): Checked<Turn[]> {
  if (!Array.isArray(v) || v.length < 1 || v.length > ACCOUNT_LIMITS.turns) return bad(`"turns" must be a list of 1 to ${ACCOUNT_LIMITS.turns} exchanges.`);
  let chars = 0;
  const turns: Turn[] = [];
  for (const t of v) {
    const { question, answer, pages, at } = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (typeof question !== "string" || !question.trim() || typeof answer !== "string") return bad('an exchange is { question (text), answer (Markdown), pages? (ids), at? (date) }.');
    chars += question.length + answer.length;
    const turn: Turn = { question, answer };
    if (pages !== undefined) { const p = checkIds(pages, "pages", ACCOUNT_LIMITS.pagesPerTurn); if ("error" in p) return p; turn.pages = p.ok; }
    if (at !== undefined) {
      const ms = typeof at === "string" && at.length <= 40 ? Date.parse(at) : NaN;
      if (Number.isNaN(ms)) return bad('"at" must be a date.');
      turn.at = iso(ms);
    }
    turns.push(turn);
  }
  return chars > ACCOUNT_LIMITS.chars ? bad(`a conversation holds at most ${ACCOUNT_LIMITS.chars} characters.`, 413) : { ok: turns };
}

const conversationOut = (c: db.ConversationRow) => ({ id: c.id, title: c.title, turns: c.turns, created_at: iso(c.created_at), updated_at: iso(c.updated_at) });
const journeyOut = (j: db.JourneyRow) => ({ id: j.id, title: j.title, route: j.route, created_at: iso(j.created_at), updated_at: iso(j.updated_at) });

/**
 * The route handler: `undefined` for a URL that is not an account route. With a `scope` (a multi-space `serve`, after it checked who may see the
 * space) it answers the saved conversations, journeys and favorites (`me/state`) of that space only, at `path` (`/api/conversations`…): page ids repeat from one
 * space to the next, so each space keeps its own. Without one it is the instance's, space `''`: the routes of a legacy instance. It also tells who a request is (`userOf`), whether sign-in
 * is configured, and gives the database: what a multi-space `cortex serve` needs to decide who may see a space.
 */
export type AccountRoute = ((req: Request, scope?: { space: string; path: string }) => Promise<Response | undefined>) & {
  userOf(req: Request): Promise<User | undefined>;
  configured(): Promise<boolean>;
  store(): Database;
};
export function accountRoute(d: AccountDeps): AccountRoute {
  const now = d.now ?? Date.now, env = d.env ?? process.env, net: Net = { ...d.net, cache: new Map() };
  let conn: Database | undefined, lastPurge = 0, warned = "";
  const open = () => (conn ??= openAccounts(accountsFile(d.root)));

  const handler = async (req: Request, scope?: { space: string; path: string }) => {
    const url = new URL(req.url), path = scope?.path ?? url.pathname, space = scope?.space ?? "";
    if (!(scope ? /^\/api\/(me\/state|conversations|journeys)(\/|$)/ : /^\/api\/(auth|me|conversations|journeys)(\/|$)/).test(path)) return;
    const [area, a, b, ...extra] = path.slice(5).split("/").filter(Boolean) as [string, string?, string?, ...string[]];

    let cfg: Config = {};
    try { cfg = await d.config(); } catch (e) { const msg = (e as Error).message; if (warned !== msg) { warned = msg; d.say(`auth: ${msg}`); } }
    const warn = (msg: string) => { if (warned !== msg) { warned = msg; d.say(`auth: ${msg}`); } };
    const providers = enabledProviders(cfg.auth, env, warn);
    const origins = publicOrigins(cfg.auth);
    const method = req.method === "HEAD" ? "GET" : req.method;

    // every state-changing request of these routes: an Origin that is one of the site's
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (!origin || !origins.includes(origin)) return fail(403, "cross-origin request refused");
    }
    if (area === "auth" && a === "methods" && !b && !extra.length) return method === "GET" ? json({ providers: providers.map((p) => ({ id: p.id, label: p.label })) }) : fail(405, "method not allowed");

    let store: Database;
    try { store = open(); } catch (e) { d.say(`auth: cannot open ${accountsFile(d.root)}: ${(e as Error).message}`); return fail(503, "accounts are unavailable"); }
    const t = now();
    if (t - lastPurge > 3_600_000) { lastPurge = t; db.purge(store, t); }

    if (area === "auth") return extra.length ? fail(404, "not found") : authRoute(req, method, a, b, { store, providers, origins, t });

    // from here on, a signed-in user
    const jar = cookies(req.headers), session = jar[HOST_SESSION] ?? jar[SESSION];
    const found = session ? db.sessionUser(store, sha256(session), t) : undefined;
    if (!found) return fail(401, "not signed in");
    const user = found.user;
    const headers: string[] = [];
    if (found.expiresAt - t < (SESSION_DAYS - 1) * DAY) { // sliding expiry, renewed at most once a day
      db.extendSession(store, sha256(session!), t + SESSION_DAYS * DAY);
      headers.push(cookie(jar[HOST_SESSION] ? HOST_SESSION : SESSION, session!, { path: "/", maxAge: SESSION_DAYS * 86_400, secure: !!jar[HOST_SESSION] }));
    }
    const res = extra.length ? fail(404, "not found") : await dataRoute(req, method, area, a, b, user, store, t, space);
    for (const c of headers) res.headers.append("set-cookie", c);
    return res;
  };
  const userOf = async (req: Request) => {
    const jar = cookies(req.headers), session = jar[HOST_SESSION] ?? jar[SESSION];
    try { return session ? db.sessionUser(open(), sha256(session), now())?.user : undefined; } catch { return undefined; }
  };
  const configured = async () => { try { return enabledProviders((await d.config()).auth, env).length > 0; } catch { return false; } };
  return Object.assign(handler, { userOf, configured, store: open });

  // ---- /api/auth/login/:provider, /api/auth/callback/:provider, /api/auth/logout
  async function authRoute(req: Request, method: string, a: string | undefined, id: string | undefined, c: { store: Database; providers: Provider[]; origins: string[]; t: number }): Promise<Response> {
    const { store, providers, origins, t } = c;
    const secureOf = (origin: string) => origin.startsWith("https:");
    const sessionNames = (secure: boolean) => ({ name: secure ? HOST_SESSION : SESSION, secure });

    if (a === "logout" && !id) {
      if (method !== "POST") return fail(405, "method not allowed");
      const jar = cookies(req.headers), token = jar[HOST_SESSION] ?? jar[SESSION];
      if (token) db.deleteSession(store, sha256(token));
      const res = json({ ok: true });
      return clearSession(res);
    }
    if ((a !== "login" && a !== "callback") || !id) return fail(404, "not found");
    if (method !== "GET") return fail(405, "method not allowed");
    const p = providers.find((x) => x.id === id);
    if (!p || !origins.length) return fail(404, "unknown sign-in method");
    const callbackPath = `/api/auth/callback/${p.id}`;
    const back = (origin: string, ret: string, auth?: "refused" | "error", extra: string[] = []) => {
      const to = new URL(ret, origin);
      if (auth) to.searchParams.set("auth", auth);
      const res = new Response(null, { status: 302, headers: { location: to.href, "cache-control": "no-store" } });
      for (const x of extra) res.headers.append("set-cookie", x);
      return res;
    };

    if (a === "login") {
      const origin = pickOrigin(req, origins), ret = safeReturn(new URL(req.url).searchParams.get("return"), origin);
      try {
        const begun = await beginLogin(p, origin + callbackPath, net);
        const token = randomToken();
        db.createTx(store, sha256(token), { provider: p.id, state: begun.state, nonce: begun.nonce, verifier: begun.verifier, return_to: ret, public_url: origin }, t, TX_MS);
        const secure = secureOf(origin);
        const res = new Response(null, { status: 302, headers: { location: begun.url, "cache-control": "no-store" } });
        res.headers.append("set-cookie", cookie(secure ? SECURE_TX : TX, token, { path: callbackPath, maxAge: TX_MS / 1000, secure }));
        return res;
      } catch (e) {
        d.say(`auth: ${p.id} login could not start: ${describe(e)}`);
        return back(origin, ret, "error");
      }
    }

    // callback: the transaction is single use and bound to this browser by its cookie; deleted whatever happens next
    const jar = cookies(req.headers), token = jar[SECURE_TX] ?? jar[TX];
    const tx = token ? db.takeTx(store, sha256(token), t) : undefined;
    const clearTx = [cookie(SECURE_TX, "", { path: callbackPath, maxAge: 0, secure: true }), cookie(TX, "", { path: callbackPath, maxAge: 0, secure: false })];
    if (!tx || tx.provider !== p.id || !origins.includes(tx.public_url)) return back(pickOrigin(req, origins), "/", "error", clearTx);
    try {
      const who = await finishLogin(p, tx, new URL(req.url).searchParams, tx.public_url + callbackPath, net);
      const user = db.upsertUser(store, p.id, who.subject, who.name, who.email, t);
      const old = jar[HOST_SESSION] ?? jar[SESSION];
      if (old) db.deleteSession(store, sha256(old));
      const sessionToken = randomToken(), { name, secure } = sessionNames(secureOf(tx.public_url));
      db.createSession(store, user.id, sha256(sessionToken), t, SESSION_DAYS * DAY);
      return back(tx.public_url, tx.return_to, undefined, [...clearTx, cookie(name, sessionToken, { path: "/", maxAge: SESSION_DAYS * 86_400, secure })]);
    } catch (e) {
      d.say(e instanceof Refused ? `auth: ${p.id} sign-in refused: ${e.message}` : `auth: ${p.id} sign-in failed: ${describe(e)}`);
      return back(tx.public_url, tx.return_to, e instanceof Refused ? "refused" : "error", clearTx);
    }
  }

  // ---- the signed-in routes
  async function dataRoute(req: Request, method: string, area: string, a: string | undefined, b: string | undefined, user: User, store: Database, t: number, space: string): Promise<Response> {
    if (area === "me") {
      if (!a) {
        if (method === "GET") return json({ id: user.id, name: user.name, email: user.email, provider: user.provider });
        if (method === "DELETE") {
          const owned = db.deleteUser(store, user.id);
          return owned.length ? fail(409, `you are the only owner of ${owned.join(", ")}: name another owner first (or archive ${owned.length > 1 ? "them" : "it"}).`) : clearSession(json({ ok: true }));
        }
        return fail(405, "method not allowed");
      }
      if (a !== "state" || b) return fail(404, "not found");
      if (method === "GET") {
        const s = space ? db.getSpaceState(store, user.id, space) : db.getState(store, user.id);
        return json(s ? JSON.parse(s.data) : {}, 200, s ? { "last-modified": new Date(s.updated_at).toUTCString() } : {});
      }
      if (method !== "PUT") return fail(405, "method not allowed");
      const body = await readJson(req, ACCOUNT_LIMITS.state);
      if ("error" in body) return fail(body.status ?? 400, body.error);
      if (!body.ok || typeof body.ok !== "object" || Array.isArray(body.ok)) return fail(400, "the preferences are a JSON object.");
      if (space) db.putSpaceState(store, user.id, space, JSON.stringify(body.ok), t); else db.putState(store, user.id, JSON.stringify(body.ok), t);
      return json({ ok: true });
    }

    if (area === "conversations") {
      if (!a) {
        if (method === "GET") {
          const words = normalize(new URL(req.url).searchParams.get("q") ?? "").toLowerCase().split(" ").filter(Boolean).slice(0, 8);
          return json({ conversations: db.listConversations(store, user.id, space, words).map((c) => ({ ...c, created_at: iso(c.created_at), updated_at: iso(c.updated_at) })) });
        }
        if (method !== "POST") return fail(405, "method not allowed");
        const body = await readJson(req, ACCOUNT_LIMITS.body);
        if ("error" in body) return fail(body.status ?? 400, body.error);
        const o = (body.ok ?? {}) as Record<string, unknown>, turns = checkTurns(o.turns), title = checkTitle(o.title);
        if ("error" in turns) return fail(turns.status ?? 400, turns.error);
        if ("error" in title) return fail(title.status ?? 400, title.error);
        if (db.countOf(store, "conversations", user.id, space) >= ACCOUNT_LIMITS.perUser) return fail(409, `at most ${ACCOUNT_LIMITS.perUser} saved conversations: delete one first.`);
        return json(conversationOut(db.insertConversation(store, user.id, space, title.ok ?? clip(normalize(turns.ok[0]!.question), ACCOUNT_LIMITS.title), turns.ok, t)), 201);
      }
      if (b) return fail(404, "not found");
      const cur = db.getConversation(store, user.id, space, a);
      if (!cur) return fail(404, "no such conversation");
      if (method === "GET") return json(conversationOut(cur));
      if (method === "DELETE") { db.deleteConversation(store, user.id, space, a); return json({ ok: true }); }
      if (method !== "PUT") return fail(405, "method not allowed");
      const body = await readJson(req, ACCOUNT_LIMITS.body);
      if ("error" in body) return fail(body.status ?? 400, body.error);
      const o = (body.ok ?? {}) as Record<string, unknown>;
      if (o.turns === undefined && o.title === undefined) return fail(400, 'expected { title?, turns? }.');
      const turns = o.turns === undefined ? { ok: cur.turns } : checkTurns(o.turns), title = checkTitle(o.title);
      if ("error" in turns) return fail(turns.status ?? 400, turns.error);
      if ("error" in title) return fail(title.status ?? 400, title.error);
      const next = o.title === undefined ? cur.title : title.ok ?? clip(normalize(turns.ok[0]!.question), ACCOUNT_LIMITS.title);
      return json(conversationOut(db.updateConversation(store, user.id, space, a, next, turns.ok, t)!));
    }

    // journeys
    if (!a) {
      if (method === "GET") return json({ journeys: db.listJourneys(store, user.id, space).map(journeyOut) });
      if (method !== "POST") return fail(405, "method not allowed");
      const body = await readJson(req, ACCOUNT_LIMITS.body);
      if ("error" in body) return fail(body.status ?? 400, body.error);
      const o = (body.ok ?? {}) as Record<string, unknown>, route = checkIds(o.route, "route", ACCOUNT_LIMITS.route), title = checkTitle(o.title);
      if ("error" in route) return fail(route.status ?? 400, route.error);
      if ("error" in title) return fail(title.status ?? 400, title.error);
      if (db.countOf(store, "journeys", user.id, space) >= ACCOUNT_LIMITS.perUser) return fail(409, `at most ${ACCOUNT_LIMITS.perUser} saved journeys: delete one first.`);
      return json(journeyOut(db.insertJourney(store, user.id, space, title.ok ?? (await journeyTitle(route.ok, space)), route.ok, t)), 201);
    }
    if (b) return fail(404, "not found");
    const cur = db.getJourney(store, user.id, space, a);
    if (!cur) return fail(404, "no such journey");
    if (method === "GET") return json(journeyOut(cur));
    if (method === "DELETE") { db.deleteJourney(store, user.id, space, a); return json({ ok: true }); }
    if (method !== "PUT") return fail(405, "method not allowed");
    const body = await readJson(req, ACCOUNT_LIMITS.body);
    if ("error" in body) return fail(body.status ?? 400, body.error);
    const o = (body.ok ?? {}) as Record<string, unknown>;
    if (o.route === undefined && o.title === undefined) return fail(400, "expected { title?, route? }.");
    const route = o.route === undefined ? { ok: cur.route } : checkIds(o.route, "route", ACCOUNT_LIMITS.route), title = checkTitle(o.title);
    if ("error" in route) return fail(route.status ?? 400, route.error);
    if ("error" in title) return fail(title.status ?? 400, title.error);
    const next = o.title === undefined ? cur.title : title.ok ?? (await journeyTitle(route.ok, space));
    return json(journeyOut(db.updateJourney(store, user.id, space, a, next, route.ok, t)!));
  }

  /** « Voyage : <first page> → <last page> », the pages' titles when the server knows them, their ids otherwise. */
  async function journeyTitle(route: string[], space: string): Promise<string> {
    const titles = await d.titles(space).catch(() => new Map<string, string>());
    const name = (id: string) => titles.get(id) ?? id;
    return clip(`Voyage : ${name(route[0]!)} → ${name(route[route.length - 1]!)}`, ACCOUNT_LIMITS.title);
  }
}

/** A short, secret-free description of an error for the server log (oauth4webapi errors carry the response: never print that). */
function describe(e: unknown): string {
  const x = e as { name?: string; code?: string; message?: string };
  return [x?.name, x?.code, (x?.message ?? "").slice(0, 160)].filter(Boolean).join(" ");
}

/** The JSON body of a request, read with a ceiling (a lying or missing Content-Length cannot bring a bigger body in). */
async function readJson(req: Request, max: number): Promise<{ ok: unknown } | { error: string; status?: number }> {
  const tooBig = { error: `the body is limited to ${max} bytes.`, status: 413 };
  if (Number(req.headers.get("content-length") ?? 0) > max) return tooBig;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) return tooBig;
    chunks.push(chunk);
  }
  try { return { ok: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; } catch { return { error: "expected a JSON body.", status: 400 }; }
}
