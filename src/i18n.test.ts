import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../site/src/lib/i18n/en.json";
import fr from "../site/src/lib/i18n/fr.json";
import { chooseLocale, DICTS, translate } from "../site/src/lib/i18n/index";
import { storageKey } from "../site/src/lib/storage";
import { resolveLocale } from "./export";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("en.json and fr.json have the same keys, the same placeholders per key, and no empty string", () => {
  expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  for (const [k, v] of Object.entries(en)) {
    expect(placeholders((fr as Record<string, string>)[k]), k).toEqual(placeholders(v));
    expect(v.trim(), k).not.toBe("");
    expect((fr as Record<string, string>)[k].trim(), k).not.toBe("");
  }
});

test("every key used in the site exists (t / tr calls with a literal key)", () => {
  const dir = join(import.meta.dir, "../site/src");
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(svelte|ts)$/.test(f) && !f.includes("i18n/"));
  const used = new Set<string>();
  for (const f of files) for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\b(?:t|tr)\("([\w.]+)"/g)) used.add(m[1]);
  for (const m of readFileSync(join(import.meta.dir, "export.ts"), "utf8").matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
  const known = new Set(Object.keys(en).map((k) => k.replace(/_(one|other)$/, "")));
  expect([...used].filter((k) => !known.has(k))).toEqual([]);
  expect(used.size).toBeGreaterThan(200);
});

test("translate: placeholders, plural pairs by the locale's rules, missing key shown as is", () => {
  expect(translate(DICTS.en, "en", "common.pages", { count: 1 })).toBe("1 page");
  expect(translate(DICTS.en, "en", "common.pages", { count: 1200 })).toBe("1,200 pages");
  expect(translate(DICTS.fr, "fr", "log.entries", { count: 0 })).toBe("0 entrée"); // French: 0 is singular
  expect(translate(DICTS.fr, "fr", "log.entries", { count: 2 })).toBe("2 entrées");
  expect(translate(DICTS.fr, "fr", "favs.removed", { title: "A" })).toBe("« A » retiré des favoris.");
  expect(translate(DICTS.en, "en", "no.such.key")).toBe("no.such.key");
});

test("resolveLocale: French spellings → fr, anything else (unset, German…) → en", () => {
  for (const l of ["French", "french", "Français", "francais", "FR", "fr-CA", " fr "]) expect(resolveLocale(l)).toBe("fr");
  for (const l of [undefined, null, "", "English", "German", "France", "frisian"]) expect(resolveLocale(l)).toBe("en");
});

test("chooseLocale: a stored en/fr wins, anything else falls back to the export's default", () => {
  expect(chooseLocale("fr", "en")).toBe("fr");
  expect(chooseLocale("en", "fr")).toBe("en");
  for (const v of [null, undefined, "", "system", "de", "FR", '"fr"']) expect(chooseLocale(v, "fr")).toBe("fr");
});

test("storageKey: cortex:<name>, moving a value left under the old brain:<name> key once", () => {
  const mem = new Map<string, string>();
  const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  mem.set("brain:favs", '["a"]');
  expect(storageKey("favs", s)).toBe("cortex:favs");
  expect([...mem]).toEqual([["cortex:favs", '["a"]']]);
  // the new key wins when both exist; the old one is dropped
  mem.set("brain:favs", '["old"]');
  storageKey("favs", s);
  expect([...mem]).toEqual([["cortex:favs", '["a"]']]);
  // no storage, or one that throws: just the key
  expect(storageKey("theme", undefined)).toBe("cortex:theme");
  expect(storageKey("theme", { getItem: () => { throw new Error("denied"); }, setItem() {}, removeItem() {} })).toBe("cortex:theme");
});

test("app.html applies the remembered language before the app loads, with the key lang.svelte.ts writes", () => {
  const html = readFileSync(join(import.meta.dir, "../site/src/app.html"), "utf8");
  expect(html).toContain(`localStorage.getItem("${storageKey("lang")}")`);
  expect(html).toContain("document.documentElement.lang=l");
});
