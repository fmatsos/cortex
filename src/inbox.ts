import { join } from "node:path";
import { readdir, rename, unlink } from "node:fs/promises";
import { add, describe } from "./add";

/**
 * Empties `inbox/` through `add`: lines of `urls.txt` (`<url> [note…]`) and files (optional note in `<name>.note`).
 * A successful entry (added or already present) leaves the inbox, a failure stays in it. Returns the exit code.
 */
export async function inbox(root: string, opts: { dryRun?: boolean } = {}): Promise<number> {
  const dir = join(root, "inbox");
  const urlsFile = join(dir, "urls.txt");
  const names = await readdir(dir, { withFileTypes: true }).then((es) => es.filter((e) => e.isFile()).map((e) => e.name), () => []);
  const files = names.filter((n) => !n.startsWith(".") && n !== "urls.txt" && !n.endsWith(".note")).sort();
  const lines = (await Bun.file(urlsFile).exists()) ? (await Bun.file(urlsFile).text()).split("\n") : [];

  const done = new Set<string>(); // urls.txt lines to remove
  let added = 0, known = 0, failed = 0, noNote = false;
  const run = async (label: string, input: string, note: string | undefined, onOk: () => Promise<unknown>) => {
    try {
      const r = await add(root, input, { note, dryRun: opts.dryRun });
      console.log(`${describe(r, opts.dryRun)}  ← ${label}`);
      if (r.duplicate) known++; else { added++; noNote ||= !note; }
      if (!opts.dryRun) await onOk();
    } catch (e) {
      console.error(`✗ ${label} : ${(e as Error).message}`);
      failed++;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [url, ...rest] = line.split(/\s+/);
    if (!/^https?:\/\//.test(url)) { console.error(`✗ ${line} : pas une URL http(s)`); failed++; continue; }
    await run(url, url, rest.join(" ") || undefined, async () => done.add(raw));
  }
  for (const f of files) {
    const noteFile = join(dir, `${f}.note`);
    const note = ((await Bun.file(noteFile).exists()) ? (await Bun.file(noteFile).text()).trim() : "") || undefined;
    await run(f, join(dir, f), note, async () => { await unlink(join(dir, f)); await unlink(noteFile).catch(() => {}); });
  }

  if (done.size) {
    // ponytail: re-read just before writing, but no lock: a sync between the re-read and the rename can still be overwritten
    const fresh = (await Bun.file(urlsFile).text()).split("\n").filter((l) => !done.has(l));
    await Bun.write(`${urlsFile}.tmp`, fresh.join("\n"));
    await rename(`${urlsFile}.tmp`, urlsFile);
  }

  if (!added && !known && !failed) console.log("Inbox vide.");
  else console.log(`${opts.dryRun ? "(dry-run, inbox inchangée) " : ""}${added} ajouté(s), ${known} déjà présent(s), ${failed} échec(s).`);
  if (noNote && !opts.dryRun) console.error("! note manquante : à renseigner avant compilation.");
  return failed ? 1 : 0;
}
