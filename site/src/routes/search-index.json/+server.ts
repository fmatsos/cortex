import { dataFile } from "#lib/server/data.js";

export const prerender = true;
export const GET = () => new Response(dataFile("search-index.json"), { headers: { "content-type": "application/json" } });
