import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDoc, slugify, UUID, type Doc } from "./lib";
import { readLog, renderLogMd } from "./log";

export type Issue = { level: "error" | "warning" | "info"; path: string; msg: string };

const DAY = 86_400_000;
const time = (x: unknown) => (x == null ? NaN : new Date(x as any).getTime()); // YAML peut rendre Date ou string

export async function lint(root: string, now = new Date()): Promise<Issue[]> {
  const out: Issue[] = [];
  const push = (level: Issue["level"], path: string, msg: string) => out.push({ level, path, msg });
  // fichier par fichier : un YAML invalide est signalé sans arrêter le lint
  const safe = async (dir: string) => {
    const docs: Doc[] = [];
    if (!existsSync(join(root, dir))) return docs;
    for (const f of new Bun.Glob("**/*.md").scanSync(join(root, dir))) {
      const path = `${dir}/${f}`;
      try { docs.push(parseDoc(path, await Bun.file(join(root, path)).text())); }
      catch (e) { push("error", path, `YAML invalide : ${(e as Error).message.split("\n")[0]}`); }
    }
    return docs;
  };

  const wiki = (await safe("wiki")).filter((d) => !/^wiki\/(index|log)\.md$/.test(d.path));
  const raw = await safe("raw");
  const inbound = new Map<string, number>();
  const cites = new Map<string, string[]>(); // raw resource → pages Source qui la citent
  const titles = new Map<string, string>();

  for (const d of wiki) {
    const { fm, path } = d;
    if (!fm.type) push("error", path, "type manquant");
    if (!UUID.test(path.split("/").at(-1)!.replace(/\.md$/, ""))) push("error", path, "nom de fichier : UUID v7 attendu (crée la page avec cortex new)");
    if (!fm.description) push("error", path, "description manquante");
    const ids = new Set((fm.sources ?? []).map((s: any) => s.id));
    for (const s of fm.sources ?? []) {
      if (!s.resource || !existsSync(join(root, s.resource))) push("error", path, `source introuvable : ${s.resource}`);
      else if (fm.type === "Source") cites.set(s.resource, [...(cites.get(s.resource) ?? []), path]);
    }
    for (const [, id] of d.body.matchAll(/\[\^([\w-]+)\]/g)) if (!ids.has(id)) push("error", path, `note [^${id}] sans entrée sources[]`);
    for (const [, l] of d.body.matchAll(/\]\((\/wiki\/[^)#\s]+)/g)) {
      inbound.set(l.slice(1), (inbound.get(l.slice(1)) ?? 0) + 1);
      if (!existsSync(join(root, l))) push("error", path, `lien cassé : ${l}`);
    }
    const g = time(fm.generated?.at), v = time(fm.verified?.at);
    if (!fm.verified) push("info", path, "jamais relue");
    else if (g > v) push("warning", path, "modifiée depuis la relecture (generated.at > verified.at) : à relire");
    if (time(fm.stale_after) < now.getTime()) push("warning", path, `périmée depuis ${String(fm.stale_after).slice(0, 10)} (stale_after)`);
    const t = slugify(String(fm.title ?? ""));
    if (titles.has(t)) push("warning", path, `doublon probable de ${titles.get(t)} (même titre)`);
    else titles.set(t, path);
  }
  for (const d of wiki) if (d.fm.type !== "Source" && !inbound.get(d.path)) push("warning", d.path, "orpheline : aucun lien entrant");
  for (const [res, pages] of cites) if (pages.length > 1) push("warning", pages[1], `doublon probable de ${pages[0]} (même source raw ${res})`);

  for (const d of raw) {
    const { fm, path } = d;
    if (fm.type !== "RawSource") push("error", path, "type: RawSource attendu");
    if (!/^raw\/\d{4}\/\d\d\/[^/]+\/source\.md$/.test(path) || !UUID.test(path.split("/").at(-2)!)) push("error", path, "chemin : raw/AAAA/MM/<UUID v7>/source.md attendu (cortex add)");
    if (fm.status === "pending") {
      if (!String(fm.note ?? "").trim()) push("warning", path, "note manquante : à demander avant de compiler");
      if (now.getTime() - time(fm.fetched_at) > 7 * DAY) push("warning", path, "en attente depuis plus de 7 jours");
    }
    if (fm.status === "compiled" && !cites.has(`/${path}`)) push("warning", path, "compilée mais aucune page Source ne la cite");
  }

  const tags = new Map<string, string>();
  for (const d of wiki) for (const tag of d.fm.tags ?? []) {
    const k = slugify(String(tag)).replace(/s$/, "");
    const seen = tags.get(k);
    if (seen && seen !== tag) push("warning", d.path, `tags quasi synonymes : « ${seen} » et « ${tag} »`);
    else tags.set(k, tag);
  }

  // journal : lignes invalides = erreur ; log.md doit être exactement la génération de log.jsonl
  const journal = readLog(root);
  for (const e of journal.errors) push("error", `wiki/log.jsonl:${e.line}`, e.msg);
  const md = join(root, "wiki/log.md");
  if (existsSync(md) || journal.entries.length) {
    if (!existsSync(md) || (await Bun.file(md).text()) !== renderLogMd(journal.entries, new Map(wiki.filter((d) => d.fm.title).map((d) => [d.path, String(d.fm.title)]))))
      push("warning", "wiki/log.md", "diffère de sa génération depuis wiki/log.jsonl (édité à la main ?) : cortex index le régénère");
  }
  return out;
}
