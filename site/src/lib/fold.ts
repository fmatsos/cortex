/** Lowercase without accents: same length as the original for precomposed characters (reliable highlighting). */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
