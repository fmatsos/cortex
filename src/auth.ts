import * as oauth from "oauth4webapi";
import type { Config } from "./config";
import { isLoopbackHost } from "./config";

/**
 * Sign-in providers of `cortex serve`: a generic OIDC provider (Authelia…), Google (OIDC) and GitHub (OAuth2). Cortex never sees a
 * password: it sends the browser to the provider and takes back an identity `(provider, subject)`. The protocol is oauth4webapi's
 * (discovery, authorization code + PKCE, `state`, `nonce`, the ID token's `iss`/`aud`/`exp`/`nonce`); the ID token's signature is
 * checked against the issuer's JWKS on top (oauth4webapi leaves that out for a token received straight from the token endpoint).
 * A provider is active only when its block is in `cortex.json` AND its secret is in the environment. Nothing here reads a request:
 * the redirect URI comes from the configured public URL (account-api.ts).
 */
export type ProviderId = "oidc" | "github" | "google";
export type Provider =
  | { id: "oidc"; label: string; issuer: string; clientId: string; secret: string; groups?: string[] }
  | { id: "github"; label: string; clientId: string; secret: string; allow: number[] }
  | { id: "google"; label: string; clientId: string; secret: string; allow: string[] };
/** Injectable network, for the tests (GitHub's endpoints are fixed): never read from the environment. */
export type Net = { fetch?: typeof fetch; /** Discovery documents, per server (a module-wide cache would outlive a test's fake issuer). */ cache?: Map<string, { as: oauth.AuthorizationServer; at: number }> };
export type Identity = { subject: string; name: string | null; email: string | null };

/** The sign-in is not allowed for this person (list, group, unverified e-mail): the site is told "refused", the log says why. */
export class Refused extends Error {}

const SECRETS = { oidc: "CORTEX_OIDC_CLIENT_SECRET", github: "CORTEX_GITHUB_CLIENT_SECRET", google: "CORTEX_GOOGLE_CLIENT_SECRET" } as const;
const GOOGLE_ISSUER = "https://accounts.google.com";
const GITHUB = { issuer: "https://github.com", authorization_endpoint: "https://github.com/login/oauth/authorize", token_endpoint: "https://github.com/login/oauth/access_token" } satisfies oauth.AuthorizationServer;
const TIMEOUT_MS = 10_000;

/** The origins of `auth.public_urls` (normalized, no trailing slash). */
export const publicOrigins = (a: Config["auth"]) => [...new Set((a?.public_urls ?? []).map((u) => new URL(u).origin))];

/** The providers that can sign someone in: configured, with a secret in `env`. A configured one without its secret is named in `warn`, not listed. */
export function enabledProviders(a: Config["auth"], env: Record<string, string | undefined>, warn: (m: string) => void = () => {}): Provider[] {
  if (!a || !publicOrigins(a).length) return [];
  const out: Provider[] = [];
  const secret = (id: ProviderId) => { const s = env[SECRETS[id]]; if (!s) warn(`auth.${id} is configured but $${SECRETS[id]} is not set: ${id} sign-in is off.`); return s; };
  let s: string | undefined;
  if (a.oidc && (s = secret("oidc"))) out.push({ id: "oidc", label: a.oidc.label ?? "Single sign-on", issuer: a.oidc.issuer, clientId: a.oidc.client_id, secret: s, groups: a.oidc.groups ?? undefined });
  if (a.github && (s = secret("github"))) out.push({ id: "github", label: "GitHub", clientId: a.github.client_id, secret: s, allow: a.github.allow });
  if (a.google && (s = secret("google"))) out.push({ id: "google", label: "Google", clientId: a.google.client_id, secret: s, allow: a.google.allow });
  return out;
}

const issuerOf = (p: Provider) => (p.id === "oidc" ? p.issuer : p.id === "google" ? GOOGLE_ISSUER : GITHUB.issuer);
/** Plain http only for a loopback issuer (config.ts refuses any other). */
const insecure = (issuer: string) => { const u = new URL(issuer); return u.protocol === "http:" && isLoopbackHost(u.hostname); };
const http = (p: Provider, net: Net) => ({
  [oauth.customFetch]: net.fetch as typeof fetch | undefined,
  ...(insecure(issuerOf(p)) ? { [oauth.allowInsecureRequests]: true as const } : {}),
  signal: () => AbortSignal.timeout(TIMEOUT_MS),
});

// Discovery documents, kept an hour (a login is rare; the JWKS is cached by oauth4webapi per document).
async function discover(p: Provider & { id: "oidc" | "google" }, net: Net, now = Date.now()): Promise<oauth.AuthorizationServer> {
  const discovered = (net.cache ??= new Map()), issuer = issuerOf(p), hit = discovered.get(issuer);
  if (hit && now - hit.at < 3_600_000) return hit.as;
  const url = new URL(issuer);
  const as = await oauth.discoveryRequest(url, { algorithm: "oidc", ...http(p, net) }).then((r) => oauth.processDiscoveryResponse(url, r));
  if (!as.authorization_endpoint || !as.token_endpoint || !as.jwks_uri) throw new Error("incomplete discovery document");
  discovered.set(issuer, { as, at: now });
  return as;
}
/** `client_secret_basic` unless the issuer only offers `client_secret_post` (the OIDC default is basic). */
const clientAuth = (as: oauth.AuthorizationServer, secret: string) => {
  const m = as.token_endpoint_auth_methods_supported;
  return !m || m.includes("client_secret_basic") || !m.includes("client_secret_post") ? oauth.ClientSecretBasic(secret) : oauth.ClientSecretPost(secret);
};

/** The page to send the browser to, and the one-time values of this login (kept server-side, see accounts.ts `login_tx`). */
export async function beginLogin(p: Provider, redirectUri: string, net: Net): Promise<{ url: string; state: string; nonce: string; verifier: string }> {
  const state = oauth.generateRandomState(), nonce = oauth.generateRandomNonce(), verifier = oauth.generateRandomCodeVerifier();
  const as = p.id === "github" ? GITHUB : await discover(p, net);
  const u = new URL(as.authorization_endpoint!);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(verifier));
  u.searchParams.set("code_challenge_method", "S256");
  if (p.id !== "github") {
    u.searchParams.set("nonce", nonce);
    u.searchParams.set("scope", p.id === "oidc" && p.groups ? "openid profile email groups" : "openid profile email");
  }
  return { url: u.href, state, nonce, verifier };
}

/**
 * Completes a login: the callback's query (`code`, `state`) against what `beginLogin` stored. Returns the identity, or throws
 * `Refused` (not allowed) or any other error (protocol failure, bad signature, expired token…).
 */
export async function finishLogin(p: Provider, tx: { state: string; nonce: string; verifier: string }, query: URLSearchParams, redirectUri: string, net: Net): Promise<Identity> {
  const client: oauth.Client = { client_id: p.clientId };
  const opts = http(p, net);
  if (p.id === "github") {
    const params = oauth.validateAuthResponse(GITHUB, client, query, tx.state);
    const res = await oauth.authorizationCodeGrantRequest(GITHUB, client, oauth.ClientSecretPost(p.secret), params, redirectUri, tx.verifier, opts);
    const { access_token } = await oauth.processAuthorizationCodeResponse(GITHUB, client, res);
    const r = await (net.fetch ?? fetch)("https://api.github.com/user", { headers: { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "user-agent": "cortex", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`github user: HTTP ${r.status}`);
    const u = (await r.json()) as { id?: unknown; login?: unknown; name?: unknown; email?: unknown };
    if (typeof u.id !== "number" || !Number.isSafeInteger(u.id) || u.id <= 0) throw new Error("github user: no numeric id");
    if (!p.allow.includes(u.id)) throw new Refused(`github id ${u.id} (${String(u.login)}) is not in auth.github.allow`);
    return { subject: String(u.id), name: str(u.name) ?? str(u.login), email: str(u.email) };
  }

  const as = await discover(p, net);
  const params = oauth.validateAuthResponse(as, client, query, tx.state);
  const res = await oauth.authorizationCodeGrantRequest(as, client, clientAuth(as, p.secret), params, redirectUri, tx.verifier, opts);
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, res, { expectedNonce: tx.nonce, requireIdToken: true });
  // iss, aud, azp, exp, iat and nonce are checked above; the signature is checked against the issuer's JWKS here
  await oauth.validateApplicationLevelSignature(as, res, opts);
  const claims = oauth.getValidatedIdTokenClaims(tokens)!;
  let more: Record<string, unknown> = {};
  if (p.id === "oidc" && p.groups && claims.groups === undefined && as.userinfo_endpoint) {
    // some issuers (Authelia by default) keep `groups` out of the ID token: the userinfo endpoint has them
    more = await oauth.processUserInfoResponse(as, client, claims.sub, await oauth.userInfoRequest(as, client, tokens.access_token, opts)) as Record<string, unknown>;
  }
  const claim = (k: string) => claims[k] ?? more[k];
  const email = str(claim("email"));
  const id: Identity = { subject: claims.sub, name: str(claim("name")) ?? str(claim("preferred_username")) ?? email, email };
  if (p.id === "google") {
    if (claim("email_verified") !== true || !email) throw new Refused("google account without a verified e-mail");
    if (!p.allow.some((a) => a.toLowerCase() === email.toLowerCase())) throw new Refused(`google account ${email} is not in auth.google.allow`);
  } else if (p.groups) {
    const g = claim("groups"), have = Array.isArray(g) ? g : typeof g === "string" ? [g] : [];
    if (!p.groups.some((x) => have.includes(x))) throw new Refused(`oidc subject ${claims.sub} is in none of auth.oidc.groups`);
  }
  return id;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
