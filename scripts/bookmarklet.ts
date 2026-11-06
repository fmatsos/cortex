/**
 * The Android bookmarklet: `extension/mobile.js` bundled with Turndown and the capture code into one minified script, built on first use
 * from node_modules and the sources (the extension's vendor/ is not needed). It must carry all its code: a page such as LinkedIn
 * (https, CSP) could not load a script from the http LAN server.
 */
let bundle: Promise<string> | undefined;

async function build(): Promise<string> {
  const r = await Bun.build({ entrypoints: [new URL("../extension/mobile.js", import.meta.url).pathname], target: "browser", format: "iife", minify: true });
  if (!r.success) throw new Error(`bookmarklet: ${r.logs.join("\n")}`);
  return r.outputs[0].text();
}

/** The `javascript:` URL for a share app at `server` (origin, no trailing slash). Percent-encoded: the browser decodes it before it runs it. */
export async function bookmarklet(server: string): Promise<string> {
  bundle ??= build().catch((e) => { bundle = undefined; throw e; });
  return `javascript:${encodeURIComponent(`globalThis.__cortexServer=${JSON.stringify(server)};${await bundle}\n;void 0`)}`;
}
