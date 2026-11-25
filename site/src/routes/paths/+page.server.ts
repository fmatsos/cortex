import { readingPaths } from "#lib/server/paths-data.js";

export const load = () => ({ paths: readingPaths().map((p) => ({ slug: p.slug, title: p.title, goal: p.goal, steps: p.steps.length })) });
