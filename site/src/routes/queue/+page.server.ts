import { site } from "#lib/server/data.js";

export const load = () => ({ entries: site().queue });
