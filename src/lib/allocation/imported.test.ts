import { describe, it, expect } from "vitest";
import { applyImportedAllocation, restrictDemandsToImported } from "./imported";
import type { SizeQuantities } from "@/lib/utils";
import type { AllocationDemand, ClientConfig } from "./types";

const cfg = (minDeliveryThreshold = 0): ClientConfig => ({
  ranking: 1,
  maxReductionOrder: 100,
  maxReductionLine: 100,
  minDeliveryThreshold,
  rotationScore: 0,
});

const demand = (clientId: string, productId: string, requested: Record<string, number>): AllocationDemand => ({
  clientId,
  clientOrderId: `o_${clientId}`,
  productId,
  sizeScale: Object.keys(requested),
  requested,
});

describe("applyImportedAllocation — le fichier fait autorité", () => {
  it("rejoue l'alloué du fichier et recalcule l'écart depuis le commandé en base", () => {
    const r = applyImportedAllocation({
      demands: [demand("A", "P", { M: 10, L: 5 })],
      allocatedByKey: new Map([["A__P", { M: 8, L: 5 }]]), // le fichier a coupé 2 sur M
      clientConfigs: new Map([["A", cfg()]]),
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].allocated).toEqual({ M: 8, L: 5 });
    expect(r.lines[0].original).toEqual({ M: 10, L: 5 });
    expect(r.lines[0].reduced).toEqual({ M: 2 }); // écart recalculé, pas lu du fichier
    expect(r.lines[0].reductionReason).toBe("ALLOCATION");
    expect(r.lines[0].status).toBe("LIVRABLE");
  });

  it("ne recalcule RIEN : un surplus du fichier est conservé tel quel", () => {
    // Cas réel : la répartition exportée contenait du surplus (alloué > commandé).
    // La réimporter ne doit pas « corriger » quoi que ce soit.
    const r = applyImportedAllocation({
      demands: [demand("A", "P", { M: 10 })],
      allocatedByKey: new Map([["A__P", { M: 13 }]]),
      clientConfigs: new Map([["A", cfg()]]),
    });
    expect(r.lines[0].allocated).toEqual({ M: 13 });
    expect(r.lines[0].reduced).toEqual({}); // aucun manque
    expect(r.lines[0].reductionReason).toBe("NONE");
  });

  it("une commande absente du fichier est annulée (0 alloué)", () => {
    const r = applyImportedAllocation({
      demands: [demand("A", "P", { M: 10 }), demand("B", "P", { M: 4 })],
      allocatedByKey: new Map([["A__P", { M: 10 }]]), // B n'est pas dans le fichier
      clientConfigs: new Map([
        ["A", cfg()],
        ["B", cfg()],
      ]),
    });
    const b = r.lines.find((l) => l.clientId === "B")!;
    expect(b.allocated).toEqual({});
    expect(b.status).toBe("ANNULE");
    expect(b.reduced).toEqual({ M: 4 });
  });

  it("respecte le seuil minimum de livraison", () => {
    const r = applyImportedAllocation({
      demands: [demand("A", "P", { M: 10 })],
      allocatedByKey: new Map([["A__P", { M: 2 }]]),
      clientConfigs: new Map([["A", cfg(5)]]), // seuil 5 > 2 alloué
    });
    expect(r.lines[0].status).toBe("EN_ATTENTE");
  });

  it("signale les lignes du fichier sans commande correspondante au lieu de les inventer", () => {
    const r = applyImportedAllocation({
      demands: [demand("A", "P", { M: 10 })],
      allocatedByKey: new Map([
        ["A__P", { M: 10 }],
        ["INCONNU__P", { M: 3 }], // boutique qui n'a pas commandé ce produit
      ]),
      clientConfigs: new Map([["A", cfg()]]),
    });
    expect(r.lines).toHaveLength(1); // on n'invente pas de ligne
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("1 ligne(s) du fichier");
  });
});

describe("restrictDemandsToImported — ne garde que les produits du fichier", () => {
  const alloc = new Map<string, SizeQuantities>([
    ["A__P", { M: 8 }],
    ["A__Q", { L: 3 }],
  ]);

  it("écarte les commandes dont le (boutique, produit) n'est pas dans le fichier", () => {
    // Cas réel : la saison a 8353 lignes (boutique×produit) mais le fichier n'en couvre que
    // ~262. Sans filtre, tous les autres produits sortaient à 0 alloué avec un écart complet.
    const demands = [
      demand("A", "P", { M: 10 }), // dans le fichier
      demand("A", "Q", { L: 5 }), // dans le fichier
      demand("A", "Z", { M: 4 }), // PAS dans le fichier → doit disparaître
      demand("B", "P", { M: 6 }), // boutique absente du fichier → doit disparaître
    ];
    const kept = restrictDemandsToImported(demands, alloc);
    expect(kept.map((d) => `${d.clientId}__${d.productId}`).sort()).toEqual(["A__P", "A__Q"]);
  });

  it("agrège les commandes multiples d'une même boutique pour un même produit", () => {
    // Un client qui a commandé le même produit sur 2 commandes → 1 seule ligne, cumulée.
    const demands = [demand("A", "P", { M: 10 }), demand("A", "P", { L: 4 })];
    const kept = restrictDemandsToImported(demands, alloc);
    expect(kept).toHaveLength(1);
    expect(kept[0].requested).toEqual({ M: 10, L: 4 });
    expect(kept[0].sizeScale.sort()).toEqual(["L", "M"]);
  });
});
