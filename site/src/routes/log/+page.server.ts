import { site } from "#lib/server/data.js";

export const load = () => ({ html: site().log });
