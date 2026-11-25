import { rmSync } from "node:fs";
import { join } from "node:path";
import { endpoint, loadConfig } from "./config";
import { defaultThreads, localEmbed } from "./embed-local";
import { sha256 } from "./lib";
import { buildIndex, getMeta, gcVectors, type Index, type Kind, nearestDocs, pageVector, pathsOf, pending, prepareVectors, putVector, setMeta, vectorModel, vectorOf } from "./search-index";
import { note, warn } from "./style";

// --- Embeddings: the vectors of the hybrid search (search.ts). Off unless cortex.json has an `embed` block. Two providers:
// `openai` (default: Qwen3-Embedding behind an OpenAI-compatible `POST <base_url>/embeddings`, llama.cpp…) and `local` (a
// multilingual-e5 model run in this process). `refresh` (cortex index, the serve rebuild) is the only writer of the vectors,
// into the search index (search-index.ts); `nearest`, `similar` and `queryUnits` only read.

export const EMBED = {
  /** One call of a query to the server: past it the server counts as down and search falls back to words. */
  timeoutMs: 3000,
  /** One batch of `refresh` through the server (units of up to `docChars`, far slower than a query). */
  indexTimeoutMs: 30_000,
  /** Units per call of `refresh` (server). */
  batch: 8,
  /** Units per pass of the local model (more only costs memory: the cost per unit is flat). */
  localBatch: 16,
  /** `search`: candidates kept from each ranking before the fusion (the vector ranking draws `vectorOversample` times more units: they are then folded by page). */
  pool: 60,
  vectorOversample: 3,
  /** Reciprocal rank fusion constant. */
  rrfK: 60,
  /** Seconds the server is left alone after a failed call. */
  downMs: 30_000,
} as const;

export const E5_MODEL = "Xenova/multilingual-e5-small";
export type Role = "query" | "passage";
/** Which candidates stay: at least `floor`, within `margin` of the best, at most `max`. */
export type Keep = { floor: number; margin: number; max: number };
/**
 * What depends on the model rather than on the provider: the prefixes it was trained with, how much of a text it reads, and the
 * thresholds of its cosines (they have another spread from one model to the next). Symmetric tasks (duplicate check, pages
 * close to a page) embed the text as a `passage` too: it is compared with stored passages.
 */
export type Profile = {
  name: "qwen3" | "e5";
  prefix: Record<Role, string>;
  docChars: number;
  dims: number;
  /** New page: a candidate this close is refused without a judge (`cosine`), listed as a warning (`warn`). */
  dups: { cosine: number; warn: number };
  /** Pages close in meaning to a page (`related`): which of the nearest stay. */
  related: Keep;
  /** Search: which units the vector ranking contributes. */
  query: Keep;
};
const ALL: Keep = { floor: -1, margin: Infinity, max: Infinity };
export const PROFILES: Record<Profile["name"], Profile> = {
  // Qwen3-Embedding: an English instruction on queries only, even for French. Thresholds measured on a real French wiki (356 pages, qwen3-embed, 256 dims;
  // scripts/calibrate-embeddings.ts): `related.floor`: 180 neighbour pairs labelled by hand, ~50 % of the pairs under 0.70 are unrelated against 3.5 % over;
  // `dups`: the check compares the title and description of the new page with whole-page vectors, 163 distinct pages never exceed 0.880 (Opus 5.5 / Fable 5.2,
  // Copilot / Cursor, versions of a product) while paraphrases of a page score 0.80-0.95 (rewrites of the same subject from another angle: 0.61-0.84): `cosine`
  // refuses with no judge only what is almost a copy, `warn` lists what the judge should look at.
  qwen3: {
    name: "qwen3", dims: 256, docChars: 6000,
    prefix: { query: "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:", passage: "" },
    dups: { cosine: 0.9, warn: 0.75 },
    related: { floor: 0.7, margin: Infinity, max: Infinity }, query: ALL,
  },
  // multilingual-e5: `query: ` / `passage: `. Its cosines are packed high (unrelated French texts 0.72-0.87, same subject 0.82-0.88,
  // paraphrase 0.89-0.96, near-duplicate 0.99): a fixed floor cannot tell, so what stays is relative to the best (rank + margin),
  // over a floor just above the unrelated median. Measured on a 6-subject corpus; `cortex` ships scripts/calibrate-embeddings.ts to redo it on a real wiki.
  e5: {
    name: "e5", dims: 384, docChars: 2000,
    prefix: { query: "query: ", passage: "passage: " },
    dups: { cosine: 0.97, warn: 0.9 },
    related: { floor: 0.8, margin: 0.04, max: 5 }, query: { floor: 0.8, margin: 0.05, max: Infinity },
  },
};
export const profileFor = (model: string): Profile => (/e5/i.test(model) ? PROFILES.e5 : PROFILES.qwen3);

/** The candidates (best first) that `rule` keeps. */
export function keep<T extends { score: number }>(hits: T[], rule: Keep): T[] {
  const best = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= Math.max(rule.floor, best - rule.margin)).slice(0, rule.max);
}

export type EmbedConfig = { provider?: "openai" | "local"; url: string; key?: string; model: string; dims: number; threads?: number };
export type Near = { path: string; score: number };

/**
 * The effective `embed` settings, undefined when the feature is off (or cortex.json unreadable). Without `provider`, a server: URL
 * and key follow the openai client (backends/openai.ts): `embed.base_url`, else `base_url`, else $OPENAI_BASE_URL, else a local
 * Ollama; the $OPENAI_API_KEY only goes to a URL that the environment names (a cloned wiki must not send it to another host).
 */
export async function embedConfig(root: string): Promise<EmbedConfig | undefined> {
  const c = await loadConfig(root).catch(() => undefined);
  if (!c?.embed) return;
  const provider = c.embed.provider ?? "openai", model = c.embed.model ?? (provider === "local" ? E5_MODEL : "qwen3-embed");
  return {
    provider, model, dims: c.embed.dims ?? profileFor(model).dims,
    ...(provider === "local" ? { url: "", threads: c.embed.threads ?? defaultThreads() } : endpoint(c, c.embed.base_url ?? undefined)),
  };
}
/** The model profile of the configured `embed`, undefined when off. */
export async function embedProfile(root: string): Promise<Profile | undefined> {
  const cfg = await embedConfig(root);
  return cfg && profileFor(cfg.model);
}

/** Test hook: replaces the local model (the vectors of `texts`, as the model returns them). */
export const embedHooks: { local?: (texts: string[], cfg: EmbedConfig) => Promise<number[][]> } = {};

const unit = (v: number[] | Float32Array, dims: number) => {
  const cut = Array.from(v.slice(0, dims)), n = Math.hypot(...cut) || 1;
  return cut.map((x) => x / n);
};

/**
 * Unit vectors (truncated to `dims`, renormalized: Matryoshka) of `texts`, in order, as the configured provider gives them;
 * the prefixes are the caller's. Throws if the server fails or times out, or the local model is not available (`download`:
 * the local model may be fetched, by `refresh` only).
 */
export async function embed(texts: string[], cfg: EmbedConfig, timeoutMs: number = EMBED.timeoutMs, download = false): Promise<number[][]> {
  if (cfg.provider === "local") {
    const raw = embedHooks.local ? await embedHooks.local(texts, cfg) : await localEmbed(texts, cfg.model, cfg.threads ?? defaultThreads(), download, EMBED.localBatch);
    return raw.map((v) => unit(v, cfg.dims));
  }
  const res = await fetch(`${cfg.url}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.key && { authorization: `Bearer ${cfg.key}` }) },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(timeoutMs), timeout: false,
  });
  if (!res.ok) throw new Error(`${cfg.url} answered ${res.status}`);
  const data = ((await res.json()) as { data?: { index?: number; embedding: number[] }[] }).data;
  if (data?.length !== texts.length) throw new Error(`${cfg.url}: ${data?.length ?? 0} embeddings for ${texts.length} texts`);
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(({ embedding }) => unit(embedding, cfg.dims).map((x) => Math.round(x * 1e5) / 1e5));
}

/** What the model reads of a doc: its title, then its text. */
export const unitText = (p: Profile, u: { title: string; body: string }) => `${p.prefix.passage}${`${u.title}\n${u.body}`.slice(0, p.docChars)}`;

const told = new Set<string>();
const downUntil = new Map<string, number>(); // by provider and model: a long-lived `cortex mcp` tries again after `downMs`
const warnOnce = (msg: string) => { if (!told.has(msg)) { told.add(msg); warn(msg); } };
/** For the tests: forgets which providers were found down and which warnings were given. */
export function resetEmbedState() { told.clear(); downUntil.clear(); }
const where = (cfg: EmbedConfig) => `${cfg.provider}:${cfg.model}:${cfg.url}`;
const hint = (cfg: EmbedConfig) => cfg.provider === "local" ? ' If the local model cannot run here (macOS, no network), set embed.provider to "openai" with a server.' : "";

/**
 * Embeds the wiki docs (pages and sections) that are new or changed since the last run, and drops the vectors of the removed ones.
 * The text of a doc is hashed with the model: an unchanged section keeps its vector when its page is edited. `embedded` counts the
 * docs sent to the model, `removed` the pages deleted since the last run. The index (words) is brought up to date first, so this
 * also stands for `cortex index` without `embed`: nothing is embedded then.
 */
export async function refresh(root: string): Promise<{ embedded: number; removed: number } | undefined> {
  try { rmSync(join(root, ".cortex/embeddings.json"), { force: true }); } catch { /* the first semantic search kept its vectors there: they are recomputed in the index */ }
  const cfg = await embedConfig(root);
  if (!cfg) return;
  const prof = profileFor(cfg.model), ix = await buildIndex(root);
  try {
    prepareVectors(ix, cfg.model, cfg.dims);
    const removed = Number(getMeta(ix.db, "removed") ?? 0);
    const todo = new Map<string, { text: string; docs: { id: number; kind: Kind }[] }>();
    for (const u of pending(ix.db)) {
      const text = unitText(prof, u), key = sha256(`${cfg.model}\0${text}`);
      (todo.get(key) ?? todo.set(key, { text, docs: [] }).get(key)!).docs.push({ id: u.id, kind: u.kind });
    }
    let embedded = 0;
    const fresh: [string, { text: string; docs: { id: number; kind: Kind }[] }][] = [];
    ix.db.transaction(() => { // a unit whose text was embedded before (an edited page, another section) is only attached
      for (const [key, t] of todo) {
        const v = vectorOf(ix.db, key);
        if (v) putVector(ix, key, v, t.docs); else fresh.push([key, t]);
      }
    }).immediate();
    const total = fresh.reduce((n, [, t]) => n + t.docs.length, 0), size = cfg.provider === "local" ? EMBED.localBatch : EMBED.batch;
    if (total >= 20) note(`embeddings: ${total} pages and sections to embed (${cfg.provider === "local" ? `${cfg.model}, in this process` : cfg.url})…`);
    try {
      for (let i = 0; i < fresh.length; i += size) {
        const batch = fresh.slice(i, i + size);
        const vecs = await embed(batch.map(([, t]) => t.text), cfg, EMBED.indexTimeoutMs, true);
        ix.db.transaction(() => batch.forEach(([key, t], j) => putVector(ix, key, Float32Array.from(vecs[j]), t.docs))).immediate();
        embedded += batch.reduce((n, [, t]) => n + t.docs.length, 0);
      }
    } catch (e) { warn(`embeddings: ${(e as Error).message}; ${embedded}/${total} pages and sections embedded, the rest on the next cortex index.${hint(cfg)}`); }
    gcVectors(ix.db);
    setMeta(ix.db, "removed", 0);
    return { embedded, removed };
  } finally { ix.close(); }
}

/** The index when its vectors are those of the configured model; otherwise undefined, with one warning. */
function ready(ix: Index, cfg: EmbedConfig): boolean {
  const v = vectorModel(ix.db);
  if (v?.model === cfg.model && v.dims === cfg.dims) return true;
  warnOnce("embeddings: not indexed yet, or by another model: run cortex index. Search is by words only.");
  return false;
}

/** The vector of a query (or of a page-like text), undefined when the provider is down (one warning, then left alone for `downMs`). */
async function queryVector(cfg: EmbedConfig, text: string, role: Role): Promise<Float32Array | undefined> {
  if (Date.now() < (downUntil.get(where(cfg)) ?? 0)) return;
  try { return Float32Array.from((await embed([`${profileFor(cfg.model).prefix[role]}${text}`], cfg))[0]); }
  catch (e) { downUntil.set(where(cfg), Date.now() + EMBED.downMs); warnOnce(`embeddings: ${(e as Error).message}. Search is by words only.${hint(cfg)}`); }
}

/** For `search`: the docs (pages and sections) closest in meaning to the query that the model's rule keeps, best first; undefined when not available. */
export async function queryUnits(root: string, ix: Index, text: string): Promise<{ id: number; score: number }[] | undefined> {
  const cfg = await embedConfig(root);
  if (!cfg || !ready(ix, cfg)) return;
  const q = await queryVector(cfg, text, "query");
  return q && keep(nearestDocs(ix, q, EMBED.pool * EMBED.vectorOversample), profileFor(cfg.model).query);
}

const named = (ix: Index, hits: { id: number; score: number }[]): Near[] => {
  const paths = pathsOf(ix.db, hits.map((h) => h.id));
  return hits.map((h) => ({ path: paths.get(h.id)!, score: h.score })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
};

/**
 * The `k` wiki pages closest in meaning to `text` (cosine, best first), or undefined when semantic search is not available: no
 * `embed` config, index of another model (or not embedded yet), provider down (one warning). `asQuery` (default): `text` is a
 * search query and gets the model's query prefix; false for a page-like text (duplicate check, ingest routing), taken as a passage.
 */
export async function nearest(root: string, text: string, k: number, asQuery = true): Promise<Near[] | undefined> {
  const cfg = await embedConfig(root);
  if (!cfg) return;
  const ix = await buildIndex(root);
  try {
    if (!ready(ix, cfg)) return;
    const q = await queryVector(cfg, text, asQuery ? "query" : "passage");
    return q && named(ix, nearestDocs(ix, q, k, "page"));
  } finally { ix.close(); }
}

/** The `k` pages closest in meaning to the wiki page `path`, from the stored vectors (no model call); undefined when it has none. */
export async function similar(root: string, path: string, k: number): Promise<Near[] | undefined> {
  const cfg = await embedConfig(root);
  if (!cfg) return;
  const ix = await buildIndex(root);
  try {
    const v = vectorModel(ix.db), own = v?.model === cfg.model && v.dims === cfg.dims ? pageVector(ix.db, path) : undefined;
    return own && named(ix, nearestDocs(ix, own, k + 1, "page")).filter((n) => n.path !== path).slice(0, k);
  } finally { ix.close(); }
}

/** Of the pages `similar` returned for `root`, those that count as close in meaning (the model's rule: relative to the best for e5). */
export async function keepRelated(root: string, hits: Near[]): Promise<Near[]> {
  const p = await embedProfile(root);
  return p ? keep(hits, p.related) : [];
}
