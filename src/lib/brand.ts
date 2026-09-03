// Marque d'un produit, déduite du PRÉFIXE de sa référence.
//
// Règle métier : les deux premières lettres de la référence désignent la marque.
// Tout ce qui n'est pas explicitement listé appartient à MCS, la marque principale —
// c'est un repli volontaire, pas un « inconnu ».
//
// ⚠️ À ne pas confondre avec `lib/a-vendre-season.ts`, qui lit la PREMIÈRE lettre pour en
// déduire la saison (K→PE23 … S→PE27). Les deux lectures coexistent sur la même
// référence : `RMPULL_W001` est une MCS (préfixe RM) de la saison AH26 (lettre R).

/** Préfixe de référence (2 lettres, majuscules) → marque. */
export const BRAND_PREFIXES: Record<string, string> = {
  TH: "TDH",
  CC: "Country Classic",
};

/** Marque par défaut : tout ce qui ne porte aucun préfixe listé. */
export const DEFAULT_BRAND = "MCS";

/** Marque d'une référence produit. Une référence vide reste rattachée à MCS. */
export function brandOf(reference: string | null | undefined): string {
  const prefix = String(reference ?? "").trim().toUpperCase().slice(0, 2);
  return BRAND_PREFIXES[prefix] ?? DEFAULT_BRAND;
}

/**
 * Marques distinctes d'un ensemble de références, triées alphabétiquement.
 * Le tri est alphabétique et non « MCS d'abord » : l'ordre reste ainsi prévisible
 * quelles que soient les marques présentes.
 */
export function brandsOf(references: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const ref of references) set.add(brandOf(ref));
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
