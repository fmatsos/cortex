import { existsSync } from "node:fs";
import { join } from "node:path";
import { isReservedPage, readDocs, slugify } from "./lib";
import { naming } from "./naming";
import { pattern } from "./template";
import { readLog, renderLogMd } from "./log";

export type Issue = { level: "error" | "warning" | "info"; path: string; msg: string };

const DAY = 86_400_000;
const time = (x: unknown) => (x == null ? NaN : new Date(x as any).getTime()); // YAML may yield Date or string

export async function lint(root: string, now = new Date()): Promise<Issue[]> {
  const out: Issue[] = [];
  const push = (level: Issue["level"], path: string, msg: string) => out.push({ level, path, msg });
  const tpl = await naming(root), pagePat = pattern(tpl.page_path), rawPat = pattern(tpl.raw_path);
  const [w, r] = [await readDocs(root, "wiki"), await readDocs(root, "raw")];
  for (const e of [...w.errors, ...r.errors]) push("error", e.path, `YAML invalide : ${e.msg}`);
  const wiki = w.docs.filter((d) => !isReservedPage(d.path));
  const raw = r.docs;
  const inbound = new Map<string, number>();
  const cites = new Map<string, string[]>(); // raw resource → Source pages that cite it
  const titles = new Map<string, string>();

  for (const d of wiki) {
    const { fm, path } = d;
    if (!fm.type) push("error", path, "type manquant");
    if (!pagePat.test(path.replace(/^wiki\//, "").replace(/\.md$/, ""))) push("warning", path, `nom hors du modèle page_path « ${tpl.page_path} » (les pages se créent par cortex new)`);
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

  const rawIds = new Map<string, string>();
  for (const d of raw) {
    const { fm, path } = d;
    if (fm.type !== "RawSource") push("error", path, "type: RawSource attendu");
    const dir = path.replace(/^raw\//, "").replace(/\/source\.md$/, "");
    if (!path.endsWith("/source.md") || !rawPat.test(dir)) push("warning", path, `chemin hors du modèle raw_path « ${tpl.raw_path} » (les sources s'ajoutent par cortex add)`);
    const id = dir.split("/").at(-1)!;
    if (rawIds.has(id)) push("error", path, `id raw en double : ${id} (aussi ${rawIds.get(id)}) ; le journal ne peut pas distinguer les deux`);
    else rawIds.set(id, path);
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

  // journal: invalid lines = error; log.md must be exactly the generation of log.jsonl
  const journal = readLog(root);
  for (const e of journal.errors) push("error", `wiki/log.jsonl:${e.line}`, e.msg);
  const md = join(root, "wiki/log.md");
  if (existsSync(md) || journal.entries.length) {
    if (!existsSync(md) || (await Bun.file(md).text()) !== renderLogMd(journal.entries, new Map(wiki.filter((d) => d.fm.title).map((d) => [d.path, String(d.fm.title)]))))
      push("warning", "wiki/log.md", "diffère de sa génération depuis wiki/log.jsonl (édité à la main ?) : cortex index le régénère");
  }
  return out;
}
