import { describe, it, expect } from "vitest";
import { aggregateAssistantStock, mapAssistantOrders, SANS_CATEGORIE } from "./assistant-recap";

describe("aggregateAssistantStock — stock valorisé par catégorie", () => {
  it("valorise au coût et au prix public, trie par valeur au coût décroissante", () => {
    const r = aggregateAssistantStock([
      { category: "Pantalon", totalQuantity: 10, costPrice: 20, salePrice: 59.9 },
      { category: "Pantalon", totalQuantity: 5, costPrice: 22, salePrice: 65 },
      { category: "Cuirs", totalQuantity: 2, costPrice: 213, salePrice: 639 },
    ]);
    expect(r).toEqual([
      { categorie: "Cuirs", pieces: 2, valeurCout: 426, valeurPublic: 1278, piecesSansPrixCout: 0, piecesSansPrixPublic: 0 },
      { categorie: "Pantalon", pieces: 15, valeurCout: 310, valeurPublic: 924, piecesSansPrixCout: 0, piecesSansPrixPublic: 0 },
    ]);
  });

  it("un prix absent ou à 0 n'est pas valorisé : les pièces sont comptées à part", () => {
    const [c] = aggregateAssistantStock([
      { category: "Maille", totalQuantity: 4, costPrice: null, salePrice: 0 },
      { category: "Maille", totalQuantity: 6, costPrice: 15, salePrice: 49 },
    ]);
    expect(c).toEqual({
      categorie: "Maille", pieces: 10, valeurCout: 90, valeurPublic: 294,
      piecesSansPrixCout: 4, piecesSansPrixPublic: 4,
    });
  });

  it("catégorie vide → « Sans catégorie » ; stock nul ou négatif ignoré", () => {
    const r = aggregateAssistantStock([
      { category: null, totalQuantity: 3, costPrice: 10, salePrice: 30 },
      { category: "  ", totalQuantity: 1, costPrice: 10, salePrice: 30 },
      { category: "Chemise", totalQuantity: 0, costPrice: 10, salePrice: 30 },
      { category: "Chemise", totalQuantity: -2, costPrice: 10, salePrice: 30 },
    ]);
    expect(r.map((c) => [c.categorie, c.pieces])).toEqual([[SANS_CATEGORIE, 4]]);
  });

  it("arrondit au centime", () => {
    const [c] = aggregateAssistantStock([{ category: "X", totalQuantity: 3, costPrice: 0.1, salePrice: 0.7 }]);
    expect(c.valeurCout).toBe(0.3);
    expect(c.valeurPublic).toBe(2.1);
  });
});

describe("mapAssistantOrders", () => {
  it("expose le montant tel quel (prix de gros) et marque la source TIO", () => {
    expect(
      mapAssistantOrders([
        {
          orderNumber: "IS-1", clientName: "Boutique", orderDate: new Date("2026-10-25T08:00:00Z"),
          totalAmount: null, status: "EN_COURS", orderType: "COMMANDE",
        },
      ]),
    ).toEqual([
      { numero: "IS-1", client: "Boutique", date: "2026-10-25T08:00:00.000Z", montant: null, statut: "EN_COURS", type: "COMMANDE", source: "TIO" },
    ]);
  });
});
