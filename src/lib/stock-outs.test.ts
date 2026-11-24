import { describe, expect, it } from "vitest";
import { buildStockOutReport, describeVariation, estimateMissed, isOutOfStock, outDaysInRange, snapshotAction } from "./stock-outs";

describe("isOutOfStock", () => {
  it("suit le statut WooCommerce", () => {
    expect(isOutOfStock({ stock_status: "outofstock" })).toBe(true);
    expect(isOutOfStock({ stock_status: "instock", stock_quantity: 3, manage_stock: true })).toBe(false);
  });
  it("réassort autorisé = encore vendable", () => {
    expect(isOutOfStock({ stock_status: "onbackorder", stock_quantity: 0, manage_stock: true })).toBe(false);
  });
  it("stock géré à 0 = rupture même si le statut dit instock", () => {
    expect(isOutOfStock({ stock_status: "instock", stock_quantity: 0, manage_stock: true })).toBe(true);
    expect(isOutOfStock({ stock_status: "instock", stock_quantity: 0, manage_stock: false })).toBe(false);
  });
});

describe("describeVariation", () => {
  it("lit l'UGS puis les attributs", () => {
    expect(
      describeVariation({
        id: 1,
        sku: "NMPULL_W001-740-XL",
        attributes: [{ name: "Couleur", option: "Bleu marine" }, { name: "Taille", option: "XL" }],
      })
    ).toEqual({ reference: "NMPULL_W001", colorCode: "740", color: "Bleu marine", size: "XL" });
  });
  it("taille par attribut si l'UGS est incomplète", () => {
    expect(describeVariation({ id: 1, sku: "", attributes: [{ name: "pa_taille", option: "m" }] }).size).toBe("M");
  });
});

describe("snapshotAction", () => {
  it("ouvre, prolonge, ferme", () => {
    expect(snapshotAction(true, null, "2026-11-24")).toEqual({ kind: "open" });
    expect(snapshotAction(true, { id: "a", lastSeenDay: "2026-11-23" }, "2026-11-24")).toEqual({ kind: "extend", id: "a" });
    expect(snapshotAction(false, { id: "a", lastSeenDay: "2026-11-23" }, "2026-11-24")).toEqual({ kind: "close", id: "a" });
    expect(snapshotAction(false, null, "2026-11-24")).toEqual({ kind: "none" });
  });
  it("une 2e photo le même jour ne change rien", () => {
    expect(snapshotAction(true, { id: "a", lastSeenDay: "2026-11-24" }, "2026-11-24")).toEqual({ kind: "none" });
    expect(snapshotAction(false, { id: "a", lastSeenDay: "2026-11-24" }, "2026-11-24")).toEqual({ kind: "none" });
  });
});

describe("outDaysInRange", () => {
  const last = "2026-11-30";
  it("période close : de startDay (inclus) à endDay (exclu)", () => {
    expect(outDaysInRange({ startDay: "2026-11-10", lastSeenDay: "2026-11-14", endDay: "2026-11-15" }, "2026-11-01", "2026-11-30", last)).toBe(5);
  });
  it("rognée par la période demandée", () => {
    expect(outDaysInRange({ startDay: "2026-10-25", lastSeenDay: "2026-11-04", endDay: "2026-11-05" }, "2026-11-01", "2026-11-30", last)).toBe(4);
  });
  it("rupture en cours : jusqu'à la fin de la période", () => {
    expect(outDaysInRange({ startDay: "2026-11-21", lastSeenDay: "2026-11-30", endDay: null }, "2026-11-01", "2026-11-30", last)).toBe(10);
  });
  it("variation disparue : s'arrête au lendemain de la dernière observation", () => {
    expect(outDaysInRange({ startDay: "2026-11-21", lastSeenDay: "2026-11-22", endDay: null }, "2026-11-01", "2026-11-30", last)).toBe(2);
  });
  it("hors période = 0", () => {
    expect(outDaysInRange({ startDay: "2026-12-01", lastSeenDay: "2026-12-02", endDay: null }, "2026-11-01", "2026-11-30", last)).toBe(0);
  });
});

describe("estimateMissed", () => {
  it("rythme en stock × jours de rupture", () => {
    // 60 pièces sur 90 jours dont 30 en rupture → 1 pièce/jour en stock ; 10 jours de rupture → 10
    expect(estimateMissed({ soldInWindow: 60, windowDays: 90, outDaysInWindow: 30, outDaysInRange: 10 })).toEqual({ dailyRate: 1, missed: 10 });
  });
  it("jamais en stock ou jamais vendu → 0", () => {
    expect(estimateMissed({ soldInWindow: 5, windowDays: 30, outDaysInWindow: 30, outDaysInRange: 30 }).missed).toBe(0);
    expect(estimateMissed({ soldInWindow: 0, windowDays: 30, outDaysInWindow: 2, outDaysInRange: 2 }).missed).toBe(0);
  });
});

describe("buildStockOutReport", () => {
  it("cumule les ruptures d'une variation et estime le manque", () => {
    const base = { sku: "NMPULL_W001-740-M", reference: "NMPULL_W001", colorCode: "740", color: "Marine", size: "M", productName: "Pull 1/2 zip" };
    const rows = buildStockOutReport(
      [
        { ...base, variationWooId: 7, startDay: "2026-11-01", lastSeenDay: "2026-11-04", endDay: "2026-11-05" },
        { ...base, variationWooId: 7, startDay: "2026-11-21", lastSeenDay: "2026-11-30", endDay: null },
      ],
      new Map([["NMPULL_W001-740-M", { qty: 16, amount: 1600 }]]),
      { from: "2026-11-01", to: "2026-11-30", windowFrom: "2026-11-01", lastSnapshotDay: "2026-11-30" }
    );
    expect(rows).toHaveLength(1);
    // 30 jours − 14 de rupture = 16 jours en stock, 16 pièces → 1/jour × 14 jours = 14 pièces, 100 € l'une
    expect(rows[0]).toMatchObject({ periods: 2, outDays: 14, ongoing: true, since: "2026-11-21", missed: 14, missedAmount: 1400 });
  });
});
