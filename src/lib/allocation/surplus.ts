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
//     est posé **au-delà** des commandes, avec la MÊME logique qu'en phase 1 : pièce par
//     pièce, à la boutique la moins bien servie en relatif. Sinon on n'y touche pas.
//  4. Jamais plus que le reçu d'une taille.
//  5. **Exceptions de taille par boutique** (`Client.surplusExcludedSizes`, écran
//     Configuration) : une boutique peut être exclue du surplus sur certaines tailles
//     (ex. « Roubaix ne prend jamais de 4XL en trop »). Deux garde-fous :
//     - l'exception ne bloque que le surplus **au-delà de la quantité commandée** : si la
//       boutique a commandé 2 × 4XL et n'en a reçu qu'1, on lui rend bien le 2e ;
//     - l'exception est **levée si aucune autre boutique n'a commandé cette taille** —
//       sinon les pièces resteraient bloquées en stock alors que quelqu'un peut les vendre.

export interface SurplusLine {
  key: string;
  original: SizeQuantities;
  allocated: SizeQuantities;
  ranking: number;
  /**
   * Tailles que cette boutique ne doit PAS recevoir en surplus (réglage boutique, écran
   * Configuration). Ne bloque que les pièces posées **au-delà** de la quantité commandée
   * sur cette taille : une boutique reçoit toujours ce qu'elle a réellement commandé.
   * Exception : si AUCUNE autre boutique n'a commandé cette taille, les pièces seraient
   * perdues → on autorise alors les boutiques exclues (cf. `sizeAllowedFor`).
   */
  excludedSizes?: string[];
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
    excludedSizes: l.excludedSizes ?? [],
  }));
  type Work = (typeof work)[number];

  const isExcluded = (w: Work, size: string) => w.excludedSizes.includes(size);
  // Une AUTRE boutique (sans exception sur cette taille) l'a-t-elle commandée ? Si oui, le
  // surplus a un meilleur destinataire ; sinon les pièces seraient perdues.
  const hasOtherTaker = (size: string, self: Work) =>
    work.some((w) => w !== self && (w.original[size] || 0) > 0 && !isExcluded(w, size));
  // Une pièce de `size` peut-elle aller à `w` ?
  const sizeAllowedFor = (w: Work, size: string): boolean => {
    if (!isExcluded(w, size)) return true;
    // L'exception ne bloque QUE le surplus : ce que la boutique a commandé lui revient.
    if ((w.alloc[size] || 0) < (w.original[size] || 0)) return true;
    // Exception levée si personne d'autre ne peut prendre cette taille.
    return !hasOtherTaker(size, w);
  };

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
        ([size, req]) => req > 0 && (remaining[size] || 0) > 0 && sizeAllowedFor(w, size)
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
      if (!sizeAllowedFor(best, size)) continue;
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

  // ── Phase 2 : au-delà des commandes — seulement si plus aucun écart ───────────────
  //
  // MÊME logique que la phase 1 : pièce par pièce, à la boutique dont le TAUX DE SERVICE
  // (alloué/commandé) est le plus bas ; le rang ne départage que les égalités. Les taux
  // convergent donc, conformément à l'objectif de la règle.
  //
  // Remplace un prorata par taille qui ne distribuait en réalité jamais rien : sa part
  // était arrondie à l'entier INFÉRIEUR, or le surplus d'une taille (1 à 3 pièces) est
  // toujours minuscule face au total commandé sur cette taille (13 à 31) → toutes les
  // parts tombaient à 0, et 100 % du surplus basculait dans le départage, qui servait
  // dans l'ordre du rang. Avec 3 pièces et 5 boutiques, seules les 3 premières étaient
  // atteintes — les mêmes à chaque taille, donc ça s'empilait. Cas réel CCAH26_CH07/752 :
  // +22 % / +9 % / +6 % / 0 % / 0 %, la PLUS PETITE commande raflant le plus de pièces,
  // soit l'inverse exact du but recherché.
  if (!stillShort) {
    for (;;) {
      let best: (typeof work)[number] | null = null;
      let bestRatio = Infinity;
      for (const w of work) {
        const canTake = Object.entries(w.original).some(
          ([size, req]) => req > 0 && (remaining[size] || 0) > 0 && sizeAllowedFor(w, size)
        );
        if (!canTake) continue;
        const ratio = w.origTotal > 0 ? w.allocTotal / w.origTotal : Infinity;
        if (!best || ratio < bestRatio || (ratio === bestRatio && w.ranking < best.ranking)) {
          best = w;
          bestRatio = ratio;
        }
      }
      if (!best) break;

      // Taille servie : parmi celles commandées, celle où il reste le plus de surplus.
      let chosen: string | null = null;
      let rem = 0;
      for (const [size, req] of Object.entries(best.original)) {
        if (req <= 0) continue;
        if (!sizeAllowedFor(best, size)) continue;
        if ((remaining[size] || 0) > rem) {
          rem = remaining[size] || 0;
          chosen = size;
        }
      }
      if (!chosen) break; // sécurité (canTake garantit normalement l'inverse)

      best.alloc[chosen] = (best.alloc[chosen] || 0) + 1;
      best.allocTotal += 1;
      remaining[chosen] = (remaining[chosen] || 0) - 1;
      beyond += 1;
    }
  }

  const leftover = Object.values(remaining).reduce((s, n) => s + Math.max(0, n), 0);
  const allocByKey = new Map(work.map((w) => [w.key, w.alloc]));
  return { allocByKey, filledGaps, beyond, leftover, stillShort };
}
