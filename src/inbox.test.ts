import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("inbox: files and urls.txt emptied, failures kept, idempotent", async () => {
  const { inbox } = await import("./inbox");
  const { existsSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const page = `<html><head><title>Page de test</title></head><body><article><h1>Page de test</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante words exigé par cortex add, sans réseau.</p>".repeat(4)}</article></body></html>`;
  const srv = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === "/ok" ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("non", { status: 404 }) });
  const sources = () => (existsSync(join(root, "raw")) ? readdirSync(join(root, "raw"), { recursive: true }) : []).filter((f) => String(f).endsWith("source.md")).length;
  const urls = join(root, "inbox/urls.txt");
  const [ok, ko] = [`${srv.url}ok`, `${srv.url}ko`];
  try {
    const empty = await inbox(root); // inbox absent
    expect(empty.ok).toBe(true);
    expect(empty.messages.at(-1)).toMatchObject({ level: "info" });
    expect(empty.messages.at(-1)!.text).toContain("Empty inbox.");

    await Bun.write(urls, `# commentaire\n\n${ok} pourquoi je garde ça\n${ko}\n`);
    await Bun.write(join(root, "inbox/avec.md"), "# Avec note\n\nUne idée sur la fermentation lactique des légumes.\n");
    await Bun.write(join(root, "inbox/avec.md.note"), "ma note\n");
    await Bun.write(join(root, "inbox/sans.txt"), "# Sans note\n\nUne autre idée sur la lacto-fermentation, très différente.\n");
    await Bun.write(join(root, "inbox/.gitkeep"), "");

    // dry-run: nothing moves
    expect((await inbox(root, { dryRun: true })).ok).toBe(false);
    expect(sources()).toBe(0);
    expect(await Bun.file(urls).text()).toContain(ok);
    expect(existsSync(join(root, "inbox/avec.md.note"))).toBe(true);

    // real run: 3 sources, the failure (404) stays, comments kept
    const real = await inbox(root);
    expect(real.ok).toBe(false);
    expect(sources()).toBe(3);
    expect(await Bun.file(urls).text()).toBe(`# commentaire\n\n${ko}\n`);
    expect(readdirSync(join(root, "inbox")).sort()).toEqual([".gitkeep", "urls.txt"]);
    const raws = (await import("./lib")).readDocs(root, "raw");
    expect((await raws).docs.map((d) => d.fm.note).sort()).toEqual(["", "ma note", "pourquoi je garde ça"]);
    expect(real.messages.some((m) => m.level === "fail" && m.text.startsWith(ko))).toBe(true);

    // second run: only the failure comes back, nothing new
    expect((await inbox(root)).ok).toBe(false);
    expect(sources()).toBe(3);

    // the URL already present leaves the inbox without a new source
    await Bun.write(urls, `${ok}\n`);
    expect((await inbox(root)).ok).toBe(true);
    expect(await Bun.file(urls).text()).toBe("");
    expect(sources()).toBe(3);
  } finally { srv.stop(true); }
});

test("inbox: a file whose add fails stays with its .note, a sub-directory is ignored, no urls.txt is fine", async () => {
  const { inbox } = await import("./inbox");
  const { existsSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "inbox/ok.md"), "# Bonne\n\nUne idée sur la fermentation lactique des légumes.\n");
  await Bun.write(join(root, "inbox/ok.md.note"), "pourquoi\n");
  await Bun.write(join(root, "inbox/mauvais.xyz"), "format non géré\n"); // `add` refuses the extension
  await Bun.write(join(root, "inbox/mauvais.xyz.note"), "ne pas perdre\n");
  await Bun.write(join(root, "inbox/sous-dossier/cache.md"), "# Caché\n\nNe doit jamais être ajouté.\n");
  const r = await inbox(root); // no urls.txt at all
  expect(r.ok).toBe(false);
  expect(r.messages.some((m) => m.level === "fail" && m.text.startsWith("mauvais.xyz"))).toBe(true);
  // the success leaves (file and note), the failure keeps both, the sub-directory is untouched and never ingested
  expect(readdirSync(join(root, "inbox")).sort()).toEqual(["mauvais.xyz", "mauvais.xyz.note", "sous-dossier"]);
  expect(existsSync(join(root, "inbox/sous-dossier/cache.md"))).toBe(true);
  expect(await Bun.file(join(root, "inbox/mauvais.xyz.note")).text()).toBe("ne pas perdre\n");
  const raws = [...new Bun.Glob("raw/**/source.md").scanSync({ cwd: root })];
  expect(raws).toHaveLength(1);
  expect(await Bun.file(join(root, raws[0])).text()).toContain("note: pourquoi");
  expect(existsSync(join(root, "inbox/urls.txt"))).toBe(false); // never created by a run that had no urls
});

test("inbox: a .url file holds one link, removed once added, kept on failure", async () => {
  const { inbox } = await import("./inbox");
  const { readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const page = `<html><head><title>Lien partagé</title></head><body><article><h1>Lien partagé</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante mots exigé par cortex add, sans réseau.</p>".repeat(4)}</article></body></html>`;
  const srv = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === "/ok" ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("non", { status: 404 }) });
  try {
    await Bun.write(join(root, "inbox/a.url"), `${srv.url}ok ma note\n`);
    await Bun.write(join(root, "inbox/b.url"), `${srv.url}ko\n`);
    expect((await inbox(root)).ok).toBe(false);
    expect(readdirSync(join(root, "inbox"))).toEqual(["b.url"]);
    const raws = [...new Bun.Glob("raw/**/source.md").scanSync({ cwd: root })];
    expect(raws).toHaveLength(1);
    expect(await Bun.file(join(root, raws[0])).text()).toContain("note: ma note");
  } finally { srv.stop(true); }
});

test("inbox: a file with a .origin keeps that url as the source's url, without fetching it, and leaves with its sidecars", async () => {
  const { inbox } = await import("./inbox");
  const { existsSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  let hits = 0;
  const srv = Bun.serve({ port: 0, fetch: () => { hits++; return new Response("paywall", { status: 403 }); } });
  const origin = `${srv.url}article?utm_source=x`;
  try {
    await Bun.write(join(root, "inbox/p.md"), "# Réservé aux abonnés\n\nLe texte complet, tel que le navigateur l'affichait une fois connecté, sans réseau côté cortex.\n");
    await Bun.write(join(root, "inbox/p.md.origin"), `${origin}\n`);
    await Bun.write(join(root, "inbox/p.md.note"), "pourquoi\n");
    expect((await inbox(root)).ok).toBe(true);
    expect(hits).toBe(0);
    expect(readdirSync(join(root, "inbox"))).toEqual([]);
    const docs = (await (await import("./lib")).readDocs(root, "raw")).docs;
    expect(docs.map((d) => [d.fm.url, d.fm.note, d.fm.kind, d.fm.extractor])).toEqual([[`${srv.url}article`, "pourquoi", "article", "browser"]]);

    // the same url again (another capture): already present, the inbox is emptied
    await Bun.write(join(root, "inbox/q.md"), "# Autre capture\n\nUn texte différent pour la même adresse, déjà gardée plus haut.\n");
    await Bun.write(join(root, "inbox/q.md.origin"), `${srv.url}article\n`);
    expect((await inbox(root)).ok).toBe(true);
    expect(existsSync(join(root, "inbox/q.md.origin"))).toBe(false);
    expect((await (await import("./lib")).readDocs(root, "raw")).docs.length).toBe(1);
  } finally { srv.stop(true); }
});
