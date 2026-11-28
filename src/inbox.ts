import { join } from "node:path";
import { readdir, rename, unlink } from "node:fs/promises";
import { add, formatAdd } from "./add";
import { SOURCE_CONTENTS, type SourceContent } from "./doc";
import { CortexError } from "./lib";
import { collector, type Report, type Result } from "./print";
import { paint } from "./style";

/**
 * Empties `inbox/` through `add`: lines of `urls.txt` (`<url> [note…]`) and files (optional note in `<name>.note`, optional
 * origin URL in `<name>.origin`: a page captured from the browser, its text is the source and the URL is not fetched; optional
 * kind in `<name>.as`, `note` or `resource`: what the source is, instead of what its input says; anything else in it is ignored; optional
 * `<name>.of`, the inbox file of the note this file is attached to: it is added after that note, tied to it both ways (`linked` / `linked_from`),
 * and waits in the inbox while the note has not been added; once the note is, `.of` holds its id instead). An entry the space does not take (its `content`
 * leaves that kind out) is skipped, not failed: it stays in the inbox for when it does.
 * A successful entry (added or already present) leaves the inbox, a failure stays in it. Messages go to `report` live
 * and are returned; `ok` is false when an entry failed.
 */
/**
 * The kind of each entry of a share (its inbox files) that names one: `<name>.as` (`note` or `resource`), else `resource` for a link, a PDF or a captured
 * page (`.url`, `.pdf`, `.origin`). A typed text or a text file names none: it takes the space's content.
 */
export const sharedKinds = (files: { path: string; content: string | Uint8Array }[]): SourceContent[] => {
  const text = (path: string) => { const c = files.find((f) => f.path === path)?.content; return typeof c === "string" ? c : undefined; };
  return files.filter((f) => !SIDE.test(f.path)).flatMap((f) => {
    const kind = asKind(text(`${f.path}.as`)) ?? (/\.(url|pdf)$/.test(f.path) || files.some((g) => g.path === `${f.path}.origin`) ? "resource" : undefined);
    return kind ? [kind] : [];
  });
};
/** `note` or `resource` (spaces and a final newline allowed); undefined for anything else: the files of `inbox/` are not all written by `put`. */
const asKind = (s: string | undefined): SourceContent | undefined => SOURCE_CONTENTS.find((k) => k === s?.trim());

/** The side files of an entry (`<name>.note`, `.origin`, `.as`, `.of`): never entries of their own. */
export const SIDE = /\.(note|origin|as|of)$/;

export async function inbox(root: string, opts: { dryRun?: boolean } = {}, report?: Report): Promise<Result & { sources: string[] }> {
  const { say, done: result } = collector(report);
  const dir = join(root, "inbox");
  const urlsFile = join(dir, "urls.txt");
  const names = await readdir(dir, { withFileTypes: true }).then((es) => es.filter((e) => e.isFile()).map((e) => e.name), () => []);
  const files = names.filter((n) => !n.startsWith(".") && n !== "urls.txt" && !SIDE.test(n)).sort();
  const lines = (await Bun.file(urlsFile).exists()) ? (await Bun.file(urlsFile).text()).split("\n") : [];

  const done = new Set<string>(); // urls.txt lines to remove
  let added = 0, known = 0, failed = 0;
  const skipped = new Map<string, string>(); // entries the space does not take (label → reason)
  /** One line per source added (and the pages it links to): `<title> (<id>) ← <entry>`, for a commit body. */
  const sources: string[] = [];
  const record = (r: Awaited<ReturnType<typeof add>>, label: string): void => {
    if (!r.duplicate && r.ex) sources.push(`${r.ex.title} (${r.id}) ← ${label}`);
    for (const l of r.linked ?? []) if (!("error" in l)) record(l, `${label} (linked)`);
  };
  /** Adds one entry; returns the id of its source (new, or the one already there), undefined when it failed or was skipped. */
  const run = async (label: string, input: string, note: string | undefined, onOk: () => Promise<unknown>, extra: { url?: string; as?: SourceContent; linkedFrom?: string } = {}): Promise<string | undefined> => {
    try {
      const r = await add(root, input, { note, ...extra, dryRun: opts.dryRun });
      say("info", `${formatAdd(r, opts.dryRun)}  ← ${label}`);
      if (r.duplicate) known++; else added++;
      record(r, label);
      if (!opts.dryRun) await onOk();
      return r.id;
    } catch (e) {
      if (e instanceof CortexError && e.code === "refused") { skipped.set(label, e.message.replace(/\.$/, "")); return; }
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
  // an attachment (`<name>.of`) comes after the note it is attached to, whatever the names sort to
  const read = async (path: string) => ((await Bun.file(path).exists()) ? (await Bun.file(path).text()).trim() : "") || undefined;
  const ofs = new Map<string, string>(); // attachment → its note's inbox file, or its id once that is added
  for (const f of files) { const of = await read(join(dir, `${f}.of`)); if (of) ofs.set(f, of); }
  const ids = new Map<string, string>(); // inbox file → the id of its source, once added
  for (const f of [...files.filter((n) => !ofs.has(n)), ...files.filter((n) => ofs.has(n))]) {
    // `<name>.url`: one link, like a urls.txt line, in a file of its own (one file per share, no write conflict)
    if (f.endsWith(".url")) { await link((await Bun.file(join(dir, f)).text()).trim(), () => unlink(join(dir, f))); continue; }
    const noteFile = join(dir, `${f}.note`), originFile = join(dir, `${f}.origin`), asFile = join(dir, `${f}.as`), ofFile = join(dir, `${f}.of`);
    const origin = await read(originFile);
    const of = ofs.get(f);
    const parent = of && (files.includes(of) ? ids.get(of) : of); // the note's source; a name that is no longer in the inbox is an id written by an earlier run
    if (of && !parent) { skipped.set(f, `an attachment waits for its note ${of}`); continue; } // the note failed, or is not taken: it stays with it
    const id = await run(f, join(dir, f), await read(noteFile), async () => { for (const x of [join(dir, f), noteFile, originFile, asFile, ofFile]) await unlink(x).catch(() => {}); },
      { url: /^https?:\/\//.test(origin ?? "") ? origin : undefined, as: asKind(await read(asFile)), linkedFrom: opts.dryRun ? undefined : parent });
    if (!id) continue;
    ids.set(f, id);
    // the attachments of this note keep its id, should one of them fail and come back in a later run, when the note's file is gone
    if (!opts.dryRun) for (const [g, o] of ofs) if (o === f) { ofs.set(g, id); await Bun.write(join(dir, `${g}.of`), `${id}\n`); }
  }

  if (done.size) {
    // ponytail: re-read just before writing, but no lock: a sync between the re-read and the rename can still be overwritten
    const fresh = (await Bun.file(urlsFile).text()).split("\n").filter((l) => !done.has(l));
    await Bun.write(`${urlsFile}.tmp`, fresh.join("\n"));
    await rename(`${urlsFile}.tmp`, urlsFile);
  }

  if (!added && !known && !failed && !skipped.size) say("info", paint.dim("Empty inbox."));
  else say("info", `${opts.dryRun ? "(dry-run, inbox unchanged) " : ""}${added} added, ${known} already present, ${failed} failed${skipped.size ? `, ${skipped.size} skipped and left in inbox/: ${[...new Set(skipped.values())].join("; ")}` : ""}.`);
  return { ...result(!failed), sources };
}
