/**
 * A `cortex serve` of several spaces mounts each space's site under `/s/<name>/`: the space's own APIs (ask, search, review,
 * build status) answer there, and what the browser keeps for one space (favorites, the open conversation, the offline copy's
 * state) must stay apart from the others'. The account (`/api/me`, `/api/auth/*`...) and `/api/spaces` stay at the root.
 * Anywhere else (a static site, a server of one space) there is no prefix, and nothing changes.
 */
const PREFIX = /^\/s\/[a-z0-9][a-z0-9-]{0,39}(?=\/|$)/;
export const spacePrefix = (): string => (typeof location === "undefined" ? "" : (PREFIX.exec(location.pathname)?.[0] ?? ""));
/** Name of the space the page belongs to ("" outside a multi-space server). */
export const spaceName = (): string => spacePrefix().slice(3);
/** URL of an API of the current space. */
export const spaceApi = (path: string): string => spacePrefix() + path;
