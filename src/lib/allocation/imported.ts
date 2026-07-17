import { sumQuantities, type SizeQuantities } from "@/lib/utils";
import { checkMinimumThreshold } from "./rules";
import type { AllocationDemand, AllocationResult, AllocationResultLine, ClientConfig } from "./types";

// ─── Répartition REPRISE D'UN FICHIER (import du fichier EAN d'une répartition) ──────
//
// Le fichier EAN exporté depuis une répartition porte l'ALLOUÉ (boutique, réf, couleur,
// taille, quantité) mais PAS le commandé. On rejoue donc l'alloué tel quel et on relit le
// commandé depuis les commandes clients en base : les écarts, les statuts et les totaux
// sont ainsi cohérents avec le reste de l'écran, exactement comme après une simulation.
//
// Aucun recalcul : le fichier fait autorité. C'est tout l'intérêt — il rend une
// répartition déjà arbitrée (y compris ses ajustements manuels et son surplus) sans avoir
// à la refaire.

export interface ImportedAllocationInput {
  demands: AllocationDemand[];
  /** Alloué du fichier, par `${clientId}__${productId}`. */
  allocatedByKey: Map<string, SizeQuantities>;
  clientConfigs: Map<string, ClientConfig>;
}

/**
 * Restreint les demandes de la saison aux SEULS couples (boutique, produit) présents dans le
 * fichier importé, et agrège les commandes multiples d'une même boutique pour un même produit
 * (le fichier ne distingue pas les n° de commande) → une seule demande par (boutique, produit).
 * Sans ce filtre, TOUTES les commandes de la saison ressortiraient (produits hors fichier
 * affichés à 0 alloué avec un écart complet).
 */
export function restrictDemandsToImported(
  demands: AllocationDemand[],
  allocatedByKey: Map<string, SizeQuantities>
): AllocationDemand[] {
  const byKey = new Map<string, AllocationDemand>();
  for (const d of demands) {
    const key = `${d.clientId}__${d.productId}`;
    if (!allocatedByKey.has(key)) continue;
    const ex = byKey.get(key);
    if (!ex) {
      byKey.set(key, { ...d, requested: { ...d.requested }, sizeScale: [...d.sizeScale] });
    } else {
      for (const [size, q] of Object.entries(d.requested)) ex.requested[size] = (ex.requested[size] || 0) + q;
      for (const sz of d.sizeScale) if (!ex.sizeScale.includes(sz)) ex.sizeScale.push(sz);
    }
  }
  return [...byKey.values()];
}

export function applyImportedAllocation(input: ImportedAllocationInput): AllocationResult {
  const { demands, allocatedByKey, clientConfigs } = input;
  const warnings: string[] = [];
  const lines: AllocationResultLine[] = [];
  const used = new Set<string>();

  for (const d of demands) {
    const key = `${d.clientId}__${d.productId}`;
    used.add(key);
    const allocated = { ...(allocatedByKey.get(key) || {}) };

    // Écarts par taille : ce que la boutique a commandé et n'a pas reçu.
    const reduced: SizeQuantities = {};
    let hasReduction = false;
    for (const [size, requested] of Object.entries(d.requested)) {
      const got = allocated[size] || 0;
      if (requested > got) {
        reduced[size] = requested - got;
        hasReduction = true;
      }
    }

    const totalAlloc = sumQuantities(allocated);
    const config = clientConfigs.get(d.clientId);
    const meetsThreshold = config ? checkMinimumThreshold(totalAlloc, config.minDeliveryThreshold) : true;

    lines.push({
      clientId: d.clientId,
      clientOrderId: d.clientOrderId,
      productId: d.productId,
      original: { ...d.requested },
      allocated,
      reduced,
      reductionReason: hasReduction ? "ALLOCATION" : "NONE",
      status: totalAlloc === 0 ? "ANNULE" : !meetsThreshold ? "EN_ATTENTE" : "LIVRABLE",
      // Le fichier vient d'une répartition arbitrée à la main : on le signale comme tel.
      isManualAdjustment: totalAlloc > 0,
    });
  }

  // Lignes du fichier sans commande correspondante : on ne les invente pas (une ligne de
  // répartition doit être rattachée à une commande client), mais on le dit clairement.
  const orphans = [...allocatedByKey.keys()].filter((k) => !used.has(k));
  if (orphans.length > 0) {
    warnings.push(
      `${orphans.length} ligne(s) du fichier ne correspondent à aucune commande client de cette saison (boutique/produit non commandé) — elles ont été ignorées.`
    );
  }

  return { lines, warnings };
}
