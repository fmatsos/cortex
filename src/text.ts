/** One collator for every sort of titles (index.md, the site data, the journal): French rules, whatever the runtime locale. */
export const collator = new Intl.Collator("fr", { numeric: true });
