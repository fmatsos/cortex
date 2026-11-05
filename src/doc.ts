import { z } from "zod";
import type { Doc } from "./lib";

/**
 * Domain types of the file format (the contract of the wiki): the frontmatter schemas of a wiki page and of a raw
 * source, the `Page` / `RawSource` they type, and the conversions between the spellings of an identity.
 * Pure: no I/O here (reading is in lib.ts), so lib.ts may import this module without a cycle.
 */

export const PAGE_TYPES = ["Source", "Concept", "Entity", "Synthesis"] as const;
export const PAGE_STATUSES = ["draft", "stable", "deprecated"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Error message of a field: `missing` when the value is absent or blank, `wrong(input)` otherwise. */
const err = (missing: string, wrong: (input: unknown) => string) => (iss: { input?: unknown }) =>
  iss.input == null || iss.input === "" ? missing : wrong(iss.input);

/** Text as YAML writes it: a bare number (`title: 2026`) is read as its text. */
const Text = z.union([z.string(), z.number().transform(String)]);
const Date_ = z.union([z.string(), z.date()]); // YAML may yield a Date or a string
const Stamp = z.object({ by: Text.nullish(), at: Date_.nullish() }).passthrough();
const SourceRef = z.object({ id: Text.nullish(), resource: z.string().nullish(), title: Text.nullish() }).passthrough();

/** Shape of a wiki page frontmatter (OKF subset). `type` and `title` are required, the rest is optional. */
const pageShape = {
  type: z.enum(PAGE_TYPES, { error: err("missing type", (v) => `unknown type: ${String(v)} (expected: ${PAGE_TYPES.join(" | ")})`) }),
  title: z.union([z.string(), z.number().transform(String)], { error: err("missing title", () => "invalid title: text expected") }).refine((s) => s.trim() !== "", { error: "missing title" }),
  description: z.string().nullish(),
  tags: z.array(z.string({ error: "tags: list of texts expected" }), { error: "tags: list of texts expected" }).nullish(),
  status: z.enum(PAGE_STATUSES, { error: (iss) => `unknown status: ${String(iss.input)} (expected: ${PAGE_STATUSES.join(" | ")})` }).nullish(),
  generated: Stamp.nullish(),
  verified: Stamp.nullish(),
  sources: z.array(SourceRef).nullish(),
  stale_after: Date_.nullish(),
};
/** What a valid page looks like. `passthrough()`: unknown keys are kept (OKF is extensible). */
export const PageFm = z.object(pageShape).passthrough();
/** What a page can look like once loaded: a field that does not conform is dropped (lint reports it), never the page. */
const PageFmLoaded = PageFm.partial();
export type PageFm = z.infer<typeof PageFmLoaded>;
export type SourceRef = z.infer<typeof SourceRef>;
export type Stamp = z.infer<typeof Stamp>;

const rawShape = {
  type: z.literal("RawSource"),
  title: Text.nullish(),
  url: z.string().nullish(),
  kind: z.string().nullish(),
  sha256: z.string().nullish(),
  blob: z.string().nullish(),
  fetched_at: Date_.nullish(),
  extractor: z.string().nullish(),
  note: Text.nullish(),
  status: z.enum(["pending", "compiled", "skipped"]).nullish(),
  partial: z.union([z.string(), z.boolean()]).nullish(),
};
export const RawFm = z.object(rawShape).passthrough();
const RawFmLoaded = RawFm.partial();
export type RawFm = z.infer<typeof RawFmLoaded>;

/** A field of a page that does not conform to the schema (first issue of each top-level field). */
export type FmIssue = { field: string; msg: string };

export type Page = { path: string; fm: PageFm; body: string; issues: FmIssue[] };
export type RawSource = { path: string; fm: RawFm; body: string };

/** Fields lint reports (REL-16). The other fields are tolerated: a consumer reads them as absent. */
export const REPORTED_FIELDS = new Set(["type", "title", "status", "tags"]);

/** Loads a schema-checked frontmatter: the parsed value, or — if it does not conform — the conforming fields only. */
function load<S extends z.ZodObject>(strict: S, loose: z.ZodType, fm: Record<string, unknown>): { fm: unknown; issues: FmIssue[] } {
  const r = strict.safeParse(fm);
  if (r.success) return { fm: r.data, issues: [] };
  const issues = new Map<string, string>();
  for (const i of r.error.issues) { const f = String(i.path[0]); if (!issues.has(f)) issues.set(f, i.message); }
  const kept = Object.fromEntries(Object.entries(fm).filter(([k]) => !issues.has(k)));
  return { fm: loose.parse(kept), issues: [...issues].map(([field, msg]) => ({ field, msg })) };
}

/** Types a parsed document as a wiki page. Never drops it: non-conforming fields go to `issues`. */
export function toPage(d: Doc): Page {
  const { fm, issues } = load(PageFm, PageFmLoaded, d.fm);
  return { path: d.path, fm: fm as PageFm, body: d.body, issues };
}

/** Types a parsed document as a raw source. */
export function toRawSource(d: Doc): RawSource {
  return { path: d.path, fm: load(RawFm, RawFmLoaded, d.fm).fm as RawFm, body: d.body };
}

// Identities. A raw source: id `01a1…`, path `raw/2026/11/01a1…/source.md`, resource `/raw/2026/11/01a1…/source.md`.
// A wiki page: path `wiki/concepts/x.md`, link `/wiki/concepts/x.md`, id `concepts/x`, route `wiki/concepts/x/`.

/** Raw id: the last segment of the source's folder (the file name itself when it is not a `source.md`). */
export const rawId = (path: string) => path.replace(/^raw\//, "").replace(/\/source\.md$/, "").split("/").at(-1)!;
/** Resource form of a root-relative path (how a page cites a raw source, and links to another page). */
export const toResource = (path: string) => `/${path}`;
/** Root-relative path of a resource or link (`/wiki/x.md` → `wiki/x.md`); tolerates surrounding spaces. */
export const fromResource = (link: string) => link.trim().replace(/^\/+/, "");
export const pageLink = toResource;
/** Page id: path without the `wiki/` prefix and the `.md` extension. */
export const pageId = (path: string) => path.replace(/^wiki\//, "").replace(/\.md$/, "");
/** Site route of a page: `wiki/concepts/x.md` → `wiki/concepts/x/`. */
export const pageRoute = (path: string) => `${path.replace(/\.md$/, "")}/`;

// Dates. YAML yields a `Date` or a string depending on how the value is written: one normalisation for lint and the site.

/** ISO text of a YAML date (Date or string); undefined when absent. */
export const isoDate = (x: unknown) => (x == null ? undefined : x instanceof Date ? x.toISOString() : String(x));
/** Epoch ms of a YAML date; undefined when absent or unparsable. */
export const dateMs = (x: unknown) => { const t = x == null ? NaN : new Date(x as string | Date).getTime(); return Number.isNaN(t) ? undefined : t; };

/**
 * Review state of a page, from its dates: `needsReview` = reviewed once (`verified`) and modified since
 * (`generated.at` later than `verified.at`); `stale` = `stale_after` passed at `now`.
 */
export function pageState(fm: PageFm, now = new Date()) {
  const generatedAt = dateMs(fm.generated?.at), verifiedAt = dateMs(fm.verified?.at), staleAfter = dateMs(fm.stale_after);
  return {
    generatedAt, verifiedAt,
    needsReview: !!fm.verified && generatedAt !== undefined && verifiedAt !== undefined && generatedAt > verifiedAt,
    stale: staleAfter !== undefined && staleAfter < now.getTime(),
  };
}
