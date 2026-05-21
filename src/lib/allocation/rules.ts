import type { SizeQuantities } from "@/lib/utils";

// Rule 1: No size gaps — intermediate sizes cannot be zero
export function enforceNoSizeGaps(
  sizeScale: string[],
  allocated: SizeQuantities
): { adjusted: SizeQuantities; hadGaps: boolean } {
  const result = { ...allocated };
  let hadGaps = false;

  for (let i = 1; i < sizeScale.length - 1; i++) {
    const size = sizeScale[i];
    if ((result[size] || 0) === 0) {
      const hasLeft = sizeScale.slice(0, i).some((s) => (result[s] || 0) > 0);
      const hasRight = sizeScale.slice(i + 1).some((s) => (result[s] || 0) > 0);
      if (hasLeft && hasRight) {
        hadGaps = true;
        // Try to fill gap by taking 1 from the largest extreme
        const extremes = [sizeScale[0], sizeScale[sizeScale.length - 1]];
        const donor = extremes
          .filter((s) => (result[s] || 0) > 1)
          .sort((a, b) => (result[b] || 0) - (result[a] || 0))[0];

        if (donor) {
          result[donor] = (result[donor] || 0) - 1;
          result[size] = 1;
        } else {
          // Can't fill the gap — zero out the outward extremes
          for (let j = 0; j < i; j++) {
            const s = sizeScale[j];
            if ((result[s] || 0) > 0 && !sizeScale.slice(j + 1, i).some((ss) => (result[ss] || 0) > 0)) {
              break;
            }
          }
          // Fallback: zero the smaller extreme side
          if ((result[sizeScale[0]] || 0) > 0) {
            result[sizeScale[0]] = 0;
          }
        }
      }
    }
  }

  // Clean up: remove trailing zeros at extremes
  for (let i = 0; i < sizeScale.length; i++) {
    if ((result[sizeScale[i]] || 0) === 0) {
      continue;
    }
    break;
  }
  for (let i = sizeScale.length - 1; i >= 0; i--) {
    if ((result[sizeScale[i]] || 0) === 0) {
      continue;
    }
    break;
  }

  return { adjusted: result, hadGaps };
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
