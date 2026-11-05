import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Config read by `cortex export` (Vite API): CORTEX_SITE_DATA = data folder, CORTEX_SITE_OUT = output.
// To develop the site: CORTEX_SITE_DATA=<root>/.cortex/site-data bunx --bun vite dev (from site/).
const out = process.env.CORTEX_SITE_OUT ?? "build";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      // `404.html`: shell that static hosting serves for any unknown address (GitHub Pages, Netlify, Cloudflare Pages…);
      // the router shows `routes/+error.svelte` there. It loads its resources from `paths.base` (SvelteKit cannot
      // make them relative for an arbitrary address): domain root by default, CORTEX_SITE_BASE=/subpath otherwise.
      adapter: adapter({ pages: out, assets: out, fallback: "404.html" }),
      version: { name: process.env.CORTEX_SITE_VERSION ?? "dev" }, // deterministic (fingerprint of the data and the frontend): the export is reproducible
      paths: { relative: true, base: process.env.CORTEX_SITE_BASE ?? "" }, // relative links and resources: works under any subpath
      prerender: {
        handleHttpError: "fail", handleMissingId: "ignore", // a broken anchor in a wiki link is harmless, a 404 is not
        // tags are optional and a new wiki has no page: these routes may have no entry; any other unseen route is a bug
        handleUnseenRoutes: ({ routes, message }) => {
          if (routes.some((r) => r !== "/tags/[tag]" && r !== "/wiki/[...path]")) throw new Error(message);
        },
      },
    }),
  ],
});
