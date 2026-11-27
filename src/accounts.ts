import { Database } from "bun:sqlite";
import "./sqlite-lib"; // before any Database: it chooses the SQLite library
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { instanceRoot } from "./lib";

/**
 * The accounts' storage (`cortex serve`): users, sessions, preferences, saved assistant conversations and graph journeys, in
 * one SQLite file, `.cortex/accounts.db` of the instance root (a multi-space instance has one for all its spaces). Never under `.cortex/serve/`: serve empties one of its two build
 * folders at each rebuild. `.cortex/` is not versioned (serve --sync commits `raw/` and `wiki/` only).
 *
 * Every read and write of user data is filtered by `user_id`: another user's row is simply not found (the routes answer 404).
 * Times are milliseconds since the epoch; the API turns them into ISO strings.
 */
export const accountsFile = (root: string) => join(instanceRoot(root), ".cortex/accounts.db");

const SCHEMA = `
create table if not exists users (
  id text primary key, provider text not null, subject text not null, name text, email text,
  created_at integer not null, last_login_at integer not null, unique (provider, subject));
create table if not exists sessions (
  token_hash text primary key, user_id text not null references users(id) on delete cascade,
  created_at integer not null, expires_at integer not null);
create index if not exists sessions_user on sessions(user_id);
create index if not exists sessions_expiry on sessions(expires_at);
create table if not exists user_state (
  user_id text primary key references users(id) on delete cascade, data text not null, updated_at integer not null);
create table if not exists conversations (
  id text primary key, user_id text not null references users(id) on delete cascade, title text not null, turns text not null,
  exchanges integer not null, search text not null, created_at integer not null, updated_at integer not null);
create index if not exists conversations_user on conversations(user_id, updated_at desc);
create table if not exists journeys (
  id text primary key, user_id text not null references users(id) on delete cascade, title text not null, route text not null,
  created_at integer not null, updated_at integer not null);
create index if not exists journeys_user on journeys(user_id, updated_at desc);
create table if not exists login_tx (
  id_hash text primary key, provider text not null, state text not null, nonce text not null, verifier text not null,
  return_to text not null, public_url text not null, expires_at integer not null);
create index if not exists login_tx_expiry on login_tx(expires_at);
create table if not exists spaces (
  name text primary key, visibility text not null check (visibility in ('open', 'private')), title text, archived_at integer, read_only integer not null default 0);
create table if not exists space_members (
  space text not null, user_id text not null, role text not null default 'owner' check (role in ('owner', 'member')), primary key (space, user_id));
create table if not exists space_invites (
  id text primary key, space text not null, token_hash text not null unique, role text not null check (role in ('owner', 'member')),
  created_by text not null, created_at integer not null, expires_at integer not null, used_at integer, used_by text);
create index if not exists space_invites_space on space_invites(space);
`;
/** The columns a database of an earlier version lacks (`create table if not exists` leaves its tables alone), added in place; then the indexes that name them. */
const MIGRATIONS = (db: Database) => {
  const has = (table: string, col: string) => (db.query(`pragma table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  db.transaction(() => {
    if (!has("space_members", "role")) {
      // before this version a space with member rows was private and one without was open: the rows were the whole rule, and they were the owners
      db.run("alter table space_members add column role text not null default 'owner' check (role in ('owner', 'member'))");
      db.run("insert or ignore into spaces (name, visibility) select distinct space, 'private' from space_members");
    }
  }).immediate();
};

/** Opens (and creates) the accounts database. Foreign keys are per connection: without the pragma `on delete cascade` does nothing. */
export function openAccounts(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run("pragma foreign_keys = on");
  db.run("pragma busy_timeout = 5000");
  db.run(SCHEMA);
  MIGRATIONS(db);
  for (const f of [path, `${path}-wal`, `${path}-shm`]) { try { chmodSync(f, 0o600); } catch {} }
  return db;
}

export const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
/** 32 random bytes, base64url: a session or transaction token. */
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export type User = { id: string; provider: string; subject: string; name: string | null; email: string | null };

/** The user of an identity `(provider, subject)`, created on the first sign-in; name and e-mail follow the provider. Never matched by e-mail. */
export function upsertUser(db: Database, provider: string, subject: string, name: string | null, email: string | null, now: number): User {
  const id = crypto.randomUUID();
  db.query("insert into users (id, provider, subject, name, email, created_at, last_login_at) values ($id, $provider, $subject, $name, $email, $now, $now) on conflict (provider, subject) do update set name = $name, email = $email, last_login_at = $now")
    .run({ id, provider, subject, name, email, now });
  return db.query("select id, provider, subject, name, email from users where provider = $provider and subject = $subject").get({ provider, subject }) as User;
}

/**
 * Deletes the account: the cascade removes its sessions, state, conversations and journeys, and its memberships go with it. The
 * last owner of a space cannot leave this way (the space would have nobody to administer it): the names of those spaces come back
 * and nothing is deleted; they archive the space or name another owner first.
 */
export const deleteUser = (db: Database, id: string): string[] => db.transaction(() => {
  const blocked = (db.query("select m.space from space_members m where m.user_id = $id and m.role = 'owner' and (select count(*) from space_members o where o.space = m.space and o.role = 'owner') = 1 order by m.space").all({ id }) as { space: string }[]).map((r) => r.space);
  if (blocked.length) return blocked;
  db.query("delete from space_members where user_id = $id").run({ id });
  db.query("delete from users where id = $id").run({ id });
  return [];
}).immediate();

// ---- sessions

export function createSession(db: Database, userId: string, tokenHash: string, now: number, ttlMs: number) {
  db.query("insert into sessions (token_hash, user_id, created_at, expires_at) values ($tokenHash, $userId, $now, $expires)").run({ tokenHash, userId, now, expires: now + ttlMs });
}
/** The user of a live session, and when it expires. */
export function sessionUser(db: Database, tokenHash: string, now: number): { user: User; expiresAt: number } | undefined {
  const r = db.query("select u.id, u.provider, u.subject, u.name, u.email, s.expires_at from sessions s join users u on u.id = s.user_id where s.token_hash = $tokenHash and s.expires_at > $now")
    .get({ tokenHash, now }) as (User & { expires_at: number }) | null;
  if (!r) return;
  const { expires_at, ...user } = r;
  return { user, expiresAt: expires_at };
}
export const extendSession = (db: Database, tokenHash: string, expiresAt: number) => { db.query("update sessions set expires_at = $expiresAt where token_hash = $tokenHash").run({ tokenHash, expiresAt }); };
export const deleteSession = (db: Database, tokenHash: string) => { db.query("delete from sessions where token_hash = $tokenHash").run({ tokenHash }); };

// ---- sign-in transactions (state, nonce and PKCE verifier of one login, bound to the browser by a short-lived cookie)

export type LoginTx = { provider: string; state: string; nonce: string; verifier: string; return_to: string; public_url: string };
/** A flood of unfinished logins cannot grow the table without bound: beyond this many live rows, the oldest go. */
const MAX_TX = 2000;
export function createTx(db: Database, idHash: string, tx: LoginTx, now: number, ttlMs: number) {
  db.query("insert into login_tx (id_hash, provider, state, nonce, verifier, return_to, public_url, expires_at) values ($idHash, $provider, $state, $nonce, $verifier, $return_to, $public_url, $expires)")
    .run({ idHash, ...tx, expires: now + ttlMs });
  db.query("delete from login_tx where id_hash in (select id_hash from login_tx order by expires_at desc limit -1 offset $max)").run({ max: MAX_TX });
}
/** Takes a transaction (single use: it is deleted whatever happens next). */
export function takeTx(db: Database, idHash: string, now: number): LoginTx | undefined {
  const r = db.query("select provider, state, nonce, verifier, return_to, public_url, expires_at from login_tx where id_hash = $idHash").get({ idHash }) as (LoginTx & { expires_at: number }) | null;
  db.query("delete from login_tx where id_hash = $idHash").run({ idHash });
  if (!r || r.expires_at <= now) return;
  const { expires_at, ...tx } = r;
  return tx;
}

/** Expired sessions and transactions, dropped now and then (no timer: a request does it when the last purge is old). */
export function purge(db: Database, now: number) {
  db.query("delete from sessions where expires_at <= $now").run({ now });
  db.query("delete from login_tx where expires_at <= $now").run({ now });
}

// ---- spaces: how visible a space is, who belongs to it, and who may administer it.
// A space with no row in `spaces` is open (that keeps the spaces of an instance that predates this table open). A private one is for its members alone,
// whatever happens to the rows: losing members never opens it. No foreign key on purpose: deleting an account must not open a private space either.

export type Visibility = "open" | "private";
export type Role = "owner" | "member";
export type SpaceRow = { name: string; visibility: Visibility; title: string | null; archived_at: number | null; read_only: boolean };

export const getSpace = (db: Database, name: string): SpaceRow | undefined => {
  const r = db.query("select name, visibility, title, archived_at, read_only from spaces where name = $name").get({ name }) as (Omit<SpaceRow, "read_only"> & { read_only: number }) | null;
  return r ? { ...r, read_only: !!r.read_only } : undefined;
};
export const spaceVisibility = (db: Database, name: string): Visibility => getSpace(db, name)?.visibility ?? "open";
/** Sets the visibility, the display title (null clears it) and/or the read-only state of a space; the first call for a space creates its row (open unless told). */
export function setSpace(db: Database, name: string, patch: { visibility?: Visibility; title?: string | null; read_only?: boolean }) {
  db.query("insert or ignore into spaces (name, visibility) values ($name, $visibility)").run({ name, visibility: patch.visibility ?? "open" });
  if (patch.visibility) db.query("update spaces set visibility = $v where name = $name").run({ name, v: patch.visibility });
  if (patch.title !== undefined) db.query("update spaces set title = $t where name = $name").run({ name, t: patch.title });
  if (patch.read_only !== undefined) db.query("update spaces set read_only = $r where name = $name").run({ name, r: patch.read_only ? 1 : 0 });
}

export type Member = { id: string; name: string | null; email: string | null; role: Role };
export const spaceMembers = (db: Database, space: string): Member[] =>
  db.query("select m.user_id as id, u.name, u.email, m.role from space_members m left join users u on u.id = m.user_id where m.space = $space order by m.role desc, coalesce(u.name, u.email, m.user_id), m.user_id").all({ space }) as Member[];
export const memberRole = (db: Database, space: string, userId: string): Role | undefined =>
  (db.query("select role from space_members where space = $space and user_id = $userId").get({ space, userId }) as { role: Role } | null)?.role;
/** Adds a member; someone already in the space keeps their role (use `setMemberRole`). */
export const addSpaceMember = (db: Database, space: string, userId: string, role: Role = "member") => { db.query("insert or ignore into space_members (space, user_id, role) values ($space, $userId, $role)").run({ space, userId, role }); };
/** Whether `userId` owns a space (an archived one has no member left). */
export const ownsASpace = (db: Database, userId: string) => !!db.query("select 1 from space_members where user_id = $userId and role = 'owner' limit 1").get({ userId });

/** `last-owner`: the change would leave the space without an owner (checked and written in one transaction). */
export type MemberChange = "ok" | "unknown" | "last-owner";
const owners = (db: Database, space: string) => (db.query("select count(*) as n from space_members where space = $space and role = 'owner'").get({ space }) as { n: number }).n;
export const setMemberRole = (db: Database, space: string, userId: string, role: Role): MemberChange => db.transaction((): MemberChange => {
  const cur = memberRole(db, space, userId);
  if (!cur) return "unknown";
  if (cur === "owner" && role !== "owner" && owners(db, space) === 1) return "last-owner";
  db.query("update space_members set role = $role where space = $space and user_id = $userId").run({ space, userId, role });
  return "ok";
}).immediate();
export const removeSpaceMember = (db: Database, space: string, userId: string): MemberChange => db.transaction((): MemberChange => {
  const cur = memberRole(db, space, userId);
  if (!cur) return "unknown";
  if (cur === "owner" && owners(db, space) === 1) return "last-owner";
  db.query("delete from space_members where space = $space and user_id = $userId").run({ space, userId });
  return "ok";
}).immediate();

/** Everything the accounts hold for a space name: a space created later under that name inherits nothing (people, visibility, title, invitations). */
export function forgetSpace(db: Database, name: string) {
  db.transaction(() => {
    for (const t of ["space_members", "space_invites", "spaces"]) db.query(`delete from ${t} where ${t === "spaces" ? "name" : "space"} = $name`).run({ name });
  }).immediate();
}
/** A user by id, else by e-mail (case-insensitive; an e-mail shared by several accounts is ambiguous: undefined, and `ambiguous` says so). */
export function findUser(db: Database, ref: string): { user?: User; ambiguous?: boolean } {
  const byId = db.query("select id, provider, subject, name, email from users where id = $ref").get({ ref }) as User | null;
  if (byId) return { user: byId };
  const rows = db.query("select id, provider, subject, name, email from users where lower(email) = lower($ref)").all({ ref }) as User[];
  return rows.length === 1 ? { user: rows[0] } : { ambiguous: rows.length > 1 };
}

// ---- preferences

export const getState = (db: Database, userId: string): { data: string; updated_at: number } | undefined =>
  (db.query("select data, updated_at from user_state where user_id = $userId").get({ userId }) as { data: string; updated_at: number } | null) ?? undefined;
export function putState(db: Database, userId: string, data: string, now: number) {
  db.query("insert into user_state (user_id, data, updated_at) values ($userId, $data, $now) on conflict (user_id) do update set data = $data, updated_at = $now").run({ userId, data, now });
}

// ---- conversations and journeys

export type Turn = { question: string; answer: string; pages?: string[]; at?: string };
export type ConversationRow = { id: string; title: string; turns: Turn[]; created_at: number; updated_at: number };
export type ConversationSummary = { id: string; title: string; exchanges: number; created_at: number; updated_at: number };
/** Lower-cased title and questions, what `?q=` looks into. */
export const searchText = (title: string, turns: Turn[]) => [title, ...turns.map((t) => t.question)].join("\n").toLowerCase();

export const countOf = (db: Database, table: "conversations" | "journeys", userId: string) =>
  (db.query(`select count(*) as n from ${table} where user_id = $userId`).get({ userId }) as { n: number }).n;

export function listConversations(db: Database, userId: string, words: string[]): ConversationSummary[] {
  const where = words.map((_, i) => `and instr(search, $w${i}) > 0`).join(" ");
  const params: Record<string, string> = { userId };
  words.forEach((w, i) => (params[`w${i}`] = w));
  return db.query(`select id, title, exchanges, created_at, updated_at from conversations where user_id = $userId ${where} order by updated_at desc, id`).all(params) as ConversationSummary[];
}
const toConversation = (r: { id: string; title: string; turns: string; created_at: number; updated_at: number }): ConversationRow => ({ ...r, turns: JSON.parse(r.turns) });
export const getConversation = (db: Database, userId: string, id: string): ConversationRow | undefined => {
  const r = db.query("select id, title, turns, created_at, updated_at from conversations where id = $id and user_id = $userId").get({ id, userId }) as Parameters<typeof toConversation>[0] | null;
  return r ? toConversation(r) : undefined;
};
export function insertConversation(db: Database, userId: string, title: string, turns: Turn[], now: number): ConversationRow {
  const id = crypto.randomUUID();
  db.query("insert into conversations (id, user_id, title, turns, exchanges, search, created_at, updated_at) values ($id, $userId, $title, $turns, $exchanges, $search, $now, $now)")
    .run({ id, userId, title, turns: JSON.stringify(turns), exchanges: turns.length, search: searchText(title, turns), now });
  return { id, title, turns, created_at: now, updated_at: now };
}
export function updateConversation(db: Database, userId: string, id: string, title: string, turns: Turn[], now: number): ConversationRow | undefined {
  const r = db.query("update conversations set title = $title, turns = $turns, exchanges = $exchanges, search = $search, updated_at = $now where id = $id and user_id = $userId")
    .run({ id, userId, title, turns: JSON.stringify(turns), exchanges: turns.length, search: searchText(title, turns), now });
  return r.changes ? getConversation(db, userId, id) : undefined;
}
export const deleteConversation = (db: Database, userId: string, id: string) => db.query("delete from conversations where id = $id and user_id = $userId").run({ id, userId }).changes > 0;

export type JourneyRow = { id: string; title: string; route: string[]; created_at: number; updated_at: number };
const toJourney = (r: { id: string; title: string; route: string; created_at: number; updated_at: number }): JourneyRow => ({ ...r, route: JSON.parse(r.route) });
export const listJourneys = (db: Database, userId: string): JourneyRow[] =>
  (db.query("select id, title, route, created_at, updated_at from journeys where user_id = $userId order by updated_at desc, id").all({ userId }) as Parameters<typeof toJourney>[0][]).map(toJourney);
export const getJourney = (db: Database, userId: string, id: string): JourneyRow | undefined => {
  const r = db.query("select id, title, route, created_at, updated_at from journeys where id = $id and user_id = $userId").get({ id, userId }) as Parameters<typeof toJourney>[0] | null;
  return r ? toJourney(r) : undefined;
};
export function insertJourney(db: Database, userId: string, title: string, route: string[], now: number): JourneyRow {
  const id = crypto.randomUUID();
  db.query("insert into journeys (id, user_id, title, route, created_at, updated_at) values ($id, $userId, $title, $route, $now, $now)").run({ id, userId, title, route: JSON.stringify(route), now });
  return { id, title, route, created_at: now, updated_at: now };
}
export function updateJourney(db: Database, userId: string, id: string, title: string, route: string[], now: number): JourneyRow | undefined {
  const r = db.query("update journeys set title = $title, route = $route, updated_at = $now where id = $id and user_id = $userId").run({ id, userId, title, route: JSON.stringify(route), now });
  return r.changes ? getJourney(db, userId, id) : undefined;
}
export const deleteJourney = (db: Database, userId: string, id: string) => db.query("delete from journeys where id = $id and user_id = $userId").run({ id, userId }).changes > 0;
