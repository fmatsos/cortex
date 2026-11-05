/** Markdown files imported as text (`with { type: "text" }`), embedded in the compiled binary. */
declare module "*.md" {
  const text: string;
  export default text;
}

/** Files imported with `{ type: "file" }`: their path (in the compiled binary, a /$bunfs/ path). */
declare module "*.tar.gz" {
  const path: string;
  export default path;
}
