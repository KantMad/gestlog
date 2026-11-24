import { describe, expect, it } from "vitest";
import { brandOfCatalog, buildTrendRows, categoryEvolution, trendTotals, verdictOf, type TrendLine } from "./trends";

const line = (o: Partial<TrendLine>): TrendLine => ({
  side: "pre",
  paired: true,
  brand: "MCS",
  category: "Pull",
  subCategory: "Pull col rond",
  reference: "AH26PULL_W001",
  label: "Pull 1/2 zip",
  color: "Marine",
  qty: 0,
  amount: 0,
  ...o,
});

describe("brandOfCatalog", () => {
  it("TDH = Territoire d'homme, le reste = MCS", () => {
    expect(brandOfCatalog("Territoire d'homme W26")).toBe("TDH");
    expect(brandOfCatalog("MCS Homme W26")).toBe("MCS");
    expect(brandOfCatalog(null)).toBe("MCS");
  });
});

describe("buildTrendRows", () => {
  const lines = [
    line({ qty: 100, amount: 3000 }),
    line({ qty: 20, amount: 600, paired: false }),
    line({ side: "final", qty: 90, amount: 2700 }),
    line({ category: "Chemise", reference: "AH26CHEM_S001", label: "Chemise", qty: 50, amount: 2000 }),
    line({ category: "Chemise", reference: "AH26CHEM_S001", label: "Chemise", side: "final", qty: 50, amount: 2000 }),
  ];
  it("compare précommande et finale, et isole les commandes perdues en entier", () => {
    const rows = buildTrendRows(lines, "category", true);
    const pull = rows.find((r) => r.category === "Pull")!;
    expect(pull).toMatchObject({ preQty: 120, finalQty: 90, lostQty: 30, lossRate: 25, lostOrdersQty: 20, lostAmount: 900 });
    expect(rows[0].category).toBe("Pull"); // trié par pièces perdues
    expect(trendTotals(rows)).toMatchObject({ preQty: 170, finalQty: 140, lossRate: 17.6 });
  });
  it("sans commande finale : pas de perte calculée", () => {
    const rows = buildTrendRows(lines.filter((l) => l.side === "pre"), "product", false);
    expect(rows.every((r) => r.lostQty === 0 && r.lossRate === 0)).toBe(true);
  });
  it("sépare MCS et TDH", () => {
    const rows = buildTrendRows([line({ qty: 10 }), line({ brand: "TDH", qty: 5 })], "category", false);
    expect(rows).toHaveLength(2);
  });
});

describe("verdictOf", () => {
  it("±5 points autour de la moyenne, rien sous 50 pièces", () => {
    expect(verdictOf(5, 12, 100)).toBe("tient");
    expect(verdictOf(20, 12, 100)).toBe("perd");
    expect(verdictOf(13, 12, 100)).toBe("moyenne");
    expect(verdictOf(40, 12, 10)).toBeNull();
  });
});

describe("categoryEvolution", () => {
  it("part de la catégorie par saison et tendance", () => {
    const { seasons, rows } = categoryEvolution(
      [
        { season: "AH24", seasonYear: 2024, seasonType: "AH", brand: "MCS", category: "Pull", qty: 30, amount: 0 },
        { season: "AH24", seasonYear: 2024, seasonType: "AH", brand: "MCS", category: "Chemise", qty: 70, amount: 0 },
        { season: "AH25", seasonYear: 2025, seasonType: "AH", brand: "MCS", category: "Pull", qty: 50, amount: 0 },
        { season: "AH25", seasonYear: 2025, seasonType: "AH", brand: "MCS", category: "Chemise", qty: 50, amount: 0 },
        { season: "PE25", seasonYear: 2025, seasonType: "PE", brand: "MCS", category: "Pull", qty: 1, amount: 0 },
      ],
      "AH"
    );
    expect(seasons).toEqual(["AH24", "AH25"]);
    const pull = rows.find((r) => r.category === "Pull")!;
    expect(pull.bySeason.AH24.share).toBe(30);
    expect(pull.trend).toBe("hausse");
    expect(rows.find((r) => r.category === "Chemise")!.trend).toBe("baisse");
  });
});
