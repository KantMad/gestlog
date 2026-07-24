import type { SizeQuantities } from "@/lib/utils";

// Rule 1: No size gaps — intermediate sizes cannot be zero
export function enforceNoSizeGaps(
  sizeScale: string[],
  allocated: SizeQuantities,
  /**
   * Stock encore LIBRE par taille (hors de cette allocation). Quand il est fourni, un trou
   * n'est comblé QUE si la taille manquante a réellement du stock disponible.
   * ⚠️ Sans cette contrainte, on déplaçait une pièce d'une taille extrême vers la taille
   * manquante : le total de la boutique était conservé, mais on **transformait un S en M** —
   * et on promettait un M qui n'existait pas physiquement (cas réel CCAH26_PU19/205, 1 seul
   * M reçu, 2 alloués). Non fourni = aucune contrainte (comportement historique).
   */
  freeBySize?: SizeQuantities
): {
  adjusted: SizeQuantities;
  hadGaps: boolean;
  /** Pièces déplacées d'une taille à l'autre → le stock libre doit suivre (`from` +1, `to` −1). */
  moves: { from: string; to: string }[];
  /** Pièces retirées de l'allocation (trou incomblable) → elles retournent au stock libre. */
  released: SizeQuantities;
} {
  const result = { ...allocated };
  const moves: { from: string; to: string }[] = [];
  const released: SizeQuantities = {};
  let hadGaps = false;

  for (let i = 1; i < sizeScale.length - 1; i++) {
    const size = sizeScale[i];
    if ((result[size] || 0) === 0) {
      const hasLeft = sizeScale.slice(0, i).some((s) => (result[s] || 0) > 0);
      const hasRight = sizeScale.slice(i + 1).some((s) => (result[s] || 0) > 0);
      if (hasLeft && hasRight) {
        hadGaps = true;
        // On ne peut combler que si la taille manquante a du stock libre.
        const sizeHasStock = !freeBySize || (freeBySize[size] || 0) > 0;
        // Sinon on prend 1 pièce sur la plus grosse taille extrême de cette boutique.
        const extremes = [sizeScale[0], sizeScale[sizeScale.length - 1]];
        const donor = sizeHasStock
          ? extremes
              .filter((s) => (result[s] || 0) > 1)
              .sort((a, b) => (result[b] || 0) - (result[a] || 0))[0]
          : undefined;

        if (donor) {
          result[donor] = (result[donor] || 0) - 1;
          result[size] = 1;
          moves.push({ from: donor, to: size });
        } else if ((result[sizeScale[0]] || 0) > 0) {
          // Trou incomblable → on retire la taille extrême basse (elle redevient libre),
          // ce qui supprime le trou sans inventer de pièce.
          released[sizeScale[0]] = (released[sizeScale[0]] || 0) + result[sizeScale[0]];
          result[sizeScale[0]] = 0;
        }
      }
    }
  }

  return { adjusted: result, hadGaps, moves, released };
}

// Rule 3: Cap order-level reduction percentage
export function capOrderReduction(
  clientTotalOriginal: number,
  clientTotalReduced: number,
  maxPercent: number
): number {
  const maxReduction = Math.floor(clientTotalOriginal * (maxPercent / 100));
  return Math.max(0, maxReduction - clientTotalReduced);
}

// Rule 4: Cap line-level reduction percentage
export function capLineReduction(
  lineOriginal: number,
  lineReduced: number,
  maxPercent: number
): number {
  const maxReduction = Math.floor(lineOriginal * (maxPercent / 100));
  return Math.max(0, maxReduction - lineReduced);
}

// Rule 5: Sort demands by ranking (lower rank = higher priority)
export function sortByRanking<T extends { clientId: string }>(
  demands: T[],
  configs: Map<string, { ranking: number; rotationScore: number }>
): T[] {
  return [...demands].sort((a, b) => {
    const ca = configs.get(a.clientId);
    const cb = configs.get(b.clientId);
    if (!ca || !cb) return 0;
    if (ca.ranking !== cb.ranking) return ca.ranking - cb.ranking;
    // Rule 6: same rank — lower rotation score = was impacted more recently = protected
    return ca.rotationScore - cb.rotationScore;
  });
}

// Rule 8: Check minimum delivery threshold
export function checkMinimumThreshold(
  totalAllocated: number,
  threshold: number
): boolean {
  return totalAllocated >= threshold;
}
