import { describe, it, expect } from "vitest";
import { distributeSurplus, type SurplusLine } from "./surplus";
import { sumQuantities, type SizeQuantities } from "@/lib/utils";

const L = (
  key: string,
  original: SizeQuantities,
  allocated: SizeQuantities,
  ranking: number,
  excludedSizes?: string[]
): SurplusLine => ({ key, original, allocated, ranking, ...(excludedSizes ? { excludedSizes } : {}) });

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

  // Cas réel CCAH26_CH07/752 : 109 commandées, 117 reçues. L'ancien prorata par taille
  // arrondissait toutes les parts à 0 (3 pièces de surplus pour 13 commandées → 0), donc
  // TOUT passait par le départage au rang : les 3 meilleures boutiques raflaient tout,
  // taille après taille (+22 % / +9 % / +6 % / 0 % / 0 %), et c'est la PLUS PETITE commande
  // qui gagnait le plus — l'inverse du but.
  it("répartit le surplus sur toutes les boutiques, pas seulement les mieux classées", () => {
    const shops = [
      L("Mirabeau", { S: 2, M: 3, L: 4, XL: 4, "2XL": 2, "3XL": 2, "4XL": 1 }, { S: 2, M: 3, L: 4, XL: 4, "2XL": 2, "3XL": 2, "4XL": 1 }, 1),
      L("Romans", { S: 1, M: 7, L: 11, XL: 9, "2XL": 4, "3XL": 2, "4XL": 1 }, { S: 1, M: 7, L: 10, XL: 9, "2XL": 4, "3XL": 2, "4XL": 1 }, 2),
      L("ClassicIsl", { M: 3, L: 6, XL: 6, "2XL": 2, "3XL": 1 }, { M: 3, L: 6, XL: 6, "2XL": 2, "3XL": 1 }, 3),
      L("Roubaix", { M: 3, L: 6, XL: 6, "2XL": 3, "3XL": 1, "4XL": 1 }, { M: 3, L: 6, XL: 6, "2XL": 3, "3XL": 1, "4XL": 1 }, 4),
      L("Talange", { M: 3, L: 6, XL: 6, "2XL": 2, "3XL": 1 }, { M: 3, L: 6, XL: 6, "2XL": 2, "3XL": 1 }, 5),
    ];
    const r = distributeSurplus(shops, { S: 3, M: 22, L: 32, XL: 33, "2XL": 16, "3XL": 8, "4XL": 3 });
    expect(r.leftover).toBe(0); // les 9 pièces sont placées
    // AUCUNE boutique ne reste à 0 : c'était le bug (Roubaix et Talange servies à 0 %).
    for (const s of shops) {
      const alloc = sumQuantities(r.allocByKey.get(s.key)!);
      expect(alloc).toBeGreaterThan(sumQuantities(s.original));
    }
    // Les écarts en % se resserrent : plus de 22 % pour la plus petite commande.
    const pct = shops.map((s) => sumQuantities(r.allocByKey.get(s.key)!) / sumQuantities(s.original) - 1);
    expect(Math.max(...pct) - Math.min(...pct)).toBeLessThan(0.1);
    expect(Math.max(...pct)).toBeLessThan(0.15);
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

describe("distributeSurplus — exceptions de taille par boutique", () => {
  it("ne pose pas de surplus sur une taille exclue quand une autre boutique la prend", () => {
    const r = distributeSurplus(
      [
        L("SANS_4XL", { M: 10, "4XL": 2 }, { M: 10, "4XL": 2 }, 1, ["4XL"]), // exclue du 4XL
        L("NORMALE", { M: 10, "4XL": 2 }, { M: 10, "4XL": 2 }, 2),
      ],
      { M: 20, "4XL": 8 } // 4 pièces de 4XL en surplus
    );
    // La boutique exclue garde ses 2 (sa commande), tout le surplus va à l'autre.
    expect(r.allocByKey.get("SANS_4XL")!["4XL"]).toBe(2);
    expect(r.allocByKey.get("NORMALE")!["4XL"]).toBe(6);
    expect(r.leftover).toBe(0);
  });

  it("lève l'exception si AUCUNE autre boutique n'a commandé la taille", () => {
    const r = distributeSurplus(
      [
        L("SANS_4XL", { M: 10, "4XL": 2 }, { M: 10, "4XL": 2 }, 1, ["4XL"]),
        L("AUTRE", { M: 10 }, { M: 10 }, 2), // n'a pas commandé de 4XL
      ],
      { M: 20, "4XL": 5 } // 3 de surplus : personne d'autre ne peut les prendre
    );
    // Sans la levée, les 3 pièces resteraient bloquées en stock.
    expect(r.allocByKey.get("SANS_4XL")!["4XL"]).toBe(5);
    expect(r.leftover).toBe(0);
  });

  it("rend à la boutique exclue ce qu'elle a réellement commandé (l'exception ne vise que le surplus)", () => {
    const r = distributeSurplus(
      [
        // A commandé 4 × 4XL, n'en a reçu que 2 → l'exception ne doit pas la priver des 2 autres.
        L("SANS_4XL", { "4XL": 4 }, { "4XL": 2 }, 1, ["4XL"]),
        L("NORMALE", { "4XL": 4 }, { "4XL": 4 }, 2),
      ],
      { "4XL": 8 } // 2 pièces libres, qui correspondent exactement au manque de SANS_4XL
    );
    expect(r.allocByKey.get("SANS_4XL")!["4XL"]).toBe(4); // sa commande, pas du surplus
    expect(r.allocByKey.get("NORMALE")!["4XL"]).toBe(4);
    expect(r.stillShort).toBe(false);
  });

  it("une boutique exclue reste servie normalement sur ses autres tailles", () => {
    const r = distributeSurplus(
      [
        L("SANS_4XL", { M: 10, "4XL": 2 }, { M: 8, "4XL": 2 }, 1, ["4XL"]), // coupée de 2 sur M
        L("NORMALE", { M: 10, "4XL": 2 }, { M: 10, "4XL": 2 }, 2),
      ],
      { M: 20, "4XL": 4 }
    );
    expect(r.allocByKey.get("SANS_4XL")!.M).toBe(10); // son écart sur M est comblé
    expect(r.allocByKey.get("SANS_4XL")!["4XL"]).toBe(2); // mais toujours pas de 4XL en trop
  });
});
