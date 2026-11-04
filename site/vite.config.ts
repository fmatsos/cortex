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
      // `404.html` : coquille que l'hébergement statique sert pour toute adresse inconnue (GitHub Pages, Netlify, Cloudflare Pages…) ;
      // le routeur y affiche `routes/+error.svelte`. Elle charge ses ressources depuis `paths.base` (SvelteKit ne peut pas
      // les relativiser pour une adresse arbitraire) : racine du domaine par défaut, BRAIN_SITE_BASE=/sous-chemin sinon.
      adapter: adapter({ pages: out, assets: out, fallback: "404.html" }),
      version: { name: process.env.BRAIN_SITE_VERSION ?? "dev" }, // déterministe (empreinte des données et du frontend) : l'export est reproductible
      paths: { relative: true, base: process.env.BRAIN_SITE_BASE ?? "" }, // liens et ressources relatifs : fonctionne sous n'importe quel sous-chemin
      prerender: { handleHttpError: "fail", handleMissingId: "ignore" }, // une ancre cassée dans un lien du wiki est sans gravité, un 404 non
    }),
  ],
});
