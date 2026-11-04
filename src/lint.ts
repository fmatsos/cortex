import { existsSync } from "node:fs";
import { join } from "node:path";
import { rawId, REPORTED_FIELDS, toResource } from "./doc";
import { openWiki, type Wiki } from "./context";
import { isReservedPage, slugify, wikiLinks } from "./lib";
import { pattern } from "./template";
import { renderLogMd } from "./log";

export type Issue = { level: "error" | "warning" | "info"; path: string; msg: string };

const DAY = 86_400_000;
const time = (x: string | Date | null | undefined) => (x == null ? NaN : new Date(x).getTime()); // YAML may yield Date or string

export async function lintCtx(w: Wiki, now = new Date()): Promise<Issue[]> {
  const root = w.root;
  const out: Issue[] = [];
  const push = (level: Issue["level"], path: string, msg: string) => out.push({ level, path, msg });
  const tpl = await w.naming(), pagePat = pattern(tpl.page_path), rawPat = pattern(tpl.raw_path);
  const [all, raw] = [await w.pages(), await w.raws()];
  for (const e of [...w.errors.pages, ...w.errors.raws]) push("error", e.path, `YAML invalide : ${e.msg}`);
  const wiki = all.filter((d) => !isReservedPage(d.path));
  const inbound = new Map<string, number>();
  const cites = await w.citations(); // raw resource → Source pages that cite it
  const titles = new Map<string, string>();

  for (const d of wiki) {
    const { fm, path } = d;
    for (const i of d.issues) if (REPORTED_FIELDS.has(i.field)) push("error", path, i.msg); // type, title, status, tags
    if (!pagePat.test(path.replace(/^wiki\//, "").replace(/\.md$/, ""))) push("warning", path, `nom hors du modèle page_path « ${tpl.page_path} » (les pages se créent par cortex new)`);
    if (!fm.description) push("error", path, "description manquante");
    const ids = new Set((fm.sources ?? []).map((s) => s.id));
    for (const s of fm.sources ?? []) {
      if (!s.resource || !existsSync(join(root, s.resource))) push("error", path, `source introuvable : ${s.resource}`);
    }
    for (const [, id] of d.body.matchAll(/\[\^([\w-]+)\]/g)) if (!ids.has(id)) push("error", path, `note [^${id}] sans entrée sources[]`);
    for (const l of wikiLinks(d.body)) { // duplicates kept: one error per broken link occurrence
      inbound.set(l, (inbound.get(l) ?? 0) + 1);
      if (!existsSync(join(root, l))) push("error", path, `lien cassé : /${l}`);
    }
    // a relative link to a .md is not a graph edge nor a working link on the site: only root-relative `/wiki/…md` links count
    for (const [, target] of d.body.matchAll(/\]\((?![a-z][a-z0-9+.-]*:|\/|#)([^)\s]*\.md(?:#[^)\s]*)?)\)/gi)) push("warning", path, `lien relatif vers un .md : ${target} (utilise un lien depuis la racine : /wiki/….md)`);
    const g = time(fm.generated?.at), v = time(fm.verified?.at);
    if (!fm.verified) push("info", path, "jamais relue");
    else if (g > v) push("warning", path, "modifiée depuis la relecture (generated.at > verified.at) : à relire");
    if (time(fm.stale_after) < now.getTime()) push("warning", path, `périmée depuis ${String(fm.stale_after).slice(0, 10)} (stale_after)`);
    const t = slugify(String(fm.title ?? ""));
    if (titles.has(t)) push("warning", path, `doublon probable de ${titles.get(t)} (même titre)`);
    else titles.set(t, path);
  }
  for (const d of wiki) if (d.fm.type !== "Source" && !inbound.get(d.path)) push("warning", d.path, "orpheline : aucun lien entrant");
  for (const [res, pages] of cites) if (pages.length > 1 && existsSync(join(root, res))) push("warning", pages[1].path, `doublon probable de ${pages[0].path} (même source raw ${res})`);

  const rawIds = new Map<string, string>();
  for (const d of raw) {
    const { fm, path } = d;
    if (fm.type !== "RawSource") push("error", path, "type: RawSource attendu");
    const dir = path.replace(/^raw\//, "").replace(/\/source\.md$/, ""); // the folder of the source, checked against raw_path
    if (!path.endsWith("/source.md") || !rawPat.test(dir)) push("warning", path, `chemin hors du modèle raw_path « ${tpl.raw_path} » (les sources s'ajoutent par cortex add)`);
    const id = rawId(path);
    if (rawIds.has(id)) push("error", path, `id raw en double : ${id} (aussi ${rawIds.get(id)}) ; le journal ne peut pas distinguer les deux`);
    else rawIds.set(id, path);
    if (fm.status === "pending") {
      if (!String(fm.note ?? "").trim()) push("warning", path, "note manquante : à demander avant de compiler");
      if (now.getTime() - time(fm.fetched_at) > 7 * DAY) push("warning", path, "en attente depuis plus de 7 jours");
    }
    if (fm.status === "compiled" && !cites.has(toResource(path))) push("warning", path, "compilée mais aucune page Source ne la cite");
  }

  const tags = new Map<string, string>();
  for (const d of wiki) for (const tag of d.fm.tags ?? []) {
    const k = slugify(String(tag)).replace(/s$/, "");
    const seen = tags.get(k);
    if (seen && seen !== tag) push("warning", d.path, `tags quasi synonymes : « ${seen} » et « ${tag} »`);
    else tags.set(k, tag);
  }

  // journal: invalid lines = error; log.md must be exactly the generation of log.jsonl
  const journal = w.journal();
  for (const e of journal.errors) push("error", `wiki/log.jsonl:${e.line}`, e.msg);
  const md = join(root, "wiki/log.md");
  if (existsSync(md) || journal.entries.length) {
    if (!existsSync(md) || (await Bun.file(md).text()) !== renderLogMd(journal.entries, await w.titles()))
      push("warning", "wiki/log.md", "diffère de sa génération depuis wiki/log.jsonl (édité à la main ?) : cortex index le régénère");
  }
  return out;
}
export const lint = (root: string, now = new Date()) => lintCtx(openWiki(root), now);
