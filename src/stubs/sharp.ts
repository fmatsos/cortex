// Stands for `sharp` (image processing) in the compiled binary: @huggingface/transformers imports it for its image pipelines, which
// cortex never uses (text embeddings only), and its native packages are not installed (`--omit optional`). Mapped by tsconfig.json `paths`.
export default function sharp(): never {
  throw new Error("sharp is not available in this build");
}
