#!/usr/bin/env bun
/** Copies the two libraries the extension injects (Readability, Turndown) and the icons from node_modules / assets: `bun extension/build.ts`. */
import { copyFileSync, mkdirSync } from "node:fs";

const here = (p: string) => new URL(p, import.meta.url).pathname;
const copies: [string, string][] = [
  ["../node_modules/@mozilla/readability/Readability.js", "vendor/Readability.js"],
  ["../node_modules/turndown/lib/turndown.browser.umd.js", "vendor/turndown.js"],
  ["../assets/logo/cortex-32.png", "icons/icon-32.png"],
  ["../assets/logo/cortex-192.png", "icons/icon-192.png"],
];
for (const [from, to] of copies) { mkdirSync(here(to.replace(/[^/]+$/, "")), { recursive: true }); copyFileSync(here(from), here(to)); }
console.log(`extension: ${copies.length} files copied`);
