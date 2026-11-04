import { type Config, loadConfig } from "./config";
import type { Page, RawSource } from "./doc";
import { type DocError, readPages, readRawSources } from "./lib";
import { readLog, type Titles } from "./log";
import { NAMING_DEFAULTS, type NamingKey } from "./template";

/**
 * What one command knows about the wiki: cortex.json, wiki/, raw/ and the journal, each read at most once, on first
 * use (a command that never asks for the config never fails on a broken cortex.json). A context is a snapshot: open
 * a new one when the files changed under it (a compile session, one MCP request).
 */
export type Wiki = {
  root: string;
  config(): Promise<Config>;
  /** Templates in force: cortex.json, otherwise the defaults (UUID v7). */
  naming(): Promise<Record<NamingKey, string>>;
  /** Every .md under wiki/, reserved pages included (callers filter with `isReservedPage`). */
  pages(): Promise<Page[]>;
  raws(): Promise<RawSource[]>;
  /** Unparseable files, filled in when `pages()` / `raws()` first resolve. */
  errors: { pages: DocError[]; raws: DocError[] };
  /** wiki/log.jsonl. `appendLog` pushes the entry it writes, so the memo stays current. */
  journal(): ReturnType<typeof readLog>;
  /** Title of each titled wiki page (path → title). */
  titles(): Promise<Titles>;
  /** Raw resource → Source pages citing it (one entry per `sources[]` item, pages in path order). */
  citations(): Promise<Map<string, Page[]>>;
};

/** Memoises the result (a promise included: concurrent callers share one read). */
const once = <T>(f: () => T): (() => T) => {
  let box: { v: T } | undefined;
  return () => (box ??= { v: f() }).v;
};

export function openWiki(root: string): Wiki {
  const errors: Wiki["errors"] = { pages: [], raws: [] };
  const config = once(() => loadConfig(root));
  const pages = once(async () => { const r = await readPages(root); errors.pages = r.errors; return r.pages; });
  return {
    root, errors, config, pages,
    naming: once(async () => {
      const c = await config();
      return { raw_path: c.raw_path ?? NAMING_DEFAULTS.raw_path, page_path: c.page_path ?? NAMING_DEFAULTS.page_path };
    }),
    raws: once(async () => { const r = await readRawSources(root); errors.raws = r.errors; return r.raws; }),
    journal: once(() => readLog(root)),
    titles: once(async () => new Map((await pages()).filter((d) => d.fm.title).map((d) => [d.path, d.fm.title!]))),
    citations: once(async () => {
      const m = new Map<string, Page[]>();
      for (const d of await pages()) if (d.fm.type === "Source") for (const s of d.fm.sources ?? []) if (s.resource) m.set(s.resource, [...(m.get(s.resource) ?? []), d]);
      return m;
    }),
  };
}
