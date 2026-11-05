import { describe, it, expect } from "vitest";
import {
  buildCommandesProduits,
  ordonnerParGrille,
  prixCommandeExploitable,
  RAISON_PRIX_TEXAS,
  COLONNES,
  type LigneBase,
} from "./export-commandes-produits";

/** Une ligne de base, telle que la route la lit (déjà éclatée par taille). */
function ligne(o: Partial<LigneBase> = {}): LigneBase {
  return {
    orderNumber: "IS-455405299095",
    clientCode: "BAZAR09201",
    clientName: "Bazar Chic",
    reference: "PMMANT_S010",
    label: "Manteau feutré",
    colorCode: "951",
    colorLabel: "Gris Anthracite",
    sizeScale: "S,M,L,XL,2XL,3XL,4XL",
    size: "S",
    quantity: 2,
    category: "Pièces à manches",
    subCategory: "Manteaux",
    unitNet: 79.8,
    costPrice: 133,
    salePrice: 399,
    ean: "3665249545308",
    ...o,
  };
}

describe("prixCommandeExploitable", () => {
  it("accepte TIO : 8,91 prix distincts par commande, le prix est celui de la ligne", () => {
    expect(prixCommandeExploitable("TIO")).toBe(true);
  });

  it("REFUSE TEXAS : un seul prix pour toute la commande sur 225 commandes sur 269", () => {
    expect(prixCommandeExploitable("TEXAS")).toBe(false);
  });

  it("dit pourquoi, en un seul texte réutilisable", () => {
    expect(RAISON_PRIX_TEXAS).toContain("prorata");
    expect(RAISON_PRIX_TEXAS).toContain("tarif de gros");
  });
});

describe("ordonnerParGrille", () => {
  it("remet les tailles dans l'ordre de la grille, pas dans l'ordre alphabétique", () => {
    const l = [{ size: "2XL" }, { size: "L" }, { size: "M" }, { size: "S" }, { size: "XL" }];
    expect(ordonnerParGrille(l, "S,M,L,XL,2XL").map((x) => x.size)).toEqual([
      "S", "M", "L", "XL", "2XL",
    ]);
  });

  it("gère les grilles numériques (pantalons)", () => {
    const l = [{ size: "34" }, { size: "29" }, { size: "42" }, { size: "30" }];
    expect(ordonnerParGrille(l, "29,30,31,32,33,34,36,38,40,42,44").map((x) => x.size)).toEqual([
      "29", "30", "34", "42",
    ]);
  });

  it("met les tailles HORS grille à la fin, sans les perdre", () => {
    const l = [{ size: "5XL" }, { size: "M" }, { size: "S" }];
    expect(ordonnerParGrille(l, "S,M,L").map((x) => x.size)).toEqual(["S", "M", "5XL"]);
  });

  it("ignore casse et espaces de la grille", () => {
    const l = [{ size: "xl" }, { size: "s" }];
    expect(ordonnerParGrille(l, " S , M , L , XL ").map((x) => x.size)).toEqual(["s", "xl"]);
  });

  it("sans grille, l'ordre d'arrivée est conservé", () => {
    const l = [{ size: "XL" }, { size: "S" }];
    expect(ordonnerParGrille(l, null).map((x) => x.size)).toEqual(["XL", "S"]);
    expect(ordonnerParGrille(l, "").map((x) => x.size)).toEqual(["XL", "S"]);
  });
});

describe("buildCommandesProduits", () => {
  it("rend exactement les 14 colonnes demandées, dans l'ordre", () => {
    const out = buildCommandesProduits([ligne()]);
    expect(out.header).toEqual([
      "EAN", "Référence produit", "Nom produit", "Libellé couleur", "Code couleur", "Taille",
      "Quantité commandée", "Catégorie", "Sous-catégorie", "Prix wholesale",
      "Prix de vente conseillé", "Numéro de commande client", "Code client", "Enseigne client",
    ]);
    expect(out.header).toHaveLength(14);
    expect(out.rows[0]).toEqual([
      "3665249545308", "PMMANT_S010", "Manteau feutré", "Gris Anthracite", "951", "S",
      2, "Pièces à manches", "Manteaux", 79.8, 399, "IS-455405299095", "BAZAR09201", "Bazar Chic",
    ]);
  });

  it("garde l'EAN en TEXTE : converti en nombre, Excel l'afficherait 3,66525E+12", () => {
    const out = buildCommandesProduits([ligne()]);
    expect(typeof out.rows[0][0]).toBe("string");
  });

  it("quantité et prix sont NUMÉRIQUES, pour qu'Excel les additionne", () => {
    const out = buildCommandesProduits([ligne()]);
    expect(typeof out.rows[0][6]).toBe("number");
    expect(typeof out.rows[0][9]).toBe("number");
    expect(typeof out.rows[0][10]).toBe("number");
  });

  it("prix wholesale « commande » = prix unitaire reconstruit", () => {
    expect(buildCommandesProduits([ligne()]).rows[0][9]).toBe(79.8);
  });

  it("prix wholesale « catalogue » = costPrice", () => {
    const out = buildCommandesProduits([ligne()], { wholesaleSource: "catalogue" });
    expect(out.rows[0][9]).toBe(133);
    expect(out.totalWholesale).toBe(266);
  });

  it("remet les tailles d'un coloris dans l'ordre de sa grille", () => {
    const out = buildCommandesProduits([
      ligne({ size: "2XL", ean: "5" }),
      ligne({ size: "S", ean: "1" }),
      ligne({ size: "XL", ean: "4" }),
      ligne({ size: "M", ean: "2" }),
      ligne({ size: "L", ean: "3" }),
    ]);
    expect(out.rows.map((r) => r[5])).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(out.rows.map((r) => r[0])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("n'ordonne QUE dans un coloris : deux coloris ne se mélangent pas", () => {
    const out = buildCommandesProduits([
      ligne({ colorCode: "951", size: "XL" }),
      ligne({ colorCode: "951", size: "S" }),
      ligne({ colorCode: "752", size: "XL" }),
      ligne({ colorCode: "752", size: "S" }),
    ]);
    expect(out.rows.map((r) => `${r[4]}-${r[5]}`)).toEqual([
      "951-S", "951-XL", "752-S", "752-XL",
    ]);
  });

  it("ne mélange pas deux commandes portant le même coloris", () => {
    const out = buildCommandesProduits([
      ligne({ orderNumber: "IS-1", size: "XL" }),
      ligne({ orderNumber: "IS-2", size: "S" }),
      ligne({ orderNumber: "IS-1", size: "S" }),
    ]);
    expect(out.rows.map((r) => `${r[11]}-${r[5]}`)).toEqual(["IS-1-S", "IS-1-XL", "IS-2-S"]);
  });

  it("totalise le montant wholesale = prix × quantité", () => {
    const out = buildCommandesProduits([
      ligne({ size: "S", quantity: 2 }),
      ligne({ size: "L", quantity: 9 }),
    ]);
    expect(out.pieces).toBe(11);
    expect(out.totalWholesale).toBe(877.8); // 79,80 × 11
  });

  it("arrondit À LA LIGNE : 0,1 × 3 vaut 0.30000000000000004 en flottant", () => {
    const out = buildCommandesProduits([
      ligne({ unitNet: 0.1, quantity: 3 }),
      ligne({ size: "M", unitNet: 0.1, quantity: 3 }),
    ]);
    expect(out.totalWholesale).toBe(0.6);
  });

  it("laisse l'EAN VIDE quand la taille n'en a pas — jamais un code inventé", () => {
    const out = buildCommandesProduits([ligne({ ean: null })]);
    expect(out.rows[0][0]).toBe("");
    expect(out.sansEan).toBe(1);
    expect(out.referencesSansEan).toEqual(["PMMANT_S010"]);
    expect(out.rows).toHaveLength(1); // la ligne est CONSERVÉE
  });

  it("laisse vide, et signale, une référence sans prix conseillé", () => {
    const out = buildCommandesProduits([ligne({ reference: "CCPE27_PL01", salePrice: null })]);
    expect(out.rows[0][10]).toBe("");
    expect(out.sansPrixConseille).toBe(1);
    expect(out.referencesSansPrixConseille).toEqual(["CCPE27_PL01"]);
  });

  it("compte les lignes sans prix wholesale et sous-estime le total en le disant", () => {
    const out = buildCommandesProduits([ligne({ unitNet: null })]);
    expect(out.rows[0][9]).toBe("");
    expect(out.sansPrixWholesale).toBe(1);
    expect(out.totalWholesale).toBe(0);
  });

  it("un prix à 0 € reste 0 € : c'est une valeur, pas une absence", () => {
    const out = buildCommandesProduits([ligne({ unitNet: 0 })]);
    expect(out.rows[0][9]).toBe(0);
    expect(out.sansPrixWholesale).toBe(0);
  });

  it("remplace les champs produit absents par du vide, sans retirer la ligne", () => {
    const out = buildCommandesProduits([
      ligne({ label: null, colorLabel: null, colorCode: null, category: null, subCategory: null, clientCode: null }),
    ]);
    expect(out.rows[0]).toEqual([
      "3665249545308", "PMMANT_S010", "", "", "", "S", 2, "", "", 79.8, 399,
      "IS-455405299095", "", "Bazar Chic",
    ]);
  });

  it("rend des listes triées et dédoublonnées", () => {
    const out = buildCommandesProduits([
      ligne({ reference: "ZZZ_C001", orderNumber: "IS-2", clientName: "Zèbre" }),
      ligne({ reference: "AAA_C001", orderNumber: "IS-1", clientName: "Abeille" }),
      ligne({ reference: "AAA_C001", orderNumber: "IS-1", clientName: "Abeille", size: "M" }),
    ]);
    expect(out.references).toEqual(["AAA_C001", "ZZZ_C001"]);
    expect(out.commandes).toEqual(["IS-1", "IS-2"]);
    expect(out.enseignes).toEqual(["Abeille", "Zèbre"]);
  });

  it("aucune ligne donne un export vide, pas une erreur", () => {
    const out = buildCommandesProduits([]);
    expect(out.rows).toEqual([]);
    expect(out.header).toHaveLength(COLONNES.length);
    expect(out.pieces).toBe(0);
    expect(out.totalWholesale).toBe(0);
  });
});
