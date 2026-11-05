import { describe, it, expect } from "vitest";
import { construireFiche, motsDeRecherche } from "./assistant-fiche";

const base = {
  reference: "FIC_PULL01", colorCode: null, label: "Pull fictif", category: "Maille", subCategory: "Pull",
  sizeScale: "S,M,L,XL", salePrice: 129, costPrice: 43,
};

describe("construireFiche — stock par couleur et taille", () => {
  it("additionne les entrées, suit la grille de tailles, trie les couleurs par stock", () => {
    const f = construireFiche(
      [
        { ...base, color: "011", colorLabel: "Gris", quantitiesBySize: ['{"M":2}'] },
        { ...base, color: "006", colorLabel: "Bleu marine", quantitiesBySize: ['{"L":5,"S":1}', '{"L":1,"XXL":2}'] },
      ],
      [{ color: "Bleu marine", size: "L", quantity: BigInt(3) }, { color: "Gris", size: "M", quantity: 0 }]
    )!;
    expect(f.couleurs[0]).toEqual({
      couleur: "006", libelle: "Bleu marine", code: null, total: 9,
      tailles: [{ taille: "S", stock: 1 }, { taille: "M", stock: 0 }, { taille: "L", stock: 6 }, { taille: "XL", stock: 0 }, { taille: "XXL", stock: 2 }],
    });
    expect(f.couleurs[1].libelle).toBe("Gris");
    expect(f.stockTotal).toBe(11);
    expect(f).toMatchObject({ nom: "Pull fictif", prixPublic: 129, prixGros: 43 });
    expect(f.ventesSite).toEqual([{ couleur: "Bleu marine", taille: "L", quantite: 3 }]);
  });

  it("sans stock enregistré : tailles à 0 ; aucune ligne → null", () => {
    const f = construireFiche([{ ...base, color: "001", colorLabel: null, quantitiesBySize: [] }], [])!;
    expect(f.couleurs[0].tailles.every((t) => t.stock === 0)).toBe(true);
    expect(construireFiche([], [])).toBeNull();
  });
});

describe("motsDeRecherche", () => {
  it("garde les mots utiles, sans doublon ni mot vide", () => {
    expect(motsDeRecherche("Pull 1/2 zip lambswool, pull des RMPULL_W001")).toEqual(["pull", "zip", "lambswool", "rmpull_w001"]);
    expect(motsDeRecherche("le M")).toEqual([]);
  });
});
