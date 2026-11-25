// Reading paths and the maintenance summary: the shapes `cortex export` writes (paths.json, maintenance.json) and the pure
// helpers the site reads them with. A path is an editorial itinerary: a goal, pages in order, a reason for each.

/** One step: a wiki page of the path. `reason`: inline HTML (links relative to the path's own page); `reasonText`: the same, as plain text. */
export type PathStep = { id: string; title: string; type: string; description: string; reason: string; reasonText: string };
export type PathData = { slug: string; title: string; goal: string; intro: string; steps: PathStep[] };

/** What an article needs to show "Previous / Next" in a path (paths.json: no HTML, read only when `?path=` names a path). */
export type PathNavData = { slug: string; title: string; steps: { id: string; title: string; reason: string }[] };
export const toPathNav = (p: PathData): PathNavData => ({ slug: p.slug, title: p.title, steps: p.steps.map((s) => ({ id: s.id, title: s.title, reason: s.reasonText })) });

/** Query parameter that carries the path an article is read in. */
export const PATH_PARAM = "path";

/** The path named by a `?path=` value, among `paths`; undefined when none has that slug. */
export const pathOf = <P extends { slug: string }>(paths: readonly P[], slug: string | null | undefined): P | undefined => (slug ? paths.find((p) => p.slug === slug) : undefined);

export type PathPosition = { n: number; total: number; step: PathNavData["steps"][number]; prev?: PathNavData["steps"][number]; next?: PathNavData["steps"][number] };
/** Where page `id` stands in `path`: its step, the one before and the one after; undefined when the path does not go through it. */
export function pathPosition(path: PathNavData, id: string): PathPosition | undefined {
  const i = path.steps.findIndex((s) => s.id === id);
  return i < 0 ? undefined : { n: i + 1, total: path.steps.length, step: path.steps[i]!, prev: path.steps[i - 1], next: path.steps[i + 1] };
}

/** Why a page needs maintenance as a stale page: deprecated, past its `stale_after`, or modified long ago and still to review. */
export type StaleReason = "deprecated" | "expired" | "review";
type PageRef = { id: string; title: string; type: string };
export type MaintenanceData = {
  /** Pages nothing links to (Source pages excluded, like `cortex lint`). */
  orphans: PageRef[];
  /** Pages with links to wiki pages that do not exist: the missing targets (`/wiki/….md`). */
  broken: { page: PageRef; targets: string[] }[];
  /** Raw sources waiting to be compiled (`status: pending`) and, among them, those waiting for more than `lateDays`. Counts only: raw sources are private. */
  raw: { pending: number; late: number; lateDays: number };
  /** Pages to look at again, with each reason; `since`: the day it started (ISO day; a deprecated page has none). */
  stale: { page: PageRef; reasons: { kind: StaleReason; since?: string }[] }[];
  /** Days after which a page modified since its review and not reviewed again counts as stale. */
  staleDays: number;
  /** Whether the wiki has the review notion (cortex.json `review`): without it, no page is "to review". */
  review: boolean;
};
