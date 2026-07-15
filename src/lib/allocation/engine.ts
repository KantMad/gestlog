import { sumQuantities, type SizeQuantities } from "@/lib/utils";
import {
  enforceNoSizeGaps,
  capOrderReduction,
  capLineReduction,
  sortByRanking,
  checkMinimumThreshold,
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

    const totalDemand = sumQuantities(totalDemandBySize);
    const totalAvailable = sumQuantities(avail);

    if (totalAvailable >= totalDemand) {
      // Enough stock — allocate everything as requested
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

    // Step 1: Pro-rata allocation per size
    const allocations = new Map<string, SizeQuantities>();
    for (const d of sorted) {
      const alloc: SizeQuantities = {};
      for (const [size, requested] of Object.entries(d.requested)) {
        const sizeAvail = avail[size] || 0;
        const sizeDemand = totalDemandBySize[size] || 0;
        if (sizeDemand === 0) {
          alloc[size] = 0;
        } else {
          alloc[size] = Math.floor((requested / sizeDemand) * sizeAvail);
        }
      }
      allocations.set(`${d.clientId}:${d.clientOrderId}`, alloc);
    }

    // Fix rounding: distribute remaining pieces to highest-priority clients
    for (const size of allSizes) {
      const sizeAvail = avail[size] || 0;
      let allocated = 0;
      for (const alloc of allocations.values()) {
        allocated += alloc[size] || 0;
      }
      let remainder = sizeAvail - allocated;
      if (remainder > 0) {
        for (const d of sorted) {
          if (remainder <= 0) break;
          const key = `${d.clientId}:${d.clientOrderId}`;
          const alloc = allocations.get(key)!;
          const requested = d.requested[size] || 0;
          const current = alloc[size] || 0;
          const canAdd = Math.min(remainder, requested - current);
          if (canAdd > 0) {
            alloc[size] = current + canAdd;
            remainder -= canAdd;
          }
        }
      }
    }

    // Disponible RESTANT par taille (après la répartition pro-rata + arrondis). La
    // restauration des caps ne peut puiser QUE dans ce reliquat → on n'alloue jamais
    // plus que ce qui a été reçu (si 0 reçu, rien à restaurer).
    const remainingBySize: SizeQuantities = {};
    for (const size of allSizes) {
      let used = 0;
      for (const alloc of allocations.values()) used += alloc[size] || 0;
      remainingBySize[size] = Math.max(0, (avail[size] || 0) - used);
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
      const { adjusted, hadGaps } = enforceNoSizeGaps(d.sizeScale, alloc);
      if (hadGaps) {
        allocations.set(key, adjusted);
        warnings.push(
          `Client ${cName(d.clientId)}, produit ${pName(productId)}: trous de taille corrigés`
        );
      }
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
