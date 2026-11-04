/** Minuscules sans accents : même longueur que l'original pour les caractères précomposés (surlignage fiable). */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
