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

## Appointments and action items in notes spaces

**When:** after spaces ship. The multi-space home of a notes space (see `design/mockups/spaces.html`, "Accueil Notes") shows an "À venir" block and an "Actions ouvertes" block that nothing feeds yet.

**What:** extract them from the notes, deterministically at export, from what the agent already writes.

- **Appointments:** a dated item stated in a note page (date, time, place, people). The notes schema asks the agent to state appointment dates explicitly; give them a machine-readable form (frontmatter or a fixed Markdown pattern), then export the upcoming ones (next 7 days) for the home.
- **Action items:** an action with an owner and an optional due date, from meeting notes. Same approach: a fixed form in the page, exported as a list, open or done.
- The home blocks read that export; nothing is computed in the browser beyond filtering.

**Open points:**

- Marking an action done: an edit of the page (through the agent, or a small server route that rewrites one line), or a per-user state that does not touch the wiki. A read-only space would refuse the first, not the second.
- Reminders (notifications) stay out of scope: the calendar keeps that role.

## Mobile app: Capacitor

**When:** at the start of the mobile app, together with the move to Better Auth.

**Decided:** the app is the SvelteKit site packaged with [Capacitor](https://capacitorjs.com/), for Android and iOS. One front end: the site, its offline service worker, its spaces and its i18n are reused as they are; the logic in plain TypeScript (`site/src/lib/*.ts`) stays shared. The site stays on SvelteKit.

**To build:**

- Accounts through Better Auth tokens (`bearer` plugin) instead of the session cookie, since the app is not served from the instance's origin.
- Offline reading of several spaces (one service worker scope per space today: check how Capacitor serves the bundled site, or sync the spaces' data into the app's storage).
- The system share sheet into a chosen space (Capacitor plugin), replacing the PWA share target.
- Notifications, if appointments and action items land.
- A small native module only where a plugin falls short (Kotlin on Android, Swift on iOS), e.g. a home screen widget for quick capture.

**Rejected:**

- **PWA alone:** too limited for the share sheet and notifications on iOS.
- **React Native / Expo:** a second front end, and a move of the site to React for no gain on the site itself.
- **Flutter:** a second front end in Dart, with nothing of the site or its logic reused.
- **Kotlin native:** Android only, and a second front end; kept only for a native module next to Capacitor if needed.
