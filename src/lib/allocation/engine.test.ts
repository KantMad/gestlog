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
