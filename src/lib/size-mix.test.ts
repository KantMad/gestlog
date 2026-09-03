import { describe, it, expect } from "vitest";
import { buildSizeMix, ALL_CATEGORIES, NO_CATEGORY } from "./size-mix";

describe("buildSizeMix", () => {
  const lines = [
    { category: "Maille", quantitiesBySize: '{"M":20,"L":30,"XL":50}' },
    { category: "Maille", quantitiesBySize: '{"L":10}' },
    { category: "Denim", quantitiesBySize: '{"32":15,"34":5}' },
  ];
  const groups = buildSizeMix(lines);

  it("place le cumul toutes catégories en tête", () => {
    expect(groups[0].category).toBe(ALL_CATEGORIES);
    expect(groups[0].pieces).toBe(130);
  });

  it("classe les catégories de la plus grosse à la plus petite", () => {
    expect(groups.slice(1).map((g) => g.category)).toEqual(["Maille", "Denim"]);
  });

  it("calcule le pourcentage DANS la catégorie, pas sur le total", () => {
    const maille = groups.find((g) => g.category === "Maille")!;
    expect(maille.pieces).toBe(110);
    // L = 30 + 10 = 40 sur 110
    expect(maille.sizes.find((s) => s.size === "L")).toEqual({
      size: "L",
      quantity: 40,
      percent: 36.4,
    });
  });

  it("ordonne les tailles selon la grille et non par volume", () => {
    const maille = groups.find((g) => g.category === "Maille")!;
    expect(maille.sizes.map((s) => s.size)).toEqual(["M", "L", "XL"]);
    const denim = groups.find((g) => g.category === "Denim")!;
    expect(denim.sizes.map((s) => s.size)).toEqual(["32", "34"]);
  });

  it("les parts d'une catégorie totalisent 100 %", () => {
    const denim = groups.find((g) => g.category === "Denim")!;
    expect(denim.sizes.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100, 1);
  });

  it("ne mélange PAS les grilles : le denim ignore les tailles lettres", () => {
    const denim = groups.find((g) => g.category === "Denim")!;
    expect(denim.sizes.map((s) => s.size)).not.toContain("L");
  });

  it("regroupe les produits sans catégorie sous un libellé explicite", () => {
    const g = buildSizeMix([{ category: null, quantitiesBySize: '{"TU":5}' }]);
    expect(g.map((x) => x.category)).toEqual([ALL_CATEGORIES, NO_CATEGORY]);
  });

  it("normalise la casse des tailles et écarte les quantités nulles", () => {
    const g = buildSizeMix([{ category: "X", quantitiesBySize: '{"m":2,"M":3,"L":0}' }]);
    expect(g[0].sizes).toEqual([{ size: "M", quantity: 5, percent: 100 }]);
  });

  it("survit à un JSON invalide et rend un tableau vide sans données", () => {
    expect(buildSizeMix([{ category: "X", quantitiesBySize: "oups" }])).toEqual([]);
    expect(buildSizeMix([])).toEqual([]);
  });
});
