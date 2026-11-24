import { describe, expect, it } from "vitest";
import { diffCatalogSnapshot, familyCounts, parseColorIds, sumCounts, type CollectionItemRow } from "./collections";

describe("parseColorIds", () => {
  it("lit les ids séparés par retour ligne", () => {
    expect(parseColorIds("100\n81\n56")).toEqual([100, 81, 56]);
    expect(parseColorIds("103\r\n50 , 190")).toEqual([103, 50, 190]);
    expect(parseColorIds("")).toEqual([]);
    expect(parseColorIds([4, "4", 0])).toEqual([4]);
  });
});

describe("diffCatalogSnapshot", () => {
  it("1er relevé : présent = sans date d'ajout, retiré = sans date de retrait", () => {
    const a = diffCatalogSnapshot([], [{ productId: 1, colors: [10, 11], deleted: false }, { productId: 2, colors: [20], deleted: true }], "2026-11-24", true);
    expect(a).toEqual([
      { kind: "create", productId: 1, colorId: 10, reference: null, present: true, presentAtStart: true, removedBeforeTracking: false, removedDay: null },
      { kind: "create", productId: 1, colorId: 11, reference: null, present: true, presentAtStart: true, removedBeforeTracking: false, removedDay: null },
      { kind: "create", productId: 2, colorId: 20, reference: null, present: false, presentAtStart: false, removedBeforeTracking: true, removedDay: null },
    ]);
  });
  it("relevés suivants : ajout daté, retrait daté, coloris disparu, remise", () => {
    const existing = [
      { id: "a", productId: 1, colorId: 10, removedDay: null, removedBeforeTracking: false },
      { id: "b", productId: 1, colorId: 11, removedDay: null, removedBeforeTracking: false },
      { id: "c", productId: 2, colorId: 20, removedDay: null, removedBeforeTracking: true },
      { id: "d", productId: 3, colorId: 30, removedDay: null, removedBeforeTracking: false },
    ];
    const a = diffCatalogSnapshot(
      existing,
      [
        { productId: 1, sku: "W001", colors: [10, 12], deleted: false }, // 11 a disparu, 12 ajouté
        { productId: 2, colors: [20], deleted: false }, // remis
        { productId: 3, colors: [30], deleted: true }, // retiré
      ],
      "2026-11-25",
      false
    );
    expect(a).toContainEqual({ kind: "seen", id: "a", reference: "W001" });
    expect(a).toContainEqual({ kind: "create", productId: 1, colorId: 12, reference: "W001", present: true, presentAtStart: false, removedBeforeTracking: false, removedDay: null });
    expect(a).toContainEqual({ kind: "readded", id: "c", reference: null });
    expect(a).toContainEqual({ kind: "removed", id: "d" });
    expect(a).toContainEqual({ kind: "removed", id: "b" });
    expect(a).toHaveLength(5);
  });
  it("déjà retiré : rien à refaire", () => {
    const a = diffCatalogSnapshot([{ id: "d", productId: 3, colorId: 30, removedDay: "2026-11-20", removedBeforeTracking: false }], [{ productId: 3, colors: [30], deleted: true }], "2026-11-25", false);
    expect(a).toEqual([]);
  });
});

describe("familyCounts", () => {
  const row = (o: Partial<CollectionItemRow>): CollectionItemRow => ({
    tioCatalogId: 1,
    productId: 1,
    externalId: "1_10",
    reference: "W001",
    category: "Maille",
    removed: false,
    removedDay: null,
    addedDuringTracking: false,
    ...o,
  });
  it("compte une fois un coloris présent dans 2 catalogues, retiré seulement s'il l'est partout", () => {
    const items = [
      row({}),
      row({ tioCatalogId: 2 }),
      row({ externalId: "1_11", removed: true }),
      row({ externalId: "1_11", tioCatalogId: 2, removed: false }),
      row({ productId: 2, externalId: "2_20", removed: true }),
      row({ productId: 3, externalId: "3_30", category: "Chemise" }),
    ];
    const rows = familyCounts(items, new Set(["1_10", "3_30"]), new Set(["1_10"]), true);
    const maille = rows.find((r) => r.family === "Maille")!;
    expect(maille).toMatchObject({ presentedProducts: 2, presentedColors: 3, removedColors: 1, removedProducts: 1, keptColors: 2, clientColors: 1, factoryColors: 1, factoryRate: 33.3 });
    const total = sumCounts(rows, true);
    expect(total).toMatchObject({ presentedColors: 4, factoryColors: 1, factoryRate: 25 });
  });
  it("sans commande usine connue : pas de taux", () => {
    expect(familyCounts([row({})], new Set(), new Set(), false)[0].factoryRate).toBeNull();
  });
});
