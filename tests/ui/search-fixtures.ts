import type { Page } from "@playwright/test";

// A search index of our own for a spec (`/search-index.json` is answered by the test): the exported fixture wiki has a handful of pages,
// too few to cross the server's 50-hit limit, and its descriptions are plain text.
export type IndexDoc = { id: string; title: string; description?: string; type?: string; tags?: string[]; text?: string };

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function buildIndex(input: IndexDoc[]) {
  const docs = input.map((d) => ({ description: "", type: "Concept", tags: [] as string[], text: "", status: "stable", verified: true, ...d }));
  const terms: Record<string, number[]> = Object.create(null);
  docs.forEach((d, i) => {
    for (const w of new Set(words(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`))) (terms[w] ??= []).push(i);
  });
  return { docs, terms: { ...terms }, vocab: [] as string[] };
}

export async function mockIndex(page: Page, input: IndexDoc[]) {
  const body = JSON.stringify(buildIndex(input));
  await page.route("**/search-index.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}
