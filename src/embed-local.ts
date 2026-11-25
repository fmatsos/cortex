import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { prepareOrt, userCache } from "./native";
import { note } from "./style";

/**
 * The local embedding provider: a transformers.js feature-extraction pipeline (ONNX runtime, q8 weights) in this process.
 * Loaded on first use only, and the model downloaded only when the caller allows it (`cortex index`, the `serve` rebuild),
 * never by a search or any offline command. The model is kept in the user's cache, shared by every wiki.
 */
type Extractor = (texts: string[], o: object) => Promise<{ data: Float32Array; dims: number[] }>;

/** Where the models are kept: $CORTEX_MODEL_CACHE, else <user cache>/cortex/models. */
export const modelCache = () => process.env.CORTEX_MODEL_CACHE || join(userCache(), "models");
/** ONNX threads when `embed.threads` is not set: the model gains little beyond 4, and the machine has other work. */
export const defaultThreads = () => Math.max(1, Math.min(4, availableParallelism()));

let loaded: { key: string; pipe: Promise<Extractor> } | undefined;
let queue: Promise<unknown> = Promise.resolve(); // one batch at a time through the session

async function load(model: string, threads: number, download: boolean): Promise<Extractor> {
  await prepareOrt();
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = modelCache();
  env.allowRemoteModels = download;
  if (download && !existsSync(join(env.cacheDir, model, "onnx/model_quantized.onnx"))) note(`embeddings: downloading ${model} (about 120 MB, once, into ${env.cacheDir})…`);
  return (await pipeline("feature-extraction", model, { dtype: "q8", session_options: { intraOpNumThreads: threads } } as object)) as unknown as Extractor;
}

/** Unit vectors (mean pooling, normalized) of `texts`, as the model gives them, in order. Throws when the model or the runtime cannot be loaded. */
export function localEmbed(texts: string[], model: string, threads: number, download: boolean, batch = 16): Promise<Float32Array[]> {
  const run = queue.then(async () => {
    const key = `${model}:${threads}`;
    if (loaded?.key !== key) {
      const pipe = load(model, threads, download);
      loaded = { key, pipe };
      pipe.catch(() => { if (loaded?.pipe === pipe) loaded = undefined; }); // a failed load is tried again (with a download, once allowed)
    }
    const ex = await loaded!.pipe;
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batch) {
      const t = await ex(texts.slice(i, i + batch), { pooling: "mean", normalize: true });
      const dim = t.dims[1];
      for (let j = 0; j < t.dims[0]; j++) out.push(t.data.slice(j * dim, (j + 1) * dim));
    }
    return out;
  });
  queue = run.catch(() => {});
  return run;
}
