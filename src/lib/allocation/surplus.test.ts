import { describe, it, expect } from "vitest";
import { distributeSurplus, type SurplusLine } from "./surplus";
import { sumQuantities, type SizeQuantities } from "@/lib/utils";

const L = (
  key: string,
  original: SizeQuantities,
  allocated: SizeQuantities,
  ranking: number
): SurplusLine => ({ key, original, allocated, ranking });

describe("distributeSurplus — le surplus va aux boutiques coupées", () => {
  // Cas réel CCAH26_PU02/005 (simplifié) : le manque est sur M, le surplus sur XL, et
  // TOUTES les boutiques ont déjà leur XL complet. L'ancienne règle refusait de placer
  // les pièces (« tailles déjà complètes ») alors qu'un XL de plus réduit bien l'écart
  // GLOBAL de la boutique (-11 % → -6 %).
  it("place le surplus XL chez une boutique coupée sur M, car elle a commandé du XL", () => {
    const r = distributeSurplus(
      [
        L("A", { M: 10, XL: 5 }, { M: 8, XL: 5 }, 1),
        L("B", { M: 10, XL: 5 }, { M: 8, XL: 5 }, 2),
        L("C", { M: 10, XL: 5 }, { M: 8, XL: 5 }, 3),
      ],
      { M: 24, XL: 16 } // M : tout alloué ; XL : 15 alloués / 16 reçus → 1 de surplus
    );
    expect(r.filledGaps).toBe(1);
    expect(r.leftover).toBe(0);
    // À déficit égal, le meilleur rang est servi — au-delà de ses 5 XL commandés.
    expect(r.allocByKey.get("A")!.XL).toBe(6);
    expect(sumQuantities(r.allocByKey.get("A")!)).toBe(14); // écart -2 → -1
  });

  it("ne place JAMAIS une taille que la boutique n'a pas commandée", () => {
    const r = distributeSurplus(
      [
        L("SANS_XL", { M: 10 }, { M: 8 }, 1), // n'a pas commandé de XL
        L("AVEC_XL", { M: 10, XL: 2 }, { M: 8, XL: 2 }, 2),
      ],
      { M: 16, XL: 5 } // 3 XL de surplus
    );
    expect(r.allocByKey.get("SANS_XL")!.XL ?? 0).toBe(0);
    // Celle qui a commandé du XL peut, elle, dépasser sa quantité commandée.
    expect(r.allocByKey.get("AVEC_XL")!.XL).toBeGreaterThan(2);
  });

  it("sert la plus coupée en premier (minimise l'écart entre les %), même si son rang est moins bon", () => {
    const r = distributeSurplus(
      [
        L("PEU_COUPEE", { M: 10, XL: 5 }, { M: 9, XL: 5 }, 1), // -1/15 ≈ -7 %
        L("TRES_COUPEE", { M: 10, XL: 5 }, { M: 5, XL: 5 }, 2), // -5/15 ≈ -33 %
      ],
      { M: 14, XL: 11 } // 1 XL de surplus
    );
    expect(r.allocByKey.get("TRES_COUPEE")!.XL).toBe(6);
    expect(r.allocByKey.get("PEU_COUPEE")!.XL).toBe(5);
  });

  it("ne sert au-delà des commandes que si plus aucune boutique n'a d'écart", () => {
    const r = distributeSurplus(
      [L("A", { M: 10 }, { M: 10 }, 1), L("B", { M: 10 }, { M: 10 }, 2)],
      { M: 24 } // 4 de surplus, tout le monde est déjà complet
    );
    expect(r.stillShort).toBe(false);
    expect(r.beyond).toBe(4);
    expect(r.leftover).toBe(0);
  });

  it("laisse le reliquat en stock si des boutiques ont encore un écart", () => {
    const r = distributeSurplus(
      [
        L("SANS_XL", { M: 10 }, { M: 8 }, 1), // reste coupée, ne peut pas prendre de XL
        L("AVEC_XL", { M: 10, XL: 2 }, { M: 8, XL: 2 }, 2),
      ],
      { M: 16, XL: 9 } // beaucoup de XL en surplus
    );
    expect(r.stillShort).toBe(true);
    expect(r.beyond).toBe(0); // phase 2 bloquée
    expect(r.leftover).toBeGreaterThan(0);
  });

  it("ne dépasse jamais le reçu d'une taille", () => {
    const r = distributeSurplus([L("A", { M: 10 }, { M: 5 }, 1)], { M: 8 });
    expect(r.allocByKey.get("A")!.M).toBe(8);
    expect(r.leftover).toBe(0);
  });
});
