// Rattachement d'un produit à une saison PE/AH pour l'écran « À vendre ».
//
// Le lien produit → saison n'existe pas en base : il est reconstitué. Jusqu'ici l'écran
// reprenait telles quelles les saisons des commandes clients, donc les deux saisons
// SENTINELLES « Réassort » et « Hors-saison » — au point que 1 087 produits sur 1 570
// apparaissaient à la fois sous leur vraie collection ET sous une sentinelle.
//
// Ici on ne retient que des saisons PE/AH, via une cascade de trois règles, la plus sûre
// d'abord. Rien n'est écrit en base : c'est un calcul de lecture, propre à cet écran.
// Les commandes et la synchro TIO gardent leurs saisons sentinelles, qui restent utiles
// ailleurs (écran Commandes client, rapprochement BL/FAC).

/**
 * Code saison porté par la PREMIÈRE LETTRE de la référence — convention interne MCS :
 * une lettre par saison, en alternance PE/AH.
 *
 * ⚠️ Vérifié sur les données réelles, et volontairement LIMITÉ à K→S : sur ces neuf
 * lettres la règle retrouve la saison de lancement de façon quasi parfaite
 * (P 153/153, Q 136/136, R 123/123, S 139/139, O 148/149, N 153/159, M 103/106,
 * K 108/111, L 86/108). En dehors, elle est fausse : les préfixes `AM`, `CC`, `CM`, `TH`,
 * `DM`, `ZZ`… désignent des LIGNES de produits, pas des saisons — `AM` prédirait PE18 pour
 * des accessoires réellement lancés en AH26. Ne pas étendre cette table sans re-vérifier.
 */
export const SEASON_LETTERS: Record<string, string> = {
  K: "PE23",
  L: "AH23",
  M: "PE24",
  N: "AH24",
  O: "PE25",
  P: "AH25",
  Q: "PE26",
  R: "AH26",
  S: "PE27",
};

/** Vrai pour une saison de collection (les sentinelles Réassort/Hors-saison sont exclues). */
export function isRealSeason(name: string | null | undefined): boolean {
  return !!name && /^(PE|AH)\d{2}$/.test(name);
}

/** Rang chronologique d'une saison ("PE23" < "AH23" < "PE24"). */
export function seasonRank(name: string): number {
  if (!isRealSeason(name)) return Number.MAX_SAFE_INTEGER;
  const year = 2000 + Number(name.slice(2));
  return year * 2 + (name.startsWith("PE") ? 0 : 1);
}

/** Saisons triées de la plus ancienne à la plus récente. */
export function sortSeasons(names: string[]): string[] {
  return [...new Set(names.filter(isRealSeason))].sort((a, b) => seasonRank(a) - seasonRank(b));
}

/** Saison déduite de la référence, ou null si la lettre n'est pas dans la table vérifiée. */
export function seasonFromReference(reference: string | null | undefined): string | null {
  const letter = String(reference ?? "").charAt(0).toUpperCase();
  return SEASON_LETTERS[letter] ?? null;
}

export type SeasonOrigin = "commande" | "reference-soeur" | "prefixe" | "inconnue";

export interface ResolvedSeason {
  /** Saison de rattachement (collection de lancement), ou null si indéterminable. */
  season: string | null;
  /** Toutes les saisons PE/AH où le produit a été commandé — sert au filtre. */
  seasons: string[];
  /** D'où vient `season` : utile pour signaler une saison DÉDUITE et non constatée. */
  origin: SeasonOrigin;
}

/**
 * Cascade de rattachement :
 *  1. saisons PE/AH des commandes clients du produit → la plus ANCIENNE fait foi
 *     (c'est sa collection de lancement ; un produit qui se recommande ensuite ne
 *     change pas de collection) ;
 *  2. à défaut, la plus ancienne saison d'une autre COULEUR de la même référence —
 *     une référence appartient à une collection, ses coloris ne se dispersent pas ;
 *  3. à défaut, la lettre de la référence (table vérifiée ci-dessus) ;
 *  4. sinon `null` : produit de collection antérieure à PE23, qu'on affiche à part
 *     plutôt que de lui inventer une saison.
 */
export function resolveProductSeason(input: {
  reference: string;
  orderSeasons: string[];
  siblingSeasons?: string[];
}): ResolvedSeason {
  const seasons = sortSeasons(input.orderSeasons);
  if (seasons.length > 0) return { season: seasons[0], seasons, origin: "commande" };

  const siblings = sortSeasons(input.siblingSeasons ?? []);
  if (siblings.length > 0) return { season: siblings[0], seasons, origin: "reference-soeur" };

  const fromRef = seasonFromReference(input.reference);
  if (fromRef) return { season: fromRef, seasons, origin: "prefixe" };

  return { season: null, seasons, origin: "inconnue" };
}
