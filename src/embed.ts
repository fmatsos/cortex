import { mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { endpoint, loadConfig } from "./config";
import { isReservedPage, readDocs, sha256 } from "./lib";
import { warn } from "./style";

// --- Semantic search: Qwen3-Embedding behind an OpenAI-compatible `POST <base_url>/embeddings` (llama.cpp…). Off unless
// cortex.json has an `embed` block. `refresh` (cortex index) is the only writer; `nearest` and `similar` only read.

export const EMBED = {
  /** One call of `nearest` (the query): past it the server counts as down and search falls back to BM25. */
  timeoutMs: 3000,
  /** One batch of `refresh` (pages of up to `docChars`, far slower than a query). */
  indexTimeoutMs: 30_000,
  /** Pages per call of `refresh`: 1, the inputs of one call share the server's context (qwen3-embed: c = 2048 for all of them). */
  batch: 1,
  /** Characters of a page sent to the model: under 2048 tokens even for Markdown dense in links (~2.8 characters per token). */
  docChars: 4000,
  /** `search`: candidates kept from each ranking before the fusion. */
  topK: 50,
  /** Reciprocal rank fusion constant. */
  rrfK: 60,
  /** `similar`: least cosine for a page to count as close in meaning (not calibrated yet). */
  minSimilar: 0.5,
  /** Seconds the server is left alone after a failed call. */
  downMs: 30_000,
  /** Qwen3-Embedding wants an English instruction on queries only, even for French. */
  queryPrefix: "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
} as const;

export type EmbedConfig = { url: string; key?: string; model: string; dims: number };
type Store = { model: string; dims: number; pages: Record<string, { hash: string; vec: number[] }> };
export type Near = { path: string; score: number };

/**
 * The effective `embed` settings, undefined when the feature is off (or cortex.json unreadable). URL and key follow the
 * openai client (backends/openai.ts): `embed.base_url`, else `base_url`, else $OPENAI_BASE_URL, else a local Ollama; the
 * $OPENAI_API_KEY only goes to a URL that the environment names (a cloned wiki must not send it to another host).
 */
export async function embedConfig(root: string): Promise<EmbedConfig | undefined> {
  const c = await loadConfig(root).catch(() => undefined);
  if (!c?.embed) return;
  return { ...endpoint(c, c.embed.base_url ?? undefined), model: c.embed.model ?? "qwen3-embed", dims: c.embed.dims ?? 256 };
}

const unit = (fm: Record<string, unknown>, body: string) => `${fm.title ?? ""}\n${fm.description ?? ""}\n${body}`.slice(0, EMBED.docChars);

/** Unit vectors (truncated to `dims`, renormalized: Matryoshka) of `texts`, in order. Throws if the server fails or times out. */
export async function embed(texts: string[], cfg: EmbedConfig, timeoutMs: number = EMBED.timeoutMs): Promise<number[][]> {
  const res = await fetch(`${cfg.url}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.key && { authorization: `Bearer ${cfg.key}` }) },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(timeoutMs), timeout: false,
  });
  if (!res.ok) throw new Error(`${cfg.url} answered ${res.status}`);
  const data = ((await res.json()) as { data?: { index?: number; embedding: number[] }[] }).data;
  if (data?.length !== texts.length) throw new Error(`${cfg.url}: ${data?.length ?? 0} embeddings for ${texts.length} texts`);
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(({ embedding }) => {
    const v = embedding.slice(0, cfg.dims), n = Math.hypot(...v) || 1;
    return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
  });
}

const storeFile = (root: string) => join(root, ".cortex/embeddings.json");
const cache = new Map<string, { sig: string; store: Store }>(); // a long-lived `cortex mcp` rereads the file only when it changed

function readStore(root: string): Store | undefined {
  const f = storeFile(root);
  try {
    const st = statSync(f), sig = `${st.mtimeMs}:${st.size}`, hit = cache.get(f);
    if (hit?.sig === sig) return hit.store;
    const store = JSON.parse(readFileSync(f, "utf8")) as Store;
    if (typeof store?.model !== "string" || typeof store.pages !== "object") return;
    cache.set(f, { sig, store });
    return store;
  } catch { return; }
}

let warned = false;
const downUntil = new Map<string, number>(); // by server: a long-lived `cortex mcp` tries again after `downMs`
const warnOnce = (msg: string) => { if (!warned) { warned = true; warn(msg); } };

/** Embeds the wiki pages that are new or changed since the last run (hash of title + description + body) and drops the removed ones. */
export async function refresh(root: string): Promise<{ embedded: number; removed: number } | undefined> {
  const cfg = await embedConfig(root);
  if (!cfg) return;
  const old = readStore(root);
  const usable = old?.model === cfg.model && old.dims === cfg.dims ? old.pages : {}; // another model or size: everything is redone
  const pages: Store["pages"] = {}, todo: { path: string; hash: string; text: string }[] = [];
  for (const d of (await readDocs(root, "wiki")).docs) {
    if (isReservedPage(d.path)) continue;
    const text = unit(d.fm, d.body), hash = sha256(text);
    if (usable[d.path]?.hash === hash) pages[d.path] = usable[d.path]; else todo.push({ path: d.path, hash, text });
  }
  const removed = Object.keys(usable).filter((p) => !(p in pages) && !todo.some((t) => t.path === p)).length;
  let embedded = 0;
  try {
    for (let i = 0; i < todo.length; i += EMBED.batch) {
      const batch = todo.slice(i, i + EMBED.batch);
      const vecs = await embed(batch.map((t) => t.text), cfg, EMBED.indexTimeoutMs);
      batch.forEach((t, j) => { pages[t.path] = { hash: t.hash, vec: vecs[j] }; });
      embedded += batch.length;
    }
  } catch (e) { warn(`embeddings: ${(e as Error).message}; ${embedded}/${todo.length} pages embedded, the rest on the next cortex index.`); }
  for (const t of todo) if (!pages[t.path] && usable[t.path]) pages[t.path] = usable[t.path]; // not re-embedded (server down): the old vector beats none, the hash retries it
  if (embedded || removed || !old || usable !== old.pages) {
    mkdirSync(join(root, ".cortex"), { recursive: true });
    await Bun.write(`${storeFile(root)}.tmp`, JSON.stringify({ model: cfg.model, dims: cfg.dims, pages } satisfies Store));
    renameSync(`${storeFile(root)}.tmp`, storeFile(root));
  }
  return { embedded, removed };
}

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s; };
const top = (pages: Store["pages"], q: number[], k: number, skip?: string): Near[] =>
  Object.entries(pages).filter(([p]) => p !== skip).map(([path, { vec }]) => ({ path, score: dot(q, vec) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, k);

/**
 * The `k` wiki pages closest in meaning to `text` (cosine, best first), or undefined when semantic search is not
 * available: no `embed` config, no store yet (cortex index), store of another model, server down (one warning).
 * `asQuery` (default): `text` is a search query and gets the model's instruction; false for a page-like text (duplicate check).
 */
export async function nearest(root: string, text: string, k: number, asQuery = true): Promise<Near[] | undefined> {
  const cfg = await embedConfig(root);
  if (!cfg) return;
  const s = readStore(root);
  if (!s || s.model !== cfg.model || s.dims !== cfg.dims) { warnOnce("embeddings: store missing or built by another model: run cortex index. Search is BM25 only."); return; }
  if (Date.now() < (downUntil.get(cfg.url) ?? 0)) return;
  try { return top(s.pages, (await embed([asQuery ? `${EMBED.queryPrefix}${text}` : text], cfg))[0], k); }
  catch (e) { downUntil.set(cfg.url, Date.now() + EMBED.downMs); warnOnce(`embeddings: ${(e as Error).message}. Search is BM25 only.`); }
}

/** The `k` pages closest in meaning to the wiki page `path`, from the stored vectors (no server call); undefined when it has none. */
export async function similar(root: string, path: string, k: number): Promise<Near[] | undefined> {
  const cfg = await embedConfig(root), s = readStore(root);
  if (!cfg || !s || s.model !== cfg.model || s.dims !== cfg.dims || !s.pages[path]) return;
  return top(s.pages, s.pages[path].vec, k, path);
}
