import { sumQuantities, type SizeQuantities } from "@/lib/utils";
import {
  enforceNoSizeGaps,
  capOrderReduction,
  capLineReduction,
  sortByRanking,
  checkMinimumThreshold,
  hasSizeGap,
} from "./rules";
import type {
  AllocationInput,
  AllocationDemand,
  AllocationResult,
  AllocationResultLine,
  ClientConfig,
} from "./types";

export function runAllocation(input: AllocationInput): AllocationResult {
  const { available, demands, clientConfigs, clientNames, productNames } = input;
  const warnings: string[] = [];

  // Helpers to display human-readable names instead of IDs
  const cName = (id: string) => clientNames?.get(id) || id;
  const pName = (id: string) => productNames?.get(id) || id;
  const lines: AllocationResultLine[] = [];

  // Group demands by product
  const demandsByProduct = new Map<string, AllocationDemand[]>();
  for (const d of demands) {
    if (!demandsByProduct.has(d.productId)) {
      demandsByProduct.set(d.productId, []);
    }
    demandsByProduct.get(d.productId)!.push(d);
  }

  // Track total reduction per client across all products (for Rule 3)
  const clientTotalOriginal = new Map<string, number>();
  const clientTotalReduced = new Map<string, number>();

  for (const d of demands) {
    const total = sumQuantities(d.requested);
    clientTotalOriginal.set(
      d.clientId,
      (clientTotalOriginal.get(d.clientId) || 0) + total
    );
  }

  // Process each product
  for (const [productId, productDemands] of demandsByProduct) {
    const avail = available.get(productId) || {};
    const allSizes = new Set<string>();
    for (const d of productDemands) {
      for (const s of d.sizeScale) allSizes.add(s);
    }

    // Total demand vs available per size
    const totalDemandBySize: SizeQuantities = {};
    for (const d of productDemands) {
      for (const [size, qty] of Object.entries(d.requested)) {
        totalDemandBySize[size] = (totalDemandBySize[size] || 0) + qty;
      }
    }

    // Raccourci « tout le monde est servi » : valable UNIQUEMENT si CHAQUE taille a de quoi
    // couvrir sa demande. Comparer les TOTAUX était faux : un surplus sur une taille masque
    // le manque d'une autre (cas réel CCAH26_PU02/811 : reçu 144 ≥ demandé 142, mais M est à
    // 31 pour 32 demandés → on allouait une 32e pièce de M inexistante, et le -1 n'apparaissait
    // nulle part). Sinon → répartition pièce par pièce, qui respecte le disponible par taille.
    const enoughEverySize = Object.entries(totalDemandBySize).every(
      ([size, demand]) => (avail[size] || 0) >= demand
    );

    if (enoughEverySize) {
      // Enough stock on every size — allocate everything as requested
      for (const d of productDemands) {
        lines.push({
          clientId: d.clientId,
          clientOrderId: d.clientOrderId,
          productId,
          original: { ...d.requested },
          allocated: { ...d.requested },
          reduced: {},
          reductionReason: "NONE",
          status: "LIVRABLE",
          isManualAdjustment: false,
        });
      }
      continue;
    }

    // Shortage — need to allocate with rules
    // Rule 5+6: Sort by ranking then rotation
    const sorted = sortByRanking(productDemands, clientConfigs);

    // Step 1 — Répartition ÉQUITABLE, pièce par pièce (règle : à rang égal, on égalise le
    // POURCENTAGE de coupe, pas le nombre de pièces).
    //
    // À chaque tour on sert la boutique actuellement la PLUS coupée en relatif (déficit =
    // 1 − servi/commandé sur ce produit+couleur) ; à déficit égal on départage par rang puis
    // rotation. On lui donne 1 pièce dans la taille où il lui manque le plus (et qui reste
    // disponible). Deux boutiques de même rang convergent donc vers le même % de coupe,
    // quelle que soit la taille de leur commande.
    //
    // Invariants garantis par construction :
    //  - jamais plus que la quantité commandée (par taille ET au total) ;
    //  - jamais une taille non commandée ;
    //  - jamais plus que le reçu de la taille (le reliquat d'une taille sur-livrée reste
    //    disponible → « Répartir surplus »).
    // Remplace l'ancien pro-rata + rattrapage d'arrondis (qui donnait des % très inégaux
    // selon le mix de tailles de chaque boutique).
    const allocations = new Map<string, SizeQuantities>();
    const state = sorted.map((d) => {
      const alloc: SizeQuantities = {};
      allocations.set(`${d.clientId}:${d.clientOrderId}`, alloc);
      return { d, alloc, requestedTotal: sumQuantities(d.requested), allocTotal: 0 };
    });

    const remainingBySize: SizeQuantities = {};
    for (const size of allSizes) remainingBySize[size] = avail[size] || 0;

    const rankOf = (clientId: string) => clientConfigs.get(clientId)?.ranking ?? 9999;
    const rotOf = (clientId: string) => clientConfigs.get(clientId)?.rotationScore ?? 0;

    for (;;) {
      let best: (typeof state)[number] | null = null;
      let bestDeficit = -1;
      for (const s of state) {
        if (s.allocTotal >= s.requestedTotal) continue;
        // Peut-elle encore recevoir une pièce d'une taille qu'elle a commandée ?
        const canTake = Object.entries(s.d.requested).some(
          ([size, req]) => (remainingBySize[size] || 0) > 0 && (s.alloc[size] || 0) < req
        );
        if (!canTake) continue;
        const deficit = s.requestedTotal > 0 ? 1 - s.allocTotal / s.requestedTotal : 0;
        if (!best || deficit > bestDeficit) {
          best = s;
          bestDeficit = deficit;
          continue;
        }
        if (deficit === bestDeficit) {
          const rb = rankOf(s.d.clientId);
          const ra = rankOf(best.d.clientId);
          if (rb < ra || (rb === ra && rotOf(s.d.clientId) < rotOf(best.d.clientId))) best = s;
        }
      }
      if (!best) break;

      // Taille servie : celle où il lui manque le plus (et encore disponible).
      let pickSize: string | null = null;
      let pickNeed = 0;
      for (const [size, req] of Object.entries(best.d.requested)) {
        if ((remainingBySize[size] || 0) <= 0) continue;
        const need = req - (best.alloc[size] || 0);
        if (need > pickNeed) {
          pickNeed = need;
          pickSize = size;
        }
      }
      if (!pickSize) break; // sécurité : ne devrait pas arriver (canTake garantit l'inverse)

      best.alloc[pickSize] = (best.alloc[pickSize] || 0) + 1;
      best.allocTotal += 1;
      remainingBySize[pickSize] -= 1;
    }

    // Step 2: Apply Rule 3 (max reduction per order) and Rule 4 (max reduction per line)
    for (const d of sorted) {
      const key = `${d.clientId}:${d.clientOrderId}`;
      const alloc = allocations.get(key)!;
      const config = clientConfigs.get(d.clientId);
      if (!config) continue;

      const lineOriginal = sumQuantities(d.requested);
      const lineAllocated = sumQuantities(alloc);
      const lineReduced = lineOriginal - lineAllocated;

      // Rule 4: cap line reduction — borné par le disponible restant (jamais de pièce
      // « fantôme » : on ne restaure que du stock réellement reçu et encore libre).
      const maxLineReduction = capLineReduction(
        lineOriginal,
        0,
        config.maxReductionLine
      );
      if (lineReduced > maxLineReduction) {
        const needToRestore = lineReduced - maxLineReduction;
        let restored = 0;
        for (const size of d.sizeScale) {
          if (restored >= needToRestore) break;
          const requested = d.requested[size] || 0;
          const current = alloc[size] || 0;
          const canRestore = Math.min(
            needToRestore - restored,
            requested - current,
            remainingBySize[size] || 0
          );
          if (canRestore > 0) {
            alloc[size] = current + canRestore;
            remainingBySize[size] = (remainingBySize[size] || 0) - canRestore;
            restored += canRestore;
          }
        }
        if (restored < needToRestore) {
          warnings.push(
            `Client ${cName(d.clientId)}: cap ligne ${config.maxReductionLine}% non tenu (stock reçu insuffisant) pour ${pName(productId)}`
          );
        }
      }

      // Rule 3: check order-level cap
      const currentOrderReduction = clientTotalReduced.get(d.clientId) || 0;
      const maxOrderRed = capOrderReduction(
        clientTotalOriginal.get(d.clientId) || 0,
        currentOrderReduction,
        config.maxReductionOrder
      );
      const actualReduction = lineOriginal - sumQuantities(alloc);
      if (actualReduction > maxOrderRed) {
        warnings.push(
          `Client ${cName(d.clientId)}: réduction globale dépasse ${config.maxReductionOrder}%`
        );
      }
      clientTotalReduced.set(
        d.clientId,
        currentOrderReduction + Math.max(0, actualReduction)
      );
    }

    // Step 3: Apply Rule 1 (no size gaps) — non-negotiable
    for (const d of sorted) {
      const key = `${d.clientId}:${d.clientOrderId}`;
      const alloc = allocations.get(key)!;
      // `remainingBySize` = stock encore libre : il contraint le comblage des trous (on ne
      // comble que si la taille manquante existe physiquement) et doit suivre les mouvements.
      // ⚠️ Le trou se juge sur les tailles que la boutique a COMMANDÉES, pas sur la grille
      // complète du produit. *Cas réel THRPOML_902/405 : Dole commande M, L, XL, 3XL — sans
      // 2XL. Jugée sur la grille S→4XL, son allocation présentait un « trou » en 2XL, et la
      // règle lui retirait son 3XL… qui restait ensuite inutilisé.*
      const orderedScale = d.sizeScale.filter((s) => (d.requested[s] || 0) > 0);

      // Avant de sacrifier un bloc, on tente d'EMPRUNTER la taille manquante à une boutique
      // qui en a au moins 2 : elle passe de 2 à 1 (donc aucun trou chez elle) et le trou
      // est comblé chez celle-ci. Sans cela, une seule taille indisponible faisait perdre
      // tout un bloc à une boutique — *Saint-Dié perdait son 2XL faute d'un XL, alors que
      // plusieurs boutiques en avaient 2.* On prélève sur la MIEUX servie.
      for (let i = 1; i < orderedScale.length - 1; i++) {
        const gapSize = orderedScale[i];
        if ((alloc[gapSize] || 0) > 0) continue;
        if ((remainingBySize[gapSize] || 0) > 0) continue; // le stock libre suffira
        const left = orderedScale.slice(0, i).some((x) => (alloc[x] || 0) > 0);
        const right = orderedScale.slice(i + 1).some((x) => (alloc[x] || 0) > 0);
        if (!left || !right) continue; // zéro en bout de gamme : pas un trou

        let donorKey = "";
        let donorRate = -1;
        for (const other of sorted) {
          if (other === d) continue;
          const oKey = `${other.clientId}:${other.clientOrderId}`;
          const oAlloc = allocations.get(oKey)!;
          if ((oAlloc[gapSize] || 0) < 2) continue; // jamais descendre une boutique à 0
          const oReq = sumQuantities(other.requested);
          const rate = oReq > 0 ? sumQuantities(oAlloc) / oReq : 0;
          if (rate > donorRate) {
            donorRate = rate;
            donorKey = oKey;
          }
        }
        if (!donorKey) continue;
        const donor = allocations.get(donorKey)!;
        donor[gapSize] -= 1;
        remainingBySize[gapSize] = (remainingBySize[gapSize] || 0) + 1;
      }
      const { adjusted, hadGaps, moves, released } = enforceNoSizeGaps(
        orderedScale,
        alloc,
        remainingBySize
      );
      if (hadGaps) {
        allocations.set(key, adjusted);
        for (const m of moves) {
          remainingBySize[m.from] = (remainingBySize[m.from] || 0) + 1;
          remainingBySize[m.to] = (remainingBySize[m.to] || 0) - 1;
        }
        for (const [size, n] of Object.entries(released)) {
          remainingBySize[size] = (remainingBySize[size] || 0) + n;
        }
        warnings.push(
          `Client ${cName(d.clientId)}, produit ${pName(productId)}: trous de taille corrigés`
        );
      }
    }

    // Step 3bis — REDISTRIBUTION du stock encore libre.
    //
    // ⚠️ Sans cette passe, tout ce que la règle des trous relâche — et tout ce que la
    // boucle n'a pas pu placer — restait bloqué jusqu'à un clic manuel sur « Répartir
    // surplus », alors que des boutiques étaient en manque. *Cas réel THRPOML_902/405 :
    // 13 pièces sur 156 non distribuées, dont 6 3XL, pendant que deux boutiques ayant
    // commandé du 3XL en recevaient zéro.*
    //
    // On ne donne une pièce que si elle NE CRÉE PAS de trou chez la boutique : ajouter un
    // 3XL isolé à une boutique servie jusqu'au XL rouvrirait le trou que l'étape 3 vient
    // de fermer. La priorité reste la boutique la plus coupée en relatif.
    for (;;) {
      let best: { d: AllocationDemand; alloc: SizeQuantities; size: string } | null = null;
      let bestDeficit = -1;
      for (const d of sorted) {
        const alloc = allocations.get(`${d.clientId}:${d.clientOrderId}`)!;
        const requestedTotal = sumQuantities(d.requested);
        const allocTotal = sumQuantities(alloc);
        if (allocTotal >= requestedTotal) continue;
        const orderedScale = d.sizeScale.filter((s) => (d.requested[s] || 0) > 0);
        for (const [size, req] of Object.entries(d.requested)) {
          if ((remainingBySize[size] || 0) <= 0) continue;
          if ((alloc[size] || 0) >= req) continue;
          const trial = { ...alloc, [size]: (alloc[size] || 0) + 1 };
          if (hasSizeGap(orderedScale, trial)) continue;
          const deficit = requestedTotal > 0 ? 1 - allocTotal / requestedTotal : 0;
          if (!best || deficit > bestDeficit) {
            best = { d, alloc, size };
            bestDeficit = deficit;
          }
        }
      }
      if (!best) break;
      best.alloc[best.size] = (best.alloc[best.size] || 0) + 1;
      remainingBySize[best.size] = (remainingBySize[best.size] || 0) - 1;
    }

    // Step 4: Rule 2 — ensure all clients receive something
    for (const d of sorted) {
      const key = `${d.clientId}:${d.clientOrderId}`;
      const alloc = allocations.get(key)!;
      const totalAlloc = sumQuantities(alloc);
      if (totalAlloc === 0 && sumQuantities(d.requested) > 0) {
        // Find the client with the most allocated and transfer 1 piece
        let maxKey = "";
        let maxTotal = 0;
        for (const [k, a] of allocations) {
          const t = sumQuantities(a);
          if (t > maxTotal && k !== key) {
            maxTotal = t;
            maxKey = k;
          }
        }
        if (maxKey && maxTotal > 1) {
          const donor = allocations.get(maxKey)!;
          // Take 1 piece from the first available size
          for (const size of d.sizeScale) {
            if ((donor[size] || 0) > 1) {
              donor[size] = (donor[size] || 0) - 1;
              alloc[size] = (alloc[size] || 0) + 1;
              warnings.push(
                `Client ${cName(d.clientId)}: 1 pièce transférée (Règle 2 — tous doivent recevoir)`
              );
              break;
            }
          }
        }
      }
    }

    // Build result lines
    for (const d of sorted) {
      const key = `${d.clientId}:${d.clientOrderId}`;
      const alloc = allocations.get(key)!;
      const reduced: SizeQuantities = {};
      let hasReduction = false;

      for (const [size, requested] of Object.entries(d.requested)) {
        const allocated = alloc[size] || 0;
        if (requested > allocated) {
          reduced[size] = requested - allocated;
          hasReduction = true;
        }
      }

      const totalAlloc = sumQuantities(alloc);
      const config = clientConfigs.get(d.clientId);
      const meetsThreshold = config
        ? checkMinimumThreshold(totalAlloc, config.minDeliveryThreshold)
        : true;

      lines.push({
        clientId: d.clientId,
        clientOrderId: d.clientOrderId,
        productId,
        original: { ...d.requested },
        allocated: alloc,
        reduced,
        reductionReason: hasReduction ? "ALLOCATION" : "NONE",
        status: totalAlloc === 0
          ? "ANNULE"
          : !meetsThreshold
            ? "EN_ATTENTE"
            : "LIVRABLE",
        isManualAdjustment: false,
      });
    }
  }

  return { lines, warnings };
}
