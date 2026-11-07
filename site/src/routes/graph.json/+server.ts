import { dataFile } from "#lib/server/data.js";

export const prerender = true;
export const GET = () => new Response(dataFile("graph.json"), { headers: { "content-type": "application/json" } });
