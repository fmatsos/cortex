# Roadmap

What is planned, not started. Done work lives in the git history; design in `docs/DESIGN.md`.

## Accounts on Better Auth (with the mobile app)

**When:** when the mobile app starts, not before. Until then, the home-grown accounts (`src/accounts.ts`, `src/auth.ts`, `may()` in `src/serve.ts`) cover a single owner and the spaces' memberships.

**What:** move sign-in, sessions and memberships to [Better Auth](https://github.com/better-auth/better-auth), a TypeScript auth library that runs on Bun with `bun:sqlite`.

- A space maps to an organization of the `organization` plugin: members, roles, invitations.
- The `bearer` / `expo` plugins give the mobile app its tokens; passkeys and 2FA come as plugins.
- The swap stays contained to `accounts.ts`, `auth.ts` and `may()`, plus a migration of `.cortex/accounts.db` (users, sessions, memberships, per-space data).

**Open points:**

- Better Auth sends invitations by email: it needs a mail sender, and a verified email (never match an invite on an unverified provider email).
- Keep the single-use invite links of the spaces, or replace them with the plugin's invitations.
