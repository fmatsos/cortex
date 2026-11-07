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

/** Percent-encodes what is not a safe URL character (%, #, blanks, < > " ` { } | \ ^, non-ASCII): Chrome Android's bookmark field cut the code at the first `<`. */
export const jsUrl = (code: string) => `javascript:${code.replace(/[^\w\-.~!$&()*+,;=:@/?'\[\]]/g, (c) => encodeURIComponent(c))}`;

/** The `javascript:` URL for a share app at `server` (origin, no trailing slash); the browser decodes it before it runs it. */
export async function bookmarklet(server: string): Promise<string> {
  bundle ??= build().catch((e) => { bundle = undefined; throw e; });
  return jsUrl(`globalThis.__cortexServer=${JSON.stringify(server)};${await bundle};void 0`);
}

/** Test bookmarklets of growing size (red border plus a padding comment): which length this phone's Chrome still runs. */
export const probes = (sizes = [4, 8, 16, 24, 32]) =>
  sizes.map((k) => ({ k, code: jsUrl(`document.body.style.border="8px solid red";/*${"x".repeat(k * 1024)}*/void 0`) }));
