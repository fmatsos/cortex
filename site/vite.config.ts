import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Config lue par `brain export` (API Vite) : BRAIN_SITE_DATA = dossier des données, BRAIN_SITE_OUT = sortie.
// Pour développer le site : BRAIN_SITE_DATA=<racine>/.brain/site-data bunx --bun vite dev (depuis cli/site/).
const out = process.env.BRAIN_SITE_OUT ?? "build";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ pages: out, assets: out }),
      version: { name: process.env.BRAIN_SITE_VERSION ?? "dev" }, // déterministe (empreinte des données) : l'export est reproductible
      paths: { relative: true }, // liens et ressources relatifs : fonctionne sous n'importe quel sous-chemin
      prerender: { handleHttpError: "fail", handleMissingId: "ignore" }, // une ancre cassée dans un lien du wiki est sans gravité, un 404 non
    }),
  ],
});
