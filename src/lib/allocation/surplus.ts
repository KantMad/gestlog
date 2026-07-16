import { sumQuantities, type SizeQuantities } from "@/lib/utils";

// ─── Répartition du SURPLUS reçu (bouton « Répartir surplus ») ────────────────────
//
// Objectif métier : **minimiser les écarts entre les pourcentages d'écart** des boutiques.
// L'écart se mesure au niveau de la LIGNE (produit + couleur), en nombre total de pièces :
// c'est ce qu'affiche la colonne « Écart » (ex. -2 → -11 %).
//
// Règles :
//  1. Une pièce ne peut aller QUE sur une taille que la boutique a **commandée**
//     (`original[size] > 0`). En revanche on PEUT dépasser la quantité commandée sur cette
//     taille : cela réduit quand même l'écart global de la boutique — c'est le but.
//     (Cas réel : XL sur-livré alors que le manque est sur M/L ; donner un XL de plus à une
//     boutique coupée fait bien passer son écart de -11 % à -6 %.)
//  2. Phase 1 — on sert, pièce par pièce, la boutique **la plus coupée en relatif**
//     (déficit = 1 − alloué/commandé), rang pour départager, jusqu'à combler son écart.
//     Les % convergent donc les uns vers les autres.
//  3. Phase 2 — s'il reste du surplus ET que plus aucune boutique n'a d'écart, le reliquat
//     est réparti au prorata **au-delà** des commandes. Sinon on n'y touche pas.
//  4. Jamais plus que le reçu d'une taille.

export interface SurplusLine {
  key: string;
  original: SizeQuantities;
  allocated: SizeQuantities;
  ranking: number;
}

export interface SurplusResult {
  /** Nouvelles quantités allouées, par clé de ligne (uniquement les lignes modifiées). */
  allocByKey: Map<string, SizeQuantities>;
  /** Pièces posées pour combler des écarts (phase 1). */
  filledGaps: number;
  /** Pièces posées au-delà des commandes (phase 2). */
  beyond: number;
  /** Pièces disponibles restées non réparties. */
  leftover: number;
  /** true si des boutiques ont encore un écart à la fin. */
  stillShort: boolean;
}

export function distributeSurplus(lines: SurplusLine[], received: SizeQuantities): SurplusResult {
  const work = lines.map((l) => ({
    key: l.key,
    original: l.original,
    alloc: { ...l.allocated } as SizeQuantities,
    origTotal: sumQuantities(l.original),
    allocTotal: sumQuantities(l.allocated),
    ranking: l.ranking,
  }));

  // Reliquat disponible par taille = reçu − déjà alloué (toutes boutiques).
  const remaining: SizeQuantities = {};
  for (const [size, recv] of Object.entries(received)) {
    const used = work.reduce((s, w) => s + (w.alloc[size] || 0), 0);
    remaining[size] = Math.max(0, recv - used);
  }

  let filledGaps = 0;
  let beyond = 0;

  // ── Phase 1 : combler les écarts, la boutique la plus coupée (en %) d'abord ────────
  for (;;) {
    let best: (typeof work)[number] | null = null;
    let bestDeficit = -1;
    for (const w of work) {
      if (w.allocTotal >= w.origTotal) continue; // écart déjà comblé
      // Peut recevoir dès qu'une taille COMMANDÉE a encore du reliquat (même si sa
      // quantité commandée sur cette taille est déjà atteinte — règle 1).
      const canTake = Object.entries(w.original).some(
        ([size, req]) => req > 0 && (remaining[size] || 0) > 0
      );
      if (!canTake) continue;
      const deficit = w.origTotal > 0 ? 1 - w.allocTotal / w.origTotal : 0;
      if (!best || deficit > bestDeficit || (deficit === bestDeficit && w.ranking < best.ranking)) {
        best = w;
        bestDeficit = deficit;
      }
    }
    if (!best) break;

    // Taille servie : en priorité une taille où il MANQUE encore des pièces (on comble un
    // vrai trou) ; sinon la taille commandée où il reste le plus de surplus.
    let gapSize: string | null = null;
    let gapNeed = 0;
    let fallbackSize: string | null = null;
    let fallbackRem = 0;
    for (const [size, req] of Object.entries(best.original)) {
      if (req <= 0 || (remaining[size] || 0) <= 0) continue;
      const need = req - (best.alloc[size] || 0);
      if (need > gapNeed) {
        gapNeed = need;
        gapSize = size;
      }
      if ((remaining[size] || 0) > fallbackRem) {
        fallbackRem = remaining[size] || 0;
        fallbackSize = size;
      }
    }
    const chosen = gapSize ?? fallbackSize;
    if (!chosen) break; // sécurité (canTake garantit normalement l'inverse)

    best.alloc[chosen] = (best.alloc[chosen] || 0) + 1;
    best.allocTotal += 1;
    remaining[chosen] = (remaining[chosen] || 0) - 1;
    filledGaps += 1;
  }

  const stillShort = work.some((w) => w.allocTotal < w.origTotal);

  // ── Phase 2 : au-delà des commandes, au prorata — seulement si plus aucun écart ────
  if (!stillShort) {
    for (const size of Object.keys(remaining)) {
      const surplus = remaining[size] || 0;
      if (surplus <= 0) continue;
      const eligible = work.filter((w) => (w.original[size] || 0) > 0);
      const totalOrder = eligible.reduce((s, w) => s + (w.original[size] || 0), 0);
      if (totalOrder <= 0) continue; // taille commandée par personne → non répartissable
      const floors = eligible.map((w) => Math.floor(surplus * ((w.original[size] || 0) / totalOrder)));
      let rest = surplus - floors.reduce((a, b) => a + b, 0);
      eligible.forEach((w, i) => {
        if (floors[i] > 0) {
          w.alloc[size] = (w.alloc[size] || 0) + floors[i];
          beyond += floors[i];
        }
      });
      const byRank = [...eligible].sort((a, b) => a.ranking - b.ranking);
      for (let i = 0; i < byRank.length && rest > 0; i++, rest--) {
        byRank[i].alloc[size] = (byRank[i].alloc[size] || 0) + 1;
        beyond += 1;
      }
      remaining[size] = 0;
    }
  }

  const leftover = Object.values(remaining).reduce((s, n) => s + Math.max(0, n), 0);
  const allocByKey = new Map(work.map((w) => [w.key, w.alloc]));
  return { allocByKey, filledGaps, beyond, leftover, stillShort };
}
