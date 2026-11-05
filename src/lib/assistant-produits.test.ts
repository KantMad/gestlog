import { describe, it, expect } from "vitest";
import { fusionnerProduits } from "./assistant-produits";

describe("fusionnerProduits — ventes du site et stock par référence", () => {
  it("rattache ventes et stock par référence (casse et espaces ignorés), trie par ventes", () => {
    const r = fusionnerProduits(
      [
        { reference: "QMVEST_L001", name: "Veste fictive - L", quantity: 3, revenue: 359.7 },
        { reference: "pant01 ", name: "Pantalon fictif", quantity: 7, revenue: 419.3 },
      ],
      [
        { reference: "QMVEST_L001", label: "Veste fictive", category: "Veste", totalQuantity: 40 },
        { reference: "PANT01", label: "Pantalon fictif", category: "Pantalon", totalQuantity: 12 },
        { reference: "PLV01", label: "Présentoir", category: "PLV", totalQuantity: 500 },
      ]
    );
    expect(r).toEqual([
      { reference: "PANT01", nom: "Pantalon fictif", categorie: "Pantalon", vendusSite: 7, caSite: 419.3, stock: 12 },
      { reference: "QMVEST_L001", nom: "Veste fictive", categorie: "Veste", vendusSite: 3, caSite: 359.7, stock: 40 },
      { reference: "PLV01", nom: "Présentoir", categorie: "PLV", vendusSite: 0, caSite: 0, stock: 500 },
    ]);
  });

  it("vendu sans stock connu : gardé, stock 0 ; ni vendu ni en stock : écarté ; bigint accepté", () => {
    const r = fusionnerProduits(
      [{ reference: "ANCIEN", name: "Ancien modèle", quantity: BigInt(2), revenue: 80 }],
      [{ reference: "VIDE", label: null, category: null, totalQuantity: 0 }]
    );
    expect(r).toEqual([{ reference: "ANCIEN", nom: "Ancien modèle", categorie: null, vendusSite: 2, caSite: 80, stock: 0 }]);
  });
});
