import { join } from "node:path";
import { readdir, rename, unlink } from "node:fs/promises";
import { add, formatAdd } from "./add";
import { collector, type Report, type Result } from "./print";
import { paint } from "./style";

/**
 * Empties `inbox/` through `add`: lines of `urls.txt` (`<url> [note…]`) and files (optional note in `<name>.note`, optional
 * origin URL in `<name>.origin`: a page captured from the browser, its text is the source and the URL is not fetched).
 * A successful entry (added or already present) leaves the inbox, a failure stays in it. Messages go to `report` live
 * and are returned; `ok` is false when an entry failed.
 */
export async function inbox(root: string, opts: { dryRun?: boolean } = {}, report?: Report): Promise<Result & { sources: string[] }> {
  const { say, done: result } = collector(report);
  const dir = join(root, "inbox");
  const urlsFile = join(dir, "urls.txt");
  const names = await readdir(dir, { withFileTypes: true }).then((es) => es.filter((e) => e.isFile()).map((e) => e.name), () => []);
  const files = names.filter((n) => !n.startsWith(".") && n !== "urls.txt" && !n.endsWith(".note") && !n.endsWith(".origin")).sort();
  const lines = (await Bun.file(urlsFile).exists()) ? (await Bun.file(urlsFile).text()).split("\n") : [];

  const done = new Set<string>(); // urls.txt lines to remove
  let added = 0, known = 0, failed = 0;
  /** One line per source added (and the pages it links to): `<title> (<id>) ← <entry>`, for a commit body. */
  const sources: string[] = [];
  const record = (r: Awaited<ReturnType<typeof add>>, label: string): void => {
    if (!r.duplicate && r.ex) sources.push(`${r.ex.title} (${r.id}) ← ${label}`);
    for (const l of r.linked ?? []) if (!("error" in l)) record(l, `${label} (linked)`);
  };
  const run = async (label: string, input: string, note: string | undefined, onOk: () => Promise<unknown>, url?: string) => {
    try {
      const r = await add(root, input, { note, url, dryRun: opts.dryRun });
      say("info", `${formatAdd(r, opts.dryRun)}  ← ${label}`);
      if (r.duplicate) known++; else added++;
      record(r, label);
      if (!opts.dryRun) await onOk();
    } catch (e) {
      say("fail", `${label}: ${(e as Error).message}`);
      failed++;
    }
  };

  const link = async (line: string, onOk: () => Promise<unknown>) => {
    const [url, ...rest] = line.split(/\s+/);
    if (!/^https?:\/\//.test(url)) { say("fail", `${line}: not an http(s) URL`); failed++; return; }
    await run(url, url, rest.join(" ") || undefined, onOk);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) await link(line, async () => done.add(raw));
  }
  for (const f of files) {
    // `<name>.url`: one link, like a urls.txt line, in a file of its own (one file per share, no write conflict)
    if (f.endsWith(".url")) { await link((await Bun.file(join(dir, f)).text()).trim(), () => unlink(join(dir, f))); continue; }
    const noteFile = join(dir, `${f}.note`);
    const note = ((await Bun.file(noteFile).exists()) ? (await Bun.file(noteFile).text()).trim() : "") || undefined;
    const originFile = join(dir, `${f}.origin`);
    const origin = ((await Bun.file(originFile).exists()) ? (await Bun.file(originFile).text()).trim() : "") || undefined;
    await run(f, join(dir, f), note, async () => { for (const x of [join(dir, f), noteFile, originFile]) await unlink(x).catch(() => {}); }, /^https?:\/\//.test(origin ?? "") ? origin : undefined);
  }

  if (done.size) {
    // ponytail: re-read just before writing, but no lock: a sync between the re-read and the rename can still be overwritten
    const fresh = (await Bun.file(urlsFile).text()).split("\n").filter((l) => !done.has(l));
    await Bun.write(`${urlsFile}.tmp`, fresh.join("\n"));
    await rename(`${urlsFile}.tmp`, urlsFile);
  }

  if (!added && !known && !failed) say("info", paint.dim("Empty inbox."));
  else say("info", `${opts.dryRun ? "(dry-run, inbox unchanged) " : ""}${added} added, ${known} already present, ${failed} failed.`);
  return { ...result(!failed), sources };
}
