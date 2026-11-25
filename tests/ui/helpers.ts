import { test as base, expect } from "@playwright/test";

// `test` for every UI spec: baseURL is the exported site served by global-setup, and a test fails on any uncaught page
// error or console error (a failed resource load is a console error too), even when its own assertions pass.
export const test = base.extend<{ errors: string[] }>({
  baseURL: async ({}, use) => { await use(process.env.CORTEX_UI_BASE); },
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // a static host has no /api/: the site's HEAD probes (assistant, review) 404 by design and the browser logs them
      if (new URL(m.location().url || "http://x/").pathname.startsWith("/api/")) return;
      errors.push(`console.error: ${m.text()} (${m.location().url})`);
    });
    await use(errors);
    expect(errors, "uncaught page errors or console errors").toEqual([]);
  }, { auto: true }],
});

export { expect };
