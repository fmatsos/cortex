import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCOUNT_LIMITS, SESSION_DAYS, accountRoute, safeReturn } from "./account-api";
import { accountsFile, addSpaceMember, openAccounts, sha256 } from "./accounts";
import { lintConfig, type Config } from "./config";
import { serve } from "./serve";

// ---- a fake OpenID provider (discovery, authorize, token, JWKS, userinfo): no real provider is ever contacted ----

const b64u = (b: ArrayBuffer | Uint8Array | string) => (typeof b === "string" ? Buffer.from(b) : Buffer.from(new Uint8Array(b))).toString("base64url");
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
type Mode = "ok" | "other-key" | "wrong-nonce" | "expired" | "wrong-audience";
class Issuer {
  keys!: CryptoKeyPair; attacker!: CryptoKeyPair; jwk!: JsonWebKey & { kid: string };
  codes = new Map<string, { challenge: string; redirect: string; nonce: string; claims: Record<string, unknown> }>();
  /** Claims of the next person who signs in, and how the next ID token is broken (if at all). */
  claims: Record<string, unknown> = { sub: "u1", name: "Ada", email: "ada@example.org" };
  userinfo: Record<string, unknown> = {};
  mode: Mode = "ok";
  tokenCalls: URLSearchParams[] = [];
  constructor(readonly issuer: string, readonly clientId = "cortex", readonly secret = "s3cret") {}
  async init() {
    this.keys = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
    this.attacker = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
    this.jwk = { ...(await crypto.subtle.exportKey("jwk", this.keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    return this;
  }
  private async idToken(c: { nonce: string; claims: Record<string, unknown> }) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: this.issuer, aud: this.mode === "wrong-audience" ? "other" : this.clientId, iat: now, exp: this.mode === "expired" ? now - 600 : now + 300, nonce: this.mode === "wrong-nonce" ? "nope" : c.nonce, ...c.claims };
    const input = `${b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))}.${b64u(JSON.stringify(payload))}`;
    // the "other key" token is well formed, carries the real `kid`, and is signed by a key the JWKS does not hold
    const key = (this.mode === "other-key" ? this.attacker : this.keys).privateKey;
    return `${input}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)))}`;
  }
  handle = async (req: Request): Promise<Response> => {
    const u = new URL(req.url), path = u.pathname;
    if (path === "/.well-known/openid-configuration") return Response.json({
      issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`, userinfo_endpoint: `${this.issuer}/userinfo`,
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_basic"], code_challenge_methods_supported: ["S256"], response_types_supported: ["code"], subject_types_supported: ["public"],
    });
    if (path === "/jwks") return Response.json({ keys: [this.jwk] });
    if (path === "/authorize") { // what the browser does after the person signed in
      const q = u.searchParams;
      if (q.get("client_id") !== this.clientId || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge") || !q.get("state") || !q.get("nonce") || !(q.get("scope") ?? "").split(" ").includes("openid"))
        return new Response("bad authorization request", { status: 400 });
      const code = crypto.randomUUID();
      this.codes.set(code, { challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")!, nonce: q.get("nonce")!, claims: this.claims });
      return new Response(null, { status: 302, headers: { location: `${q.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(q.get("state")!)}` } });
    }
    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      this.tokenCalls.push(form);
      const [id, secret] = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Basic /, ""), "base64").toString().split(":").map(decodeURIComponent);
      const bad = (error: string) => Response.json({ error }, { status: 400 });
      if (id !== this.clientId || secret !== this.secret) return Response.json({ error: "invalid_client" }, { status: 401 });
      const c = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (form.get("grant_type") !== "authorization_code" || !c || form.get("redirect_uri") !== c.redirect) return bad("invalid_grant");
      if (b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? ""))) !== c.challenge) return bad("invalid_grant");
      return Response.json({ access_token: "at-" + crypto.randomUUID(), token_type: "Bearer", expires_in: 300, id_token: await this.idToken(c) });
    }
    if (path === "/userinfo") return req.headers.get("authorization")?.startsWith("Bearer at-") ? Response.json({ sub: this.claims.sub, ...this.userinfo }) : new Response(null, { status: 401 });
    return new Response("not found", { status: 404 });
  };
}

/** GitHub's side of OAuth2: authorize, access_token (JSON only with `Accept`), and `GET /user` (needs a User-Agent). */
class Github {
  codes = new Map<string, { challenge: string; redirect: string }>();
  user: Record<string, unknown> = { id: 12345, login: "ada", name: "Ada", email: null };
  handle = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    if (u.host === "github.com" && u.pathname === "/login/oauth/authorize") {
      const code = crypto.randomUUID();
      this.codes.set(code, { challenge: u.searchParams.get("code_challenge") ?? "", redirect: u.searchParams.get("redirect_uri") ?? "" });
      return new Response(null, { status: 302, headers: { location: `${u.searchParams.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(u.searchParams.get("state")!)}` } });
    }
    if (u.host === "github.com" && u.pathname === "/login/oauth/access_token") {
      const form = new URLSearchParams(await req.text()), c = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (!c || form.get("client_secret") !== "gh-secret" || form.get("client_id") !== "gh-client" || form.get("redirect_uri") !== c.redirect || req.headers.get("accept") !== "application/json") return Response.json({ error: "bad_verification_code" }, { status: 400 });
      if (b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? ""))) !== c.challenge) return Response.json({ error: "bad_verification_code" }, { status: 400 });
      return Response.json({ access_token: "gho_tok", token_type: "bearer", scope: "" });
    }
    if (u.host === "api.github.com" && u.pathname === "/user") {
      return req.headers.get("authorization") === "Bearer gho_tok" && req.headers.get("user-agent") ? Response.json(this.user) : new Response(null, { status: 403 });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---- a browser: cookies kept with their paths, redirects followed by hand ----

type Send = (req: Request) => Promise<Response>;
class Browser {
  jar = new Map<string, { value: string; path: string }>();
  setCookies: string[] = [];
  constructor(readonly send: Send, readonly base: string, readonly origin: string | undefined = base, readonly headers: Record<string, string> = {}) {}
  async req(path: string, init: { method?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}): Promise<Response> {
    const url = new URL(path, this.base);
    const cookie = [...this.jar].filter(([, c]) => url.pathname === c.path || url.pathname.startsWith(c.path.endsWith("/") ? c.path : c.path + "/")).map(([n, c]) => `${n}=${c.value}`).join("; ");
    const method = init.method ?? "GET", origin = init.origin === undefined ? this.origin : init.origin;
    const headers: Record<string, string> = { ...this.headers, ...(cookie ? { cookie } : {}), ...(origin && method !== "GET" ? { origin } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers };
    const res = await this.send(new Request(url, { method, headers, redirect: "manual", body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) }));
    for (const sc of res.headers.getSetCookie()) {
      this.setCookies.push(sc);
      const [pair, ...attrs] = sc.split(/;\s*/), eq = pair!.indexOf("="), name = pair!.slice(0, eq);
      const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k.toLowerCase()}=`))?.split("=")[1];
      if (attr("Max-Age") === "0") this.jar.delete(name); else this.jar.set(name, { value: pair!.slice(eq + 1), path: attr("Path") ?? "/" });
    }
    return res;
  }
  /** The whole sign-in: login → the provider's authorize page → callback. Returns the last redirection (Location) and the provider-side URL. */
  async signIn(provider: string, ret?: string, via: (u: URL) => Promise<Response> = (u) => this.req(u.href)) {
    const login = await this.req(`/api/auth/login/${provider}${ret === undefined ? "" : `?return=${encodeURIComponent(ret)}`}`);
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    const back = await via(authorize);
    expect(back.status).toBe(302);
    const callback = new URL(back.headers.get("location")!);
    const done = await this.req(callback.pathname + callback.search);
    return { login, authorize, back, done, location: new URL(done.headers.get("location")!) };
  }
  json = async (path: string, init?: Parameters<Browser["req"]>[1]) => { const r = await this.req(path, init); return { status: r.status, body: await r.json().catch(() => undefined) as any, res: r }; };
}

// ---- fixtures ----

const ORIGIN = "https://cortex.test", ORIGIN2 = "https://cortex.alt.test";
const wikiRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-accounts-"));
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "wiki/concepts/idee.md"), `---\ntype: Concept\ntitle: "Idée"\nstatus: draft\n---\n\nCorps.\n`);
  return root;
};
const ENV = { CORTEX_OIDC_CLIENT_SECRET: "s3cret", CORTEX_GITHUB_CLIENT_SECRET: "gh-secret", CORTEX_GOOGLE_CLIENT_SECRET: "g-secret" };

type App = Awaited<ReturnType<typeof setup>>;
async function setup(auth: Config["auth"] = {}, env: Record<string, string | undefined> = ENV) {
  const root = wikiRoot(), logs: string[] = [];
  const oidc = await new Issuer("https://auth.test").init(), google = await new Issuer("https://accounts.google.com", "g-client", "g-secret").init(), github = new Github();
  const clock = { t: Date.now() };
  let cfg: Config = { auth: { public_urls: [ORIGIN, ORIGIN2], ...auth } };
  const net = { fetch: ((input: any, init?: any) => {
    const req = new Request(input, init), host = new URL(req.url).host;
    if (host === "auth.test") return oidc.handle(req);
    if (host === "accounts.google.com") return google.handle(req);
    if (host === "github.com" || host === "api.github.com") return github.handle(req);
    throw new Error(`unexpected request to ${req.url}`);
  }) as unknown as typeof fetch };
  const route = accountRoute({ root, say: (m) => logs.push(m), config: async () => cfg, env, net, now: () => clock.t, titles: async () => new Map([["concepts/idee", "Idée"]]) });
  // `/s/<space>/…` is what a multi-space serve hands over after its visibility check: the account routes of that space
  const send: Send = async (req) => {
    const at = /^\/s\/([a-z0-9-]+)(\/.*)$/.exec(new URL(req.url).pathname);
    return (await route(req, at ? { space: at[1]!, path: at[2]! } : undefined)) ?? new Response("not an account route", { status: 599 });
  };
  const browser = (headers: Record<string, string> = {}) => new Browser(send, ORIGIN, ORIGIN, headers);
  return { root, logs, oidc, google, github, clock, send, browser, setConfig: (c: Config) => (cfg = c), db: () => new Database(accountsFile(root), { readonly: true }) };
}
const OIDC = { label: "Authelia", issuer: "https://auth.test", client_id: "cortex" };
const ALL: Config["auth"] = { oidc: { ...OIDC, groups: ["app-cortex"] }, github: { client_id: "gh-client", allow: [12345] }, google: { client_id: "g-client", allow: ["ada@example.org"] } };
const through = (issuer: { handle: Send }) => (u: URL) => issuer.handle(new Request(u));
const ada = (a: App) => { a.oidc.claims = { sub: "u1", name: "Ada", email: "ada@example.org", groups: ["app-cortex", "other"] }; };
const signInAs = async (a: App, who: string, claims: Record<string, unknown> = {}) => {
  const b = a.browser();
  a.oidc.claims = { sub: who, name: who, email: `${who}@example.org`, groups: ["app-cortex"], ...claims };
  const r = await b.signIn("oidc", "/", through(a.oidc));
  expect(r.location.searchParams.get("auth")).toBeNull();
  return b;
};

// ---- configuration ----

test("auth in cortex.json: strict, with clear errors", () => {
  const ok = { public_urls: [ORIGIN], oidc: { ...OIDC, groups: ["g"] }, github: { client_id: "x", allow: [1] }, google: { client_id: "y", allow: ["a@b.c"] } };
  expect(lintConfig({ auth: ok })).toEqual([]);
  expect(lintConfig({ auth: { public_urls: ["http://localhost:8081"] } })[0]!.level).toBe("warning"); // plain http: cookie not Secure
  const msg = (auth: unknown) => { const i = lintConfig({ auth }); expect(i[0]?.level).toBe("error"); return i.map((x) => x.msg).join(" | "); };
  expect(msg({ ...ok, bogus: 1 })).toContain('unknown property "bogus" in "auth"');
  expect(msg({ ...ok, oidc: { ...OIDC, client_secret: "x" } })).toContain("$CORTEX_OIDC_CLIENT_SECRET");
  expect(msg({ ...ok, github: { client_id: "x", allow: [1], client_secret: "x" } })).toContain("$CORTEX_GITHUB_CLIENT_SECRET");
  expect(msg({ ...ok, oidc: { ...OIDC, isuer: "x" } })).toContain('in "auth.oidc" (label, issuer, client_id, groups)'); // not the root key list
  expect(msg({ oidc: OIDC })).toContain("auth.public_urls");
  expect(msg({ ...ok, public_urls: ["https://x.test/sub"] })).toContain("origin only");
  expect(msg({ ...ok, public_urls: ["cortex.test"] })).toContain("not a URL");
  expect(msg({ ...ok, public_urls: ["ftp://x.test"] })).toContain("https://");
  expect(msg({ ...ok, oidc: { ...OIDC, issuer: "http://auth.example" } })).toContain("https://");
  expect(lintConfig({ auth: { ...ok, oidc: { ...OIDC, issuer: "http://localhost:9000" } } })).toEqual([]); // a local issuer
  expect(msg({ ...ok, github: { client_id: "x", allow: [] } })).toContain("at least one entry");
  expect(msg({ ...ok, github: { client_id: "x", allow: ["ada"] } })).toContain("numeric GitHub user ids");
  expect(msg({ ...ok, google: { client_id: "y", allow: ["not an email"] } })).toContain("e-mail");
  expect(msg({ ...ok, oidc: { ...OIDC, groups: [] } })).toContain("at least one entry");
  expect(msg("yes")).toContain('"auth" must be an object');
});

// ---- providers and sign-in ----

test("methods: only the configured providers with their secret; always an answer, never a cache", async () => {
  const a = await setup(ALL);
  const b = a.browser();
  const r = await b.json("/api/auth/methods");
  expect(r.body).toEqual({ providers: [{ id: "oidc", label: "Authelia" }, { id: "github", label: "GitHub" }, { id: "google", label: "Google" }] });
  expect(r.res.headers.get("cache-control")).toBe("no-store");
  // a provider without its secret in the environment is not offered (and the log says why); the others still are
  const nosecret = await setup(ALL, { CORTEX_GITHUB_CLIENT_SECRET: "x" });
  expect((await nosecret.browser().json("/api/auth/methods")).body).toEqual({ providers: [{ id: "github", label: "GitHub" }] });
  expect(nosecret.logs.join("\n")).toContain("$CORTEX_OIDC_CLIENT_SECRET");
  // no auth block, an invalid cortex.json: no provider, serve keeps answering
  const none = await setup(undefined, {});
  none.setConfig({});
  expect((await none.browser().json("/api/auth/methods")).body).toEqual({ providers: [] });
  none.setConfig({ auth: { oidc: OIDC } }); // no public_urls: nothing can sign in
  expect((await none.browser().json("/api/auth/methods")).body).toEqual({ providers: [] });
  expect((await none.browser().req("/api/auth/login/oidc")).status).toBe(404);
  expect((await a.browser().req("/api/auth/login/facebook")).status).toBe(404);
  expect((await a.browser().req("/api/auth/methods", { method: "POST" })).status).toBe(405);
  expect((await a.browser().req("/api/auth/methods", { method: "POST", origin: "https://evil.example" })).status).toBe(403); // Origin is checked first
  expect((await a.browser().req("/api/auth/nothing")).status).toBe(404);
});

test("OIDC: state, nonce and PKCE are sent, the session cookie is HttpOnly + SameSite=Lax, only its hash is stored, logout deletes it", async () => {
  const a = await setup(ALL);
  ada(a);
  const b = a.browser();
  const r = await b.signIn("oidc", "/wiki/concepts/idee/?q=1#top", through(a.oidc));
  // what the provider was told
  expect(r.authorize.origin + r.authorize.pathname).toBe("https://auth.test/authorize");
  const q = r.authorize.searchParams;
  expect(q.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/oidc`); // built from the configured URL
  expect(q.get("scope")).toBe("openid profile email groups");
  expect(q.get("code_challenge_method")).toBe("S256");
  expect(q.get("state")!.length).toBeGreaterThanOrEqual(32);
  expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(32);
  expect(a.oidc.tokenCalls[0]!.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);
  // the transaction cookie: short, restricted to the callback, bound to the browser
  const tx = r.login.headers.getSetCookie()[0]!;
  expect(tx).toStartWith("__Secure-cortex_login=");
  for (const attr of ["Path=/api/auth/callback/oidc", "Max-Age=600", "HttpOnly", "SameSite=Lax", "Secure"]) expect(tx).toContain(attr);
  // back on the site, signed in
  expect(r.location.href).toBe(`${ORIGIN}/wiki/concepts/idee/?q=1#top`);
  const session = r.done.headers.getSetCookie().find((c) => c.includes("cortex_session"))!;
  expect(session).toStartWith("__Host-cortex_session=");
  for (const attr of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure", `Max-Age=${SESSION_DAYS * 86_400}`]) expect(session).toContain(attr);
  expect(session).not.toContain("Domain");
  expect(r.done.headers.getSetCookie().some((c) => c.startsWith("__Secure-cortex_login=;") && c.includes("Max-Age=0"))).toBe(true); // the transaction cookie goes away
  expect(b.jar.has("__Secure-cortex_login")).toBe(false);
  const me = await b.json("/api/me");
  expect(me.body).toMatchObject({ name: "Ada", email: "ada@example.org", provider: "oidc" });
  expect(Object.keys(me.body).sort()).toEqual(["email", "id", "name", "provider"]);
  // only the SHA-256 of the token is in the database
  const token = b.jar.get("__Host-cortex_session")!.value, rows = a.db().query("select token_hash from sessions").all() as { token_hash: string }[];
  expect(Buffer.from(token, "base64url").length).toBe(32);
  expect(rows.map((x) => x.token_hash)).toEqual([sha256(token)]);
  // logout: the row and the cookie are gone
  const out = await b.req("/api/auth/logout", { method: "POST" });
  expect(out.status).toBe(200);
  expect((a.db().query("select count(*) as n from sessions").get() as { n: number }).n).toBe(0);
  expect((await b.json("/api/me")).status).toBe(401);
  const stolen = new Browser(a.send, ORIGIN); stolen.jar.set("__Host-cortex_session", { value: token, path: "/" });
  expect((await stolen.json("/api/me")).status).toBe(401); // the old cookie value no longer opens anything
});

test("the redirect URI and the cookies follow the configured public URL that matches the request, never the request itself", async () => {
  const a = await setup(ALL);
  ada(a);
  // the second domain, named by the proxy's forwarded host
  const alt = a.browser({ "x-forwarded-host": "cortex.alt.test" });
  const r = await alt.signIn("oidc", "/", through(a.oidc));
  expect(r.authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN2}/api/auth/callback/oidc`);
  expect(r.location.origin).toBe(ORIGIN2);
  // an unknown host, a spoofed scheme or a hostile Host: the first configured URL
  for (const h of [{ "x-forwarded-host": "evil.example" }, { host: "evil.example", "x-forwarded-proto": "http" }, { origin: "https://evil.example" }] as Record<string, string>[]) {
    const b = a.browser(h), l = await b.req("/api/auth/login/oidc");
    expect(new URL(new URL(l.headers.get("location")!).searchParams.get("redirect_uri")!).origin).toBe(ORIGIN);
  }
  // a plain-http public URL: the cookie is not Secure and not __Host- (the setting comes from the URL, not from the request)
  a.setConfig({ auth: { ...ALL, public_urls: ["http://localhost:8081"] } });
  const http = new Browser(a.send, "http://localhost:8081", "http://localhost:8081");
  const h = await http.signIn("oidc", "/", through(a.oidc));
  const cookie = h.done.headers.getSetCookie().find((c) => c.startsWith("cortex_session="))!;
  expect(cookie).not.toContain("Secure");
  expect(cookie).toContain("HttpOnly");
  expect(h.location.origin).toBe("http://localhost:8081");
});

test("OIDC refusals and failures: a group missing, a signature by another key, a wrong nonce or audience, an expired token, a state mismatch, a replay: no session, no detail", async () => {
  const a = await setup(ALL);
  const attempt = async (claims: Record<string, unknown>, mode: Mode = "ok", tamper?: (cb: URL) => void) => {
    a.oidc.mode = mode;
    a.oidc.claims = { sub: "x", name: "X", email: "x@example.org", groups: ["app-cortex"], ...claims };
    const b = a.browser();
    const login = await b.req("/api/auth/login/oidc?return=/wiki/");
    const back = await a.oidc.handle(new Request(login.headers.get("location")!));
    const cb = new URL(back.headers.get("location")!);
    tamper?.(cb);
    const done = await b.req(cb.pathname + cb.search);
    const loc = new URL(done.headers.get("location")!);
    expect(done.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe(`${ORIGIN}/wiki/`);
    expect([...loc.searchParams.keys()]).toEqual(["auth"]); // nothing but the verdict
    expect(done.headers.getSetCookie().some((c) => c.includes("cortex_session"))).toBe(false);
    expect((await b.json("/api/me")).status).toBe(401);
    return { auth: loc.searchParams.get("auth"), b, cb, done };
  };
  expect((await attempt({ groups: ["somebody-else"] })).auth).toBe("refused");
  expect((await attempt({ groups: undefined })).auth).toBe("refused");
  expect((await attempt({}, "other-key")).auth).toBe("error"); // well-formed, right kid, signed by a key the JWKS does not hold
  expect((await attempt({}, "wrong-nonce")).auth).toBe("error");
  expect((await attempt({}, "wrong-audience")).auth).toBe("error");
  expect((await attempt({}, "expired")).auth).toBe("error");
  expect((await attempt({}, "ok", (cb) => cb.searchParams.set("state", "forged"))).auth).toBe("error");
  expect((await attempt({}, "ok", (cb) => { cb.searchParams.delete("code"); cb.searchParams.set("error", "access_denied"); })).auth).toBe("error");
  // a callback without the browser's transaction cookie (another browser, an expired cookie)
  a.oidc.mode = "ok";
  const b = a.browser(), l = await b.req("/api/auth/login/oidc");
  const cb = new URL((await a.oidc.handle(new Request(l.headers.get("location")!))).headers.get("location")!);
  b.jar.clear();
  expect(new URL((await b.req(cb.pathname + cb.search)).headers.get("location")!).searchParams.get("auth")).toBe("error");
  // the log tells the operator why, the site is never told
  expect(a.logs.join("\n")).toContain("is in none of auth.oidc.groups");
  // a good login after all that works, and replaying its callback does not
  const good = a.browser();
  a.oidc.claims = { sub: "ok", name: "Ok", groups: ["app-cortex"] };
  const first = await good.signIn("oidc", "/", through(a.oidc));
  expect(first.location.searchParams.get("auth")).toBeNull();
  const replay = await a.browser().req(first.back.headers.get("location")!.replace(ORIGIN, ""));
  expect(new URL(replay.headers.get("location")!).searchParams.get("auth")).toBe("error");
  expect(a.db().query("select count(*) as n from login_tx").get()).toEqual({ n: 1 }); // every callback consumed its transaction; only the login that never came back is left (it expires)
});

test("OIDC: groups kept out of the ID token are read from userinfo; without a groups option nobody is filtered", async () => {
  const a = await setup({ oidc: { ...OIDC, groups: ["app-cortex"] } });
  a.oidc.claims = { sub: "g1", name: "G" };
  a.oidc.userinfo = { groups: ["app-cortex"] };
  expect((await a.browser().signIn("oidc", "/", through(a.oidc))).location.searchParams.get("auth")).toBeNull();
  a.oidc.userinfo = { groups: ["nope"] };
  expect((await a.browser().signIn("oidc", "/", through(a.oidc))).location.searchParams.get("auth")).toBe("refused");
  a.setConfig({ auth: { public_urls: [ORIGIN], oidc: OIDC } });
  a.oidc.claims = { sub: "g2" };
  const open = a.browser(), r = await open.signIn("oidc", "/", through(a.oidc));
  expect(r.authorize.searchParams.get("scope")).toBe("openid profile email"); // no `groups` scope asked when no group is required
  expect(r.location.searchParams.get("auth")).toBeNull();
  expect((await open.json("/api/me")).body.name).toBeNull();
});

test("GitHub: OAuth2 with PKCE, the allow list is on the numeric id", async () => {
  const a = await setup(ALL);
  const b = a.browser(), r = await b.signIn("github", "/", through(a.github));
  expect(r.authorize.origin + r.authorize.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(r.authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/github`);
  expect(r.authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(r.authorize.searchParams.has("nonce")).toBe(false);
  expect(r.location.searchParams.get("auth")).toBeNull();
  expect((await b.json("/api/me")).body).toMatchObject({ name: "Ada", provider: "github", email: null });
  // another id, even with an allowed login: refused
  a.github.user = { id: 999, login: "ada", name: "Impostor" };
  const x = a.browser(), refused = await x.signIn("github", "/", through(a.github));
  expect(refused.location.searchParams.get("auth")).toBe("refused");
  expect((await x.json("/api/me")).status).toBe(401);
  expect(a.logs.join("\n")).toContain("github id 999");
  // a failure at GitHub (bad token response) is an error, not a session
  a.github.user = { id: 12345 };
  const err = a.browser(), l = await err.req("/api/auth/login/github"), c = new URL((await a.github.handle(new Request(l.headers.get("location")!))).headers.get("location")!);
  c.searchParams.set("code", "unknown");
  expect(new URL((await err.req(c.pathname + c.search)).headers.get("location")!).searchParams.get("auth")).toBe("error");
});

test("Google: OIDC, the e-mail must be verified and in the list", async () => {
  const a = await setup(ALL);
  const sign = async (claims: Record<string, unknown>) => {
    a.google.claims = { sub: "g-1", name: "Ada", email: "Ada@Example.org", email_verified: true, ...claims };
    const b = a.browser(), r = await b.signIn("google", "/", through(a.google));
    return { b, r, auth: r.location.searchParams.get("auth") };
  };
  const ok = await sign({});
  expect(ok.auth).toBeNull(); // the comparison ignores case
  expect(ok.r.authorize.searchParams.get("scope")).toBe("openid profile email");
  expect((await ok.b.json("/api/me")).body.provider).toBe("google");
  expect((await sign({ email_verified: false })).auth).toBe("refused");
  expect((await sign({ email_verified: undefined })).auth).toBe("refused");
  expect((await sign({ email: "mallory@example.org" })).auth).toBe("refused");
  a.google.mode = "other-key";
  expect((await sign({})).auth).toBe("error");
});

test("no linking between providers: the same e-mail on two providers is two accounts, each with its own data", async () => {
  const a = await setup(ALL);
  const viaOidc = await signInAs(a, "same", { email: "ada@example.org" });
  a.google.claims = { sub: "g-same", name: "Ada", email: "ada@example.org", email_verified: true };
  const viaGoogle = a.browser();
  await viaGoogle.signIn("google", "/", through(a.google));
  const ids = [(await viaOidc.json("/api/me")).body.id, (await viaGoogle.json("/api/me")).body.id];
  expect(ids[0]).not.toBe(ids[1]);
  await viaOidc.json("/api/me/state", { method: "PUT", body: { theme: "dark" } });
  expect((await viaGoogle.json("/api/me/state")).body).toEqual({});
  // the same identity signing in again is the same account
  const again = await signInAs(a, "same");
  expect((await again.json("/api/me")).body.id).toBe(ids[0]);
  expect((a.db().query("select count(*) as n from users").get() as { n: number }).n).toBe(2);
});

test("return: only a path of this site; everything else becomes /", async () => {
  for (const [r, want] of [
    ["/wiki/a/", "/wiki/a/"], ["/search/?q=a%20b#x", "/search/?q=a%20b#x"], ["/", "/"],
    [null, "/"], ["", "/"], ["wiki/a", "/"], ["//evil.example", "/"], ["//evil.example/x", "/"], ["https://evil.example", "/"], ["/\\evil.example", "/"],
    ["/%5Cevil.example", "/%5Cevil.example"], ["/\t/evil.example", "/"], ["/\n/evil.example", "/"], ["javascript:alert(1)", "/"], ["/api/me", "/"], ["/api/auth/login/oidc", "/"],
  ] as const) expect(safeReturn(r, ORIGIN)).toBe(want);
  // the stored value is what the redirection uses
  const a = await setup(ALL);
  ada(a);
  for (const hostile of ["//evil.example", "https://evil.example/", "/\\evil.example", "/%2F%2Fevil.example"]) {
    const loc = (await a.browser().signIn("oidc", hostile, through(a.oidc))).location;
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname + loc.search).not.toContain("evil.example/"); // a path on this site at worst
    expect(loc.host).not.toContain("evil");
  }
  expect((await a.browser().signIn("oidc", "//evil.example", through(a.oidc))).location.href).toBe(`${ORIGIN}/`);
});

// ---- the signed-in routes ----

test("Origin: every state-changing request needs one of the site's origins, signed in or not; GET needs none", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "o1");
  const writes: [string, string, unknown?][] = [
    ["POST", "/api/auth/logout"], ["PUT", "/api/me/state", {}], ["DELETE", "/api/me"], ["POST", "/api/conversations", { turns: [{ question: "q", answer: "a" }] }],
    ["PUT", "/api/conversations/x", { title: "t" }], ["DELETE", "/api/conversations/x"], ["POST", "/api/journeys", { route: ["a"] }], ["PUT", "/api/journeys/x", { title: "t" }], ["DELETE", "/api/journeys/x"], ["PATCH", "/api/me"],
  ];
  for (const [method, path, body] of writes) {
    for (const origin of [null, "null", "https://evil.example", "http://cortex.test", `${ORIGIN}.evil.example`]) expect((await b.req(path, { method, body, origin })).status).toBe(403);
    expect((await a.browser().req(path, { method, body, origin: "https://evil.example" })).status).toBe(403); // also when not signed in
  }
  expect((await b.json("/api/me")).status).toBe(200); // nothing was deleted by the refused requests
  expect((await b.req("/api/me/state", { method: "PUT", body: { a: 1 }, origin: ORIGIN2 })).status).toBe(200); // the other domain is one of the site's
  expect((await b.req("/api/me", { method: "HEAD" })).status).toBe(200);
});

test("without a session every account route answers 401", async () => {
  const a = await setup(ALL);
  const b = a.browser();
  for (const [method, path] of [["GET", "/api/me"], ["DELETE", "/api/me"], ["GET", "/api/me/state"], ["PUT", "/api/me/state"], ["GET", "/api/conversations"], ["POST", "/api/conversations"], ["GET", "/api/conversations/x"],
    ["DELETE", "/api/conversations/x"], ["GET", "/api/journeys"], ["POST", "/api/journeys"], ["PUT", "/api/journeys/x"], ["GET", "/api/me/whatever/more"]] as const)
    expect((await b.req(path, { method, body: method === "GET" ? undefined : {} })).status).toBe(401);
  const forged = new Browser(a.send, ORIGIN); forged.jar.set("__Host-cortex_session", { value: "x".repeat(43), path: "/" });
  expect((await forged.json("/api/me")).status).toBe(401);
});

test("the session slides (renewed at most once a day) and expires", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "s1");
  const DAY = 86_400_000;
  const token = b.jar.get("__Host-cortex_session")!.value;
  const expiry = () => (a.db().query("select expires_at from sessions").get() as { expires_at: number }).expires_at;
  const first = expiry();
  expect((await b.req("/api/me")).headers.getSetCookie()).toEqual([]); // used within the day: nothing renewed
  a.clock.t += 5 * DAY;
  const renewed = await b.req("/api/me");
  expect(renewed.headers.getSetCookie()[0]).toContain(`__Host-cortex_session=${token}`);
  expect(expiry()).toBe(a.clock.t + SESSION_DAYS * DAY);
  expect(expiry()).toBeGreaterThan(first);
  a.clock.t += SESSION_DAYS * DAY - 1000;
  expect((await b.json("/api/me")).status).toBe(200);
  a.clock.t += SESSION_DAYS * DAY + 1000; // unused for 14 days
  expect((await b.json("/api/me")).status).toBe(401);
  a.clock.t += 3_700_000; // the purge, opportunistic
  await b.req("/api/me");
  expect((a.db().query("select count(*) as n from sessions").get() as { n: number }).n).toBe(0);
});

test("preferences: a JSON object of bounded size", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "p1");
  expect((await b.json("/api/me/state")).body).toEqual({});
  const prefs = { theme: "dark", language: "fr", favorites: ["concepts/idee"], nested: { a: [1, 2] } };
  expect((await b.json("/api/me/state", { method: "PUT", body: prefs })).status).toBe(200);
  const got = await b.json("/api/me/state");
  expect(got.body).toEqual(prefs);
  expect(got.res.headers.get("last-modified")).toBeTruthy();
  expect((await b.json("/api/me/state", { method: "PUT", body: { theme: "light" } })).status).toBe(200);
  expect((await b.json("/api/me/state")).body).toEqual({ theme: "light" }); // replaced, not merged
  for (const body of [[1], "text", 3, null]) expect((await b.json("/api/me/state", { method: "PUT", body: JSON.stringify(body) })).status).toBe(400);
  expect((await b.json("/api/me/state", { method: "PUT", body: "{ not json" })).status).toBe(400);
  expect((await b.json("/api/me/state", { method: "PUT", body: { big: "x".repeat(ACCOUNT_LIMITS.state) } })).status).toBe(413);
  expect((await b.json("/api/me/state", { method: "PUT", body: { ok: "x".repeat(ACCOUNT_LIMITS.state - 20) } })).status).toBe(200);
  expect((await b.json("/api/me/state")).body.ok.length).toBe(ACCOUNT_LIMITS.state - 20);
  expect((await b.json("/api/me/state", { method: "POST", body: {} })).status).toBe(405);
});

const turn = (n: number, extra: object = {}) => ({ question: `Question ${n} ?`, answer: `Réponse **${n}**`, ...extra });

test("conversations: create, list (summaries, search, newest first), read, replace, delete; limits", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "c1");
  const made = await b.json("/api/conversations", { method: "POST", body: { turns: [turn(1, { pages: ["concepts/idee"], at: "2026-11-25T10:00:00+01:00" }), turn(2)] } });
  expect(made.status).toBe(201);
  expect(made.body).toMatchObject({ title: "Question 1 ?", turns: [{ question: "Question 1 ?", answer: "Réponse **1**", pages: ["concepts/idee"], at: "2026-11-25T09:00:00.000Z" }, { question: "Question 2 ?" }] });
  expect(made.body.id).toMatch(/^[0-9a-f-]{36}$/);
  a.clock.t += 1000;
  const second = await b.json("/api/conversations", { method: "POST", body: { title: "  Mon   titre ", turns: [{ question: "  a\n b ", answer: "" }, { unknown: 1, question: "q", answer: "r", extra: "dropped" }] } });
  expect(second.body.title).toBe("Mon titre");
  expect(second.body.turns[1]).toEqual({ question: "q", answer: "r" }); // only the known fields are kept
  const list = await b.json("/api/conversations");
  expect(list.body.conversations.map((c: any) => c.title)).toEqual(["Mon titre", "Question 1 ?"]); // newest first
  expect(list.body.conversations[1]).toEqual({ id: made.body.id, title: "Question 1 ?", exchanges: 2, created_at: expect.any(String), updated_at: expect.any(String) });
  expect(Object.keys(list.body.conversations[0]).sort()).toEqual(["created_at", "exchanges", "id", "title", "updated_at"]); // no answers in a summary
  const find = async (q: string) => (await b.json(`/api/conversations?q=${encodeURIComponent(q)}`)).body.conversations.map((c: any) => c.title);
  expect(await find("question 2")).toEqual(["Question 1 ?"]); // a question of a turn, case-insensitive
  expect(await find("TITRE")).toEqual(["Mon titre"]);
  expect(await find("réponse")).toEqual([]); // answers are not searched
  expect(await find("nothing")).toEqual([]);
  expect(await find("%")).toEqual([]); // no wildcard
  expect(await find("")).toHaveLength(2);
  const one = await b.json(`/api/conversations/${made.body.id}`);
  expect(one.body).toEqual(made.body);
  // replace
  a.clock.t += 1000;
  const put = await b.json(`/api/conversations/${made.body.id}`, { method: "PUT", body: { turns: [...made.body.turns, turn(3)] } });
  expect(put.body.turns).toHaveLength(3);
  expect(put.body.title).toBe("Question 1 ?"); // the title is kept
  expect(put.body.updated_at > made.body.updated_at).toBe(true);
  expect((await b.json("/api/conversations")).body.conversations[0].id).toBe(made.body.id); // updated: first
  const renamed = (await b.json(`/api/conversations/${made.body.id}`, { method: "PUT", body: { title: "Renommée" } })).body;
  expect(renamed.title).toBe("Renommée");
  expect(renamed.turns).toHaveLength(3);
  expect((await b.json(`/api/conversations/${made.body.id}`, { method: "PUT", body: {} })).status).toBe(400);
  // limits
  const post = (body: unknown) => b.json("/api/conversations", { method: "POST", body });
  expect((await post({})).status).toBe(400);
  expect((await post({ turns: [] })).status).toBe(400);
  expect((await post({ turns: "x" })).status).toBe(400);
  expect((await post({ turns: Array.from({ length: ACCOUNT_LIMITS.turns + 1 }, (_, i) => turn(i)) })).status).toBe(400);
  expect((await post({ turns: Array.from({ length: ACCOUNT_LIMITS.turns }, (_, i) => turn(i)) })).status).toBe(201);
  expect((await post({ turns: [{ question: "", answer: "a" }] })).status).toBe(400);
  expect((await post({ turns: [{ question: "q" }] })).status).toBe(400);
  expect((await post({ turns: [{ question: "q", answer: "a", pages: "x" }] })).status).toBe(400);
  expect((await post({ turns: [{ question: "q", answer: "a", pages: [1] }] })).status).toBe(400);
  expect((await post({ turns: [{ question: "q", answer: "a", at: "yesterday" }] })).status).toBe(400);
  expect((await post({ title: "t".repeat(ACCOUNT_LIMITS.title + 1), turns: [turn(1)] })).status).toBe(400);
  expect((await post({ title: "é".repeat(ACCOUNT_LIMITS.title), turns: [turn(1)] })).status).toBe(201);
  expect((await post({ title: 3, turns: [turn(1)] })).status).toBe(400);
  const long = (await post({ turns: [{ question: "w ".repeat(300), answer: "x" }] })).body.title;
  expect([...long].length).toBe(ACCOUNT_LIMITS.title); // default title: the first question, normalized and cut
  expect(long.endsWith("…")).toBe(true);
  expect((await post({ turns: [{ question: "q", answer: "x".repeat(ACCOUNT_LIMITS.chars) }] })).status).toBe(413); // 1 M characters in all (question included)
  expect((await post({ turns: [{ question: "q", answer: "x".repeat(ACCOUNT_LIMITS.chars - 1) }] })).status).toBe(201);
  expect((await b.req("/api/conversations", { method: "POST", body: "[", headers: {} })).status).toBe(400);
  expect((await b.req("/api/conversations", { method: "POST", body: "x".repeat(ACCOUNT_LIMITS.body + 1) })).status).toBe(413);
  // delete
  expect((await b.json(`/api/conversations/${made.body.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await b.json(`/api/conversations/${made.body.id}`)).status).toBe(404);
  expect((await b.json(`/api/conversations/${made.body.id}`, { method: "DELETE" })).status).toBe(404);
  expect((await b.json("/api/conversations/x/y")).status).toBe(404);
});

test("journeys: create with a default title from the pages' titles, list, read, replace, delete; limits", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "j1");
  const made = await b.json("/api/journeys", { method: "POST", body: { route: ["concepts/idee", "entities/inconnue"] } });
  expect(made.status).toBe(201);
  expect(made.body).toMatchObject({ title: "Voyage : Idée → entities/inconnue", route: ["concepts/idee", "entities/inconnue"] }); // a known title, an unknown id as is
  expect((await b.json("/api/journeys", { method: "POST", body: { title: " Mon  voyage ", route: ["a"] } })).body.title).toBe("Mon voyage");
  expect((await b.json("/api/journeys", { method: "POST", body: { route: ["concepts/idee"] } })).body.title).toBe("Voyage : Idée → Idée");
  expect((await b.json("/api/journeys")).body.journeys).toHaveLength(3);
  expect((await b.json(`/api/journeys/${made.body.id}`)).body).toEqual(made.body);
  const put = await b.json(`/api/journeys/${made.body.id}`, { method: "PUT", body: { route: ["concepts/idee", "a", "b"] } });
  expect(put.body).toMatchObject({ title: made.body.title, route: ["concepts/idee", "a", "b"] }); // the title is kept
  expect((await b.json(`/api/journeys/${made.body.id}`, { method: "PUT", body: { title: "T", route: ["z"] } })).body).toMatchObject({ title: "T", route: ["z"] });
  expect((await b.json(`/api/journeys/${made.body.id}`, { method: "PUT", body: {} })).status).toBe(400);
  const post = (body: unknown) => b.json("/api/journeys", { method: "POST", body });
  expect((await post({})).status).toBe(400);
  expect((await post({ route: [] })).status).toBe(400);
  expect((await post({ route: "a" })).status).toBe(400);
  expect((await post({ route: [""] })).status).toBe(400);
  expect((await post({ route: [1] })).status).toBe(400);
  expect((await post({ route: ["x".repeat(ACCOUNT_LIMITS.idLength + 1)] })).status).toBe(400);
  expect((await post({ route: Array.from({ length: ACCOUNT_LIMITS.route + 1 }, (_, i) => `p${i}`) })).status).toBe(400);
  const max = await post({ route: Array.from({ length: ACCOUNT_LIMITS.route }, (_, i) => `p${i}`) });
  expect(max.status).toBe(201);
  expect(max.body.title).toBe("Voyage : p0 → p499");
  expect((await post({ title: "t".repeat(121), route: ["a"] })).status).toBe(400);
  expect((await b.json(`/api/journeys/${made.body.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await b.json(`/api/journeys/${made.body.id}`)).status).toBe(404);
  expect((await b.json(`/api/journeys/${made.body.id}`, { method: "PUT", body: { title: "x" } })).status).toBe(404);
});

test("a user's quota is bounded", async () => {
  const a = await setup(ALL);
  const b = await signInAs(a, "q1");
  const db = new Database(accountsFile(a.root));
  const user = (await b.json("/api/me")).body.id as string;
  db.run("begin");
  for (let i = 0; i < ACCOUNT_LIMITS.perUser; i++) {
    db.query("insert into journeys (id, user_id, title, route, created_at, updated_at) values (?, ?, 't', '[\"a\"]', 1, 1)").run(`j${i}`, user);
    db.query("insert into conversations (id, user_id, title, turns, exchanges, search, created_at, updated_at) values (?, ?, 't', '[]', 0, 't', 1, 1)").run(`c${i}`, user);
  }
  db.run("commit");
  expect((await b.json("/api/journeys", { method: "POST", body: { route: ["a"] } })).status).toBe(409);
  expect((await b.json("/api/conversations", { method: "POST", body: { turns: [turn(1)] } })).status).toBe(409);
  db.close();
});

test("isolation: another user's data is a 404 on every route, and is left untouched", async () => {
  const a = await setup(ALL);
  const alice = await signInAs(a, "alice"), bob = await signInAs(a, "bob");
  const conv = (await alice.json("/api/conversations", { method: "POST", body: { turns: [turn(1)] } })).body;
  const trip = (await alice.json("/api/journeys", { method: "POST", body: { route: ["a", "b"] } })).body;
  await alice.json("/api/me/state", { method: "PUT", body: { theme: "dark" } });
  for (const [method, path, body] of [
    ["GET", `/api/conversations/${conv.id}`], ["PUT", `/api/conversations/${conv.id}`, { title: "pwned" }], ["PUT", `/api/conversations/${conv.id}`, { turns: [turn(9)] }], ["DELETE", `/api/conversations/${conv.id}`],
    ["GET", `/api/journeys/${trip.id}`], ["PUT", `/api/journeys/${trip.id}`, { title: "pwned" }], ["PUT", `/api/journeys/${trip.id}`, { route: ["z"] }], ["DELETE", `/api/journeys/${trip.id}`],
  ] as [string, string, unknown?][]) expect((await bob.json(path, { method, body })).status).toBe(404);
  expect((await bob.json("/api/conversations")).body.conversations).toEqual([]);
  expect((await bob.json("/api/conversations?q=question")).body.conversations).toEqual([]);
  expect((await bob.json("/api/journeys")).body.journeys).toEqual([]);
  expect((await bob.json("/api/me/state")).body).toEqual({});
  // nothing changed for her
  expect((await alice.json(`/api/conversations/${conv.id}`)).body).toEqual(conv);
  expect((await alice.json(`/api/journeys/${trip.id}`)).body).toEqual(trip);
  expect((await alice.json("/api/me/state")).body).toEqual({ theme: "dark" });
  expect((await alice.json("/api/me")).body.name).toBe("alice");
});

test("deleting the account removes the user and everything under it, and only that user's", async () => {
  const a = await setup(ALL);
  const alice = await signInAs(a, "alice"), bob = await signInAs(a, "bob");
  for (const u of [alice, bob]) {
    await u.json("/api/conversations", { method: "POST", body: { turns: [turn(1)] } });
    await u.json("/api/journeys", { method: "POST", body: { route: ["a"] } });
    await u.json("/api/me/state", { method: "PUT", body: { x: 1 } });
  }
  const count = (t: string) => (a.db().query(`select count(*) as n from ${t}`).get() as { n: number }).n;
  for (const t of ["users", "sessions", "user_state", "conversations", "journeys"]) expect(count(t)).toBe(2);
  const res = await alice.req("/api/me", { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-cortex_session=;") && c.includes("Max-Age=0"))).toBe(true);
  for (const t of ["users", "sessions", "user_state", "conversations", "journeys"]) expect(count(t)).toBe(1);
  expect((await alice.json("/api/me")).status).toBe(401);
  expect((await bob.json("/api/conversations")).body.conversations).toHaveLength(1);
  expect((await bob.json("/api/me")).body.name).toBe("bob");
  // signing in again makes a new, empty account
  const again = await signInAs(a, "alice");
  expect((await again.json("/api/conversations")).body.conversations).toEqual([]);
});

test("per space: conversations, journeys and favorites of one space are invisible from another (and from the root), by id as well", async () => {
  const a = await setup(ALL);
  const alice = await signInAs(a, "alice");
  const conv = {} as Record<string, any>, trip = {} as Record<string, any>;
  for (const sp of ["a", "b", ""]) {
    const base = sp ? `/s/${sp}` : "";
    conv[sp] = (await alice.json(`${base}/api/conversations`, { method: "POST", body: { turns: [turn(1)], title: `in ${sp || "root"}` } })).body;
    trip[sp] = (await alice.json(`${base}/api/journeys`, { method: "POST", body: { route: ["wiki/concepts/x"] } })).body;
    await alice.json(`${base}/api/me/state`, { method: "PUT", body: { favs: [`wiki/concepts/x`, sp] } }); // the same page id in every space
  }
  for (const sp of ["a", "b", ""]) {
    const base = sp ? `/s/${sp}` : "";
    expect((await alice.json(`${base}/api/conversations`)).body.conversations.map((c: { id: string }) => c.id)).toEqual([conv[sp].id]);
    expect((await alice.json(`${base}/api/journeys`)).body.journeys.map((j: { id: string }) => j.id)).toEqual([trip[sp].id]);
    expect((await alice.json(`${base}/api/me/state`)).body).toEqual({ favs: ["wiki/concepts/x", sp] });
  }
  // an id of another space is a 404 on every verb, and nothing changed there
  for (const [method, path, body] of [
    ["GET", `/s/b/api/conversations/${conv.a.id}`], ["PUT", `/s/b/api/conversations/${conv.a.id}`, { title: "pwned" }], ["DELETE", `/s/b/api/conversations/${conv.a.id}`],
    ["GET", `/api/conversations/${conv.a.id}`], ["DELETE", `/api/conversations/${conv.a.id}`],
    ["GET", `/s/a/api/journeys/${trip.b.id}`], ["PUT", `/s/a/api/journeys/${trip.b.id}`, { route: ["z"] }], ["DELETE", `/s/a/api/journeys/${trip.b.id}`],
  ] as [string, string, unknown?][]) expect([method, path, (await alice.json(path, { method, body })).status]).toEqual([method, path, 404]);
  expect((await alice.json(`/s/a/api/conversations/${conv.a.id}`)).body.title).toBe("in a");
  expect((await alice.json(`/s/b/api/journeys/${trip.b.id}`)).status).toBe(200);
  expect((await alice.json("/s/a/api/conversations?q=in+b")).body.conversations).toEqual([]);
  // the account stays at the root, the quota is per space, another user sees none of it
  for (const path of ["/s/a/api/me", "/s/a/api/auth/methods", "/s/a/api/spaces"]) expect((await alice.req(path)).status).toBe(599);
  const bob = await signInAs(a, "bob");
  for (const sp of ["a", "b"]) expect((await bob.json(`/s/${sp}/api/conversations`)).body.conversations).toEqual([]);
  expect((await bob.json("/s/a/api/me/state")).body).toEqual({});
  expect((await bob.json(`/s/a/api/conversations/${conv.a.id}`)).status).toBe(404);
  const w = openAccounts(accountsFile(a.root));
  w.run("begin");
  for (let i = 0; i < ACCOUNT_LIMITS.perUser; i++) w.run("insert into journeys (id, user_id, title, route, created_at, updated_at, space) select ?, id, 't', '[\"a\"]', 1, 1, 'full' from users where subject = 'alice'", [`j${i}`]);
  w.run("commit"); w.close();
  expect((await alice.json("/s/full/api/journeys", { method: "POST", body: { route: ["a"] } })).status).toBe(409);
  expect((await alice.json("/s/a/api/journeys", { method: "POST", body: { route: ["a"] } })).status).toBe(201);
  expect((await alice.req("/s/a/api/me/state", { method: "PUT", origin: "https://evil.example", body: {} })).status).toBe(403);
});

test("the last owner of a space cannot delete their account (409, nothing deleted) until the space has another owner", async () => {
  const a = await setup(ALL);
  const alice = await signInAs(a, "alice"), bob = await signInAs(a, "bob");
  const [aliceId, bobId] = [(await alice.json("/api/me")).body.id, (await bob.json("/api/me")).body.id];
  const w = openAccounts(accountsFile(a.root));
  addSpaceMember(w, "mine", aliceId, "owner"); addSpaceMember(w, "mine", bobId, "member");
  const refused = await alice.json("/api/me", { method: "DELETE" });
  expect([refused.status, refused.body.error]).toEqual([409, expect.stringContaining("mine")]);
  expect((await alice.json("/api/me")).status).toBe(200); // still there, still signed in
  expect((await bob.json("/api/me", { method: "DELETE" })).status).toBe(200); // a plain member leaves freely, and takes his membership with him
  expect((await alice.json("/api/me", { method: "DELETE" })).status).toBe(409); // alone again
  const carol = await signInAs(a, "carol");
  addSpaceMember(w, "mine", (await carol.json("/api/me")).body.id, "owner");
  w.close();
  expect((await alice.json("/api/me", { method: "DELETE" })).status).toBe(200); // another owner: she may go
});

// ---- through `cortex serve`, against a local OIDC issuer over real HTTP ----

const saved = { ...process.env };
beforeAll(() => Object.assign(process.env, ENV));
afterAll(() => { for (const k of Object.keys(ENV)) k in saved ? (process.env[k] = saved[k]) : delete process.env[k]; });

test("serve: accounts over real HTTP, against a local issuer (plain http accepted for a loopback issuer only)", async () => {
  let issuer!: Issuer;
  const idp = Bun.serve({ port: 0, fetch: (req) => issuer.handle(req) });
  issuer = await new Issuer(`http://localhost:${idp.port}`).init();
  const root = wikiRoot();
  writeFileSync(join(root, "cortex.json"), "{}");
  const logs: string[] = [];
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: (m) => logs.push(m) });
  try {
    const base = `http://localhost:${server.port}`;
    const b = new Browser((req) => fetch(req), base);
    // no auth block: serve answers, nobody can sign in
    expect((await b.json("/api/auth/methods")).body).toEqual({ providers: [] });
    expect((await b.json("/api/me")).status).toBe(401);
    expect((await b.req("/api/verify", { method: "HEAD" })).status).toBe(204); // the other routes are untouched
    writeFileSync(join(root, "cortex.json"), JSON.stringify({ auth: { public_urls: [base], oidc: { ...OIDC, issuer: issuer.issuer, groups: ["app-cortex"] } } }));
    expect((await b.json("/api/auth/methods")).body).toEqual({ providers: [{ id: "oidc", label: "Authelia" }] });
    issuer.claims = { sub: "real", name: "Real", email: "r@example.org", groups: ["app-cortex"] };
    const r = await b.signIn("oidc", "/wiki/concepts/idee/", (u) => fetch(u, { redirect: "manual" }));
    expect(r.location.href).toBe(`${base}/wiki/concepts/idee/`);
    const session = r.done.headers.getSetCookie().find((c) => c.startsWith("cortex_session="))!; // http public URL: no __Host-, no Secure
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(session).not.toContain("Secure");
    expect((await b.json("/api/me")).body.provider).toBe("oidc");
    expect((await b.json("/api/conversations", { method: "POST", body: { turns: [turn(1)] } })).status).toBe(201);
    expect((await b.req("/api/conversations", { method: "POST", body: { turns: [turn(1)] }, origin: "http://evil.example" })).status).toBe(403);
    expect((await b.req("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await b.json("/api/me")).status).toBe(401);
    // the database lives beside the builds, never inside the folders serve swaps
    expect(await Bun.file(join(root, ".cortex/accounts.db")).exists()).toBe(true);
    // the site itself is still served, and the old routes still answer
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/api/ask`, { method: "HEAD" })).status).toBe(404);
  } finally { server.stop(true); idp.stop(true); }
}, 120_000);
