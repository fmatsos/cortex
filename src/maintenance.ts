import { dateMs, isoDate, type Page, type RawSource, pageId, pageState } from "./doc";
import { wikiLinks } from "./lib";
import { LIMITS } from "./limits";
import { collator } from "./text";
import type { MaintenanceData, StaleReason } from "../site/src/lib/paths";

const DAY = 86_400_000;

/**
 * The state of the wiki for its owner, from what `cortex export` already reads: the same definitions as `cortex lint`
 * (orphan = no page links to it, Source pages excepted; broken link = a `/wiki/…` link to a file that does not exist),
 * so the two never give different numbers. Pure and deterministic: `now` is the export date, never the clock.
 * Raw sources stay private: only counts leave this function, never a title or a path.
 *  - `pages`: the wiki pages (index.md and log.md excluded); `exists`: does this root-relative path exist;
 *  - `review`: the review notion is on (cortex.json), without it nothing is "to review".
 */
export function maintenance(o: { pages: Page[]; raws: RawSource[]; exists: (path: string) => boolean; review: boolean; now: Date }): MaintenanceData {
  const ref = (d: Page) => ({ id: pageId(d.path), title: String(d.fm.title ?? pageId(d.path)), type: String(d.fm.type ?? "") });
  const byTitle = (a: { page: { title: string; id: string } }, b: { page: { title: string; id: string } }) => collator.compare(a.page.title, b.page.title) || collator.compare(a.page.id, b.page.id);
  const inbound = new Set<string>(); // lint counts every link, a page's link to itself included
  for (const d of o.pages) for (const l of wikiLinks(d.body)) inbound.add(l);
  const orphans = o.pages.filter((d) => d.fm.type !== "Source" && !inbound.has(d.path)).map((d) => ({ page: ref(d) })).sort(byTitle).map((x) => x.page);

  const broken = o.pages.flatMap((d) => {
    const targets = [...new Set(wikiLinks(d.body).filter((l) => !o.exists(l)))].sort();
    return targets.length ? [{ page: ref(d), targets }] : [];
  }).sort(byTitle);

  const pending = o.raws.filter((d) => d.fm.status === "pending");
  const late = pending.filter((d) => { const at = dateMs(d.fm.fetched_at); return at !== undefined && o.now.getTime() - at > LIMITS.pendingDays * DAY; });

  const stale = o.pages.flatMap((d) => {
    const st = pageState(d.fm, o.now), reasons: { kind: StaleReason; since?: string }[] = [];
    const day = (x: unknown) => isoDate(x)?.slice(0, 10);
    if (d.fm.status === "deprecated") reasons.push({ kind: "deprecated" });
    if (st.stale) reasons.push({ kind: "expired", since: day(d.fm.stale_after) });
    if (o.review && st.needsReview && st.generatedAt !== undefined && o.now.getTime() - st.generatedAt > LIMITS.maintenanceStaleDays * DAY) reasons.push({ kind: "review", since: day(d.fm.generated?.at) });
    return reasons.length ? [{ page: ref(d), reasons }] : [];
  }).sort(byTitle);

  return { orphans, broken, raw: { pending: pending.length, late: late.length, lateDays: LIMITS.pendingDays }, stale, staleDays: LIMITS.maintenanceStaleDays, review: o.review };
}
