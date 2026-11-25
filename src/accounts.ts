import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The accounts' storage (`cortex serve`): users, sessions, preferences, saved assistant conversations and graph journeys, in
 * one SQLite file, `.cortex/accounts.db` of the wiki root. Never under `.cortex/serve/`: serve empties one of its two build
 * folders at each rebuild. `.cortex/` is not versioned (serve --sync commits `raw/` and `wiki/` only).
 *
 * Every read and write of user data is filtered by `user_id`: another user's row is simply not found (the routes answer 404).
 * Times are milliseconds since the epoch; the API turns them into ISO strings.
 */
export const accountsFile = (root: string) => join(root, ".cortex/accounts.db");

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
`;

/** Opens (and creates) the accounts database. Foreign keys are per connection: without the pragma `on delete cascade` does nothing. */
export function openAccounts(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run("pragma foreign_keys = on");
  db.run("pragma busy_timeout = 5000");
  db.run(SCHEMA);
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

/** Deletes the account: the cascade removes its sessions, state, conversations and journeys. */
export const deleteUser = (db: Database, id: string) => { db.query("delete from users where id = $id").run({ id }); };

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
