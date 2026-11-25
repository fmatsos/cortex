import { intlLocale } from "#lib/i18n/index.js";

/** Day, month and year of an ISO date in the interface language. */
export const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" });
