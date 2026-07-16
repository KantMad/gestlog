import { describe, it, expect } from "vitest";
import { runAllocation } from "./engine";
import { sumQuantities } from "@/lib/utils";
import type { AllocationInput, ClientConfig } from "./types";

const cfg = (ranking: number): ClientConfig => ({
  ranking,
  maxReductionOrder: 50,
  maxReductionLine: 50, // valeur qui déclenchait la restauration « fantôme »
  minDeliveryThreshold: 0,
  rotationScore: 0,
});

function input(available: Record<string, Record<string, number>>): AllocationInput {
  return {
    seasonId: "s1",
    available: new Map(Object.entries(available)),
    // 2 boutiques, même produit, taille unique M : 20 demandées chacune (40 au total).
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: ["M"], requested: { M: 20 } },
      { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: ["M"], requested: { M: 20 } },
    ],
    clientConfigs: new Map([
      ["A", cfg(1)],
      ["B", cfg(2)],
    ]),
  };
}

const totalAllocated = (r: ReturnType<typeof runAllocation>) =>
  r.lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);

describe("runAllocation — l'alloué ne dépasse JAMAIS la commande d'une boutique", () => {
  // Cas réel (CCAH26_PU02/005) : le produit est globalement en manque, MAIS une taille a été
  // sur-livrée (XL demandé 4 / reçu 6). Le pro-rata non plafonné servait alors les boutiques
  // au-dessus de leur commande. Le reliquat doit rester NON alloué (→ « Répartir surplus »).
  const surplusInput: AllocationInput = {
    seasonId: "s1",
    available: new Map([["P", { M: 12, XL: 6 }]]), // M en manque (12/20), XL en excès (6/4)
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: ["M", "XL"], requested: { M: 10, XL: 2 } },
      { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: ["M", "XL"], requested: { M: 10, XL: 2 } },
    ],
    clientConfigs: new Map([
      ["A", cfg(1)],
      ["B", cfg(2)],
    ]),
  };

  it("une taille sur-livrée ne fait pas dépasser la commande (surplus laissé de côté)", () => {
    const r = runAllocation(surplusInput);
    for (const l of r.lines) {
      for (const [size, req] of Object.entries(l.original)) {
        expect(l.allocated[size] ?? 0).toBeLessThanOrEqual(req);
      }
      expect(sumQuantities(l.allocated)).toBeLessThanOrEqual(sumQuantities(l.original));
    }
    // XL : 4 demandés au total, 6 reçus → on n'en alloue que 4, jamais 6.
    const xl = r.lines.reduce((s, l) => s + (l.allocated.XL ?? 0), 0);
    expect(xl).toBe(4);
  });
});

describe("runAllocation — l'alloué ne dépasse jamais le reçu", () => {
  it("0 reçu → 0 alloué (pas de pièce fantôme via le cap de réduction)", () => {
    const r = runAllocation(input({})); // aucune réception pour P
    expect(totalAllocated(r)).toBe(0);
    expect(r.lines.every((l) => sumQuantities(l.allocated) === 0)).toBe(true);
    expect(r.lines.every((l) => l.status === "ANNULE")).toBe(true);
  });

  it("reçu partiel → total alloué = total reçu (même avec un cap ligne à 50%)", () => {
    const r = runAllocation(input({ P: { M: 10 } })); // 10 reçus pour 40 demandés
    expect(totalAllocated(r)).toBe(10);
  });

  it("reçu suffisant → tout est alloué", () => {
    const r = runAllocation(input({ P: { M: 40 } }));
    expect(totalAllocated(r)).toBe(40);
    expect(r.lines.every((l) => l.reductionReason === "NONE")).toBe(true);
  });
});
