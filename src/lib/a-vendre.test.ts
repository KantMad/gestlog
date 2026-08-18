import { describe, it, expect } from "vitest";
import { countSizeGaps, discounted, computeTotals, type AVendreRow } from "./a-vendre";

const HAUT = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];

describe("à vendre — trous de tailles", () => {
  it("compte les tailles manquantes AU MILIEU", () => {
    // cas réel JMPULL_C080/820
    expect(countSizeGaps(["S", "M", "L", "XL", "2XL", "3XL"], { S: 15, M: 0, L: 7, XL: 6, "2XL": 3, "3XL": 1 })).toBe(1);
    // cas réel NMPTCH_C001/999 : 31, 34, 38 servis → 32,33 et 36 manquent au milieu
    expect(
      countSizeGaps(["29", "30", "31", "32", "33", "34", "36", "38"], { "31": 1, "34": 3, "38": 1 })
    ).toBe(3);
  });

  it("ne compte PAS les extrémités : une gamme courte n'est pas trouée", () => {
    // cas réel RMPULL_W002/752 — 3XL et 4XL absents, mais la gamme est continue
    expect(countSizeGaps(HAUT, { S: 5, M: 13, L: 17, XL: 14, "2XL": 5, "3XL": 0, "4XL": 0 })).toBe(0);
    // rien en bas non plus
    expect(countSizeGaps(HAUT, { S: 0, M: 0, L: 17, XL: 14 })).toBe(0);
  });

  it("gamme complète = 0 trou", () => {
    // cas réel PMBELT_P012/208
    expect(countSizeGaps(["S", "M", "L", "XL", "2XL", "3XL"], { S: 1, M: 5, L: 6, XL: 6, "2XL": 5, "3XL": 4 })).toBe(0);
  });

  it("cas limites : stock vide, une seule taille, taille unique", () => {
    expect(countSizeGaps(HAUT, {})).toBe(0);
    expect(countSizeGaps(HAUT, { L: 3 })).toBe(0);
    expect(countSizeGaps(["TU"], { TU: 42 })).toBe(0);
  });
});

describe("à vendre — remise et totaux", () => {
  it("applique la remise au prix", () => {
    expect(discounted(119, 30)).toBe(83.3);
    expect(discounted(59, 0)).toBe(59);
    expect(discounted(null, 30)).toBeNull();
  });

  it("borne la remise entre 0 et 100 %", () => {
    expect(discounted(100, -5)).toBe(100);
    expect(discounted(100, 150)).toBe(0);
  });

  const rows: AVendreRow[] = [
    { productId: "1", reference: "A", color: "999", colorLabel: "Noir", label: null, category: "Maille", subCategory: null,
      sizeScale: ["S", "M"], stock: { S: 2, M: 3 }, total: 5, gaps: 0, salePrice: 100, costPrice: 40 },
    { productId: "2", reference: "B", color: "213", colorLabel: null, label: null, category: "Denim", subCategory: null,
      sizeScale: ["TU"], stock: { TU: 10 }, total: 10, gaps: 0, salePrice: null, costPrice: 20 },
  ];

  it("totalise pièces, valeur remisée et valeur au coût", () => {
    const t = computeTotals(rows, 30);
    expect(t.products).toBe(2);
    expect(t.pieces).toBe(15);
    expect(t.saleValue).toBe(350); // 5 × 70 ; le produit sans prix n'est pas valorisé
    expect(t.costValue).toBe(400); // 5×40 + 10×20 — le coût n'est PAS remisé
    expect(t.piecesWithoutPrice).toBe(10);
  });

  it("sans remise, la valeur publique est le plein tarif", () => {
    expect(computeTotals(rows, 0).saleValue).toBe(500);
  });
});
