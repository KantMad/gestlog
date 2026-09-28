// Fiabilité du CA affiché : quelle PART des pièces porte réellement un montant ?
//
// 🔴 `ClientOrderLine.amount` est loin d'être toujours renseigné, et rien ne le disait.
// *Relevé du 28/09/2026 : PE25 a 94,4 % de ses lignes à 0 €, AH25 52,8 %, Réassort 28,7 %.*
// Conséquence directe, signalée par l'exploitant : comparer « MCS Homme W25 » (69 % de
// lignes sans montant, 524 668 € affichés) à « MCS Homme W26 » (0 %, 1 633 676 €) laissait
// croire à un CA triplé — alors que les VOLUMES sont comparables (43 976 contre 41 173
// pièces) et que le prix unitaire, là où il existe, est presque identique (37,17 € contre
// 39,68 €).
//
// ⚠️ On ne reconstitue RIEN. Extrapoler le CA manquant depuis le prix moyen serait
// inventer des euros. On mesure la couverture, on la publie, et l'écran prévient.

export interface CoverageInput {
  /** Montant de la ligne (€). 0 = non renseigné. */
  amount: number;
  /** Quantité commandée sur la ligne. */
  quantity: number;
}

/** Verdict de fiabilité, pour décider du ton de l'avertissement. */
export type CoverageVerdict = "fiable" | "partiel" | "inexploitable";

export interface Coverage {
  lines: number;
  linesWithAmount: number;
  pieces: number;
  /** Pièces portées par des lignes SANS montant. */
  piecesWithoutAmount: number;
  /** Part des pièces couvertes par un montant, en % (une décimale). */
  percent: number;
  /** CA réellement présent (€). */
  amount: number;
  /**
   * Prix moyen LÀ OÙ le montant existe (€/pièce). C'est le repère qui révèle l'anomalie :
   * un écart de 1 à 3 entre deux éléments comparés vient presque toujours d'un trou de
   * couverture, pas d'une hausse de prix.
   */
  pricePerPiece: number;
  verdict: CoverageVerdict;
}

/**
 * Seuils de verdict, en part de pièces couvertes.
 * 95 % et plus : on affiche le CA sans réserve. Sous 70 % : le CA ne veut plus rien dire.
 * Entre les deux : exploitable avec un avertissement.
 */
export const SEUIL_FIABLE = 95;
export const SEUIL_INEXPLOITABLE = 70;

/** Totaux déjà agrégés (par une requête SQL `GROUP BY`, typiquement). */
export interface CoverageTotals {
  lines: number;
  linesWithAmount: number;
  pieces: number;
  /** Pièces portées par des lignes AVEC montant. */
  piecesWithAmount: number;
  amount: number;
}

/**
 * Verdict à partir de totaux déjà agrégés.
 *
 * ⚠️ Point d'entrée unique du verdict : les routes qui agrègent en SQL passent par ici
 * plutôt que de recopier les seuils, pour qu'un seul endroit décide de ce qui est fiable.
 */
export function coverageFromTotals(t: CoverageTotals): Coverage {
  const pieces = Number(t.pieces) || 0;
  const piecesWithAmount = Number(t.piecesWithAmount) || 0;
  const amount = Number(t.amount) || 0;
  const percent = pieces > 0 ? Math.round((piecesWithAmount / pieces) * 1000) / 10 : 0;
  return {
    lines: Number(t.lines) || 0,
    linesWithAmount: Number(t.linesWithAmount) || 0,
    pieces,
    piecesWithoutAmount: Math.max(0, pieces - piecesWithAmount),
    percent,
    amount,
    pricePerPiece: piecesWithAmount > 0 ? Math.round((amount / piecesWithAmount) * 100) / 100 : 0,
    verdict:
      pieces === 0 || percent >= SEUIL_FIABLE
        ? "fiable"
        : percent < SEUIL_INEXPLOITABLE
          ? "inexploitable"
          : "partiel",
  };
}

export function amountCoverage(lines: CoverageInput[]): Coverage {
  let pieces = 0;
  let piecesWithoutAmount = 0;
  let piecesWithAmount = 0;
  let amount = 0;
  let linesWithAmount = 0;

  for (const l of lines) {
    const q = Number(l.quantity) || 0;
    const a = Number(l.amount) || 0;
    pieces += q;
    if (a > 0) {
      linesWithAmount++;
      amount += a;
      piecesWithAmount += q;
    } else {
      piecesWithoutAmount += q;
    }
  }

  // ⚠️ La couverture se mesure en PIÈCES, pas en lignes : une ligne de 200 pièces sans
  // montant pèse autrement qu'une ligne de 1. *Sur MCS Homme W25, 69 % des lignes sont à
  // zéro mais elles portent 68 % des pièces — les deux chiffres se rejoignent ici, rien
  // ne garantit qu'ils le fassent toujours.*
  void piecesWithoutAmount;
  return coverageFromTotals({ lines: lines.length, linesWithAmount, pieces, piecesWithAmount, amount });
}

/**
 * Deux éléments comparés sont-ils sur la même base tarifaire ?
 *
 * Renvoie l'écart relatif de prix unitaire. *Au-delà de 40 %, on est très probablement
 * devant un trou de couverture et non devant une vraie évolution de prix : MCS Homme W25
 * contre W26 affichait un rapport de 1 à 3,3.*
 */
export function comparablePrices(a: Coverage, b: Coverage): { comparable: boolean; ecart: number } {
  if (a.pricePerPiece <= 0 || b.pricePerPiece <= 0) return { comparable: false, ecart: 0 };
  const haut = Math.max(a.pricePerPiece, b.pricePerPiece);
  const bas = Math.min(a.pricePerPiece, b.pricePerPiece);
  const ecart = Math.round(((haut - bas) / haut) * 1000) / 10;
  return { comparable: ecart <= 40, ecart };
}
