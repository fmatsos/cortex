import { site } from "#lib/server/data.js";

export const load = () => ({ tags: site().tags.map((t) => ({ tag: t.tag, slug: t.slug, count: t.ids.length })) });
