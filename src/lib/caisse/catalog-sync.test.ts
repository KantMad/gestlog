import { describe, it, expect } from "vitest";
import { buildCatalogItems, type CatalogRow } from "./catalog-sync";

function ligne(p: Partial<CatalogRow> = {}): CatalogRow {
  return {
    reference: "QMBLAZ_C820",
    color: "752",
    colorCode: "752",
    colorLabel: "Bleu marine",
    label: "Blazer en piqué de coton",
    salePrice: 209,
    costPrice: 95,
    category: "Vestes",
    size: "3XL",
    ean: "3665249594504",
    ...p,
  };
}

describe("buildCatalogItems", () => {
  it("reprend la fiche produit complète", () => {
    const { items } = buildCatalogItems([ligne()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sku: "QMBLAZ_C820",
      name: "Blazer en piqué de coton",
      price: 209,
      costPrice: 95,
      category: "Vestes",
      ean: "3665249594504",
      size: "3XL",
    });
  });

  // 🔴 La régression que la caisse a signalée : « 213 » affiché comme nom de couleur.
  it("envoie le NOM dans color et le CODE dans colorCode", () => {
    const { items } = buildCatalogItems([ligne()]);
    expect(items[0].color).toBe("Bleu marine");
    expect(items[0].colorCode).toBe("752");
  });

  it("se rabat sur le code quand le nom de couleur manque", () => {
    const { items } = buildCatalogItems([ligne({ colorLabel: null })]);
    expect(items[0].color).toBe("752");
    expect(items[0].colorCode).toBe("752");
  });

  // 🔴 Un article à 0 € serait vendu gratuitement en caisse.
  it("OMET le prix au lieu de l'envoyer à 0", () => {
    const { items, sansPrix } = buildCatalogItems([ligne({ salePrice: 0 })]);
    expect(items[0]).not.toHaveProperty("price");
    expect(sansPrix).toEqual(["QMBLAZ_C820/752/3XL"]);
  });

  it("omet aussi un prix nul (null) et un coût nul", () => {
    const { items } = buildCatalogItems([ligne({ salePrice: null, costPrice: null })]);
    expect(items[0]).not.toHaveProperty("price");
    expect(items[0]).not.toHaveProperty("costPrice");
  });

  it("écarte un EAN qui n'est pas à 13 chiffres", () => {
    const { items, eanInvalide } = buildCatalogItems([
      ligne({ ean: "123" }),
      ligne({ ean: "" }),
      ligne({ ean: "366524959450X" }),
    ]);
    expect(items).toHaveLength(0);
    expect(eanInvalide).toHaveLength(3);
  });

  it("écarte un produit sans désignation : il n'a aucune identité", () => {
    const { items, sansNom } = buildCatalogItems([ligne({ label: null }), ligne({ label: "  " })]);
    expect(items).toHaveLength(0);
    expect(sansNom).toHaveLength(2);
  });

  it("déduit la collection de la lettre de référence quand elle est sûre", () => {
    const { items } = buildCatalogItems([ligne({ reference: "SMCHML_C025" })]);
    expect(items[0].collection).toBe("PE27");
  });

  // Les préfixes CC/TH/CM désignent des LIGNES de produits, pas des saisons.
  it("n'invente PAS de collection sur un préfixe non fiable", () => {
    const { items } = buildCatalogItems([ligne({ reference: "CCPE27_PT03" })]);
    expect(items[0]).not.toHaveProperty("collection");
  });

  it("omet la catégorie absente plutôt que d'envoyer une chaîne vide", () => {
    const { items } = buildCatalogItems([ligne({ category: null })]);
    expect(items[0]).not.toHaveProperty("category");
  });

  it("n'envoie AUCUNE quantité ni stock", () => {
    const { items } = buildCatalogItems([ligne()]);
    const clefs = Object.keys(items[0]);
    for (const interdite of ["quantity", "stock", "qty", "quantite"]) {
      expect(clefs).not.toContain(interdite);
    }
  });

  it("traite chaque taille comme une ligne distincte", () => {
    const { items } = buildCatalogItems([
      ligne({ size: "M", ean: "3665249594501" }),
      ligne({ size: "L", ean: "3665249594502" }),
    ]);
    expect(items.map((i) => i.size)).toEqual(["M", "L"]);
    expect(new Set(items.map((i) => i.ean)).size).toBe(2);
  });

  it("nettoie les espaces autour de l'EAN, de la taille et des couleurs", () => {
    const { items } = buildCatalogItems([
      ligne({ ean: " 3665249594504 ", size: " M ", colorLabel: " Bleu ", colorCode: " 752 " }),
    ]);
    expect(items[0]).toMatchObject({ ean: "3665249594504", size: "M", color: "Bleu", colorCode: "752" });
  });

  it("ne rend rien sur une liste vide", () => {
    expect(buildCatalogItems([])).toEqual({ items: [], eanInvalide: [], sansNom: [], sansPrix: [] });
  });
});
