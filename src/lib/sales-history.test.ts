import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildProductGrids,
  groupSalesRows,
  modelKeyOf,
  sizeSummary,
  topSize,
  buildSalesHistoryWorkbook,
  compareSizes,
  parseExportDay,
  parseExportRows,
  parseExportWorkbook,
  parseNumber,
  parseSku,
  sizeShares,
  type RawSalesRow,
  type SalesAggRow,
} from "./sales-history";

describe("parseSku", () => {
  it("découpe RÉF-COULEUR-TAILLE", () => {
    expect(parseSku("NMPULL_W001-740-xl")).toEqual({ reference: "NMPULL_W001", colorCode: "740", size: "XL" });
  });
  it("garde une taille composée", () => {
    expect(parseSku("JMJEAN_D001-000-32-34").size).toBe("32-34");
  });
  it("sans couleur numérique : référence seule", () => {
    expect(parseSku("JMPULL_W001")).toEqual({ reference: "JMPULL_W001", colorCode: null, size: null });
    expect(parseSku("ABC-XL-M")).toEqual({ reference: "ABC", colorCode: null, size: null });
    expect(parseSku("")).toEqual({ reference: null, colorCode: null, size: null });
  });
});

describe("parseNumber / parseExportDay", () => {
  it("lit les nombres FR et EN", () => {
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1 234,50")).toBe(1234.5);
    expect(parseNumber(3)).toBe(3);
    expect(parseNumber("abc")).toBe(0);
  });
  it("lit les dates d'export", () => {
    expect(parseExportDay("2024-08-30 17:35")).toBe("2024-08-30");
    expect(parseExportDay("30/08/2024")).toBe("2024-08-30");
    expect(parseExportDay("5/1/24")).toBe("2024-01-05");
    expect(parseExportDay(new Date(2025, 0, 2, 23, 50))).toBe("2025-01-02");
    expect(parseExportDay("n/a")).toBeNull();
  });
});

const row = (o: Partial<Record<string, unknown>>) => ({
  "Numéro de commande": "1001",
  "Date de commande": "2024-03-01 10:00",
  "Nom du produit": "Pull col V en laine",
  UGS: "NMPULL_W003-752-L",
  Quantité: "1",
  "Prix du produit": "79,90",
  ...o,
});

describe("parseExportRows", () => {
  it("cumule un même UGS répété dans une commande", () => {
    const r = parseExportRows([row({}), row({ Quantité: "2" }), row({ UGS: "NMPULL_W003-752-XL" })]);
    expect(r.lines).toHaveLength(2);
    const l = r.lines.find((x) => x.size === "L")!;
    expect(l.quantity).toBe(3);
    expect(l.lineTotal).toBeCloseTo(239.7);
    expect(l.colorCode).toBe("752");
  });
  it("UGS vide : clé = nom du produit, couleur et taille inconnues", () => {
    const r = parseExportRows([row({ UGS: "" })]);
    expect(r.lines[0].lineKey).toBe("Pull col V en laine");
    expect(r.lines[0].colorCode).toBeNull();
  });
  it("ignore les lignes sans date ou sans quantité", () => {
    const r = parseExportRows([row({ "Date de commande": "" }), row({ Quantité: "0" }), row({})]);
    expect(r.lines).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });
  it("refuse une feuille qui n'est pas un export Commandes", () => {
    expect(parseExportRows([{ Cat: "Chemises", Total: 3 }]).error).toBeTruthy();
  });
  it("trouve la feuille d'export dans un classeur (après un tableau croisé)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ "Étiquettes de lignes": "x", L: 1 }]), "Feuil5");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([row({})]), "Commandes");
    const r = parseExportWorkbook(wb);
    expect(r.sheet).toBe("Commandes");
    expect(r.lines).toHaveLength(1);
  });
});

describe("compareSizes", () => {
  it("numériques, puis S → 4XL, inconnue en dernier", () => {
    expect(["XL", "?", "M", "38", "4XL", "S", "36", "2XL"].sort(compareSizes)).toEqual([
      "36", "38", "S", "M", "XL", "2XL", "4XL", "?",
    ]);
  });
});

describe("modelKeyOf", () => {
  it("code : TYPE_CODE, toutes saisons et lignes réunies", () => {
    for (const r of ["NMPULL_W001", "PMPULL_W001", "JMPULL_W001", "MFPULL_W001"]) {
      expect(modelKeyOf(r, "x", "code")).toBe("PULL_W001");
    }
    expect(modelKeyOf("NMD201_D810", "Jean", "code")).toBe("D201_D810");
  });
  it("ref : sans la lettre de saison (ligne F séparée)", () => {
    expect(modelKeyOf("NMPULL_W001", "x", "ref")).toBe("MPULL_W001");
    expect(modelKeyOf("MFPULL_W001", "x", "ref")).toBe("FPULL_W001");
  });
  it("nom, ou référence inexploitable : le nom du produit", () => {
    expect(modelKeyOf("NMPULL_W001", "Pull col V", "name")).toBe("Pull col V");
    expect(modelKeyOf(null, "Carte cadeau", "code")).toBe("Carte cadeau");
    expect(modelKeyOf("CMM1001000", "Mug", "code")).toBe("Mug");
  });
});

const raw = (o: Partial<RawSalesRow>): RawSalesRow => ({
  year: 2024, reference: "NMPULL_W001", productName: "Pull 1/2 zip col camionneur en laine",
  color: "Marine", size: "M", qty: 1, amount: 50, ...o,
});
const cat = (n: string) => (/^pull/i.test(n) ? "Pull" : /^gilet/i.test(n) ? "Gilet" : "Autres");

describe("groupSalesRows", () => {
  const rows = groupSalesRows(
    [
      raw({ qty: 5 }),
      raw({ reference: "JMPULL_W001", productName: "Pull lambswool 1/2 zip", qty: 3 }),
      raw({ reference: "NMPULL_W001", productName: "1/2 zip wool sweater", qty: 1 }),
      raw({ reference: "NMPULL_W002", productName: "Gilet laine", qty: 2 }),
    ],
    "code",
    cat
  );
  it("réunit les saisons d'un même code sous le nom le plus vendu", () => {
    const w001 = rows.filter((r) => r.model === "PULL_W001");
    expect(w001).toHaveLength(3);
    expect(new Set(w001.map((r) => r.label))).toEqual(new Set(["Pull 1/2 zip col camionneur en laine"]));
  });
  it("catégorie du modèle = la plus vendue, « Autres » (nom anglais) ne gagne pas", () => {
    expect(rows.find((r) => r.productName === "1/2 zip wool sweater")!.category).toBe("Pull");
    expect(rows.find((r) => r.model === "PULL_W002")!.category).toBe("Gilet");
  });
});

const agg = (o: Partial<SalesAggRow>): SalesAggRow => ({
  year: 2024, reference: "NMPULL_W001", productName: "Pull A", model: "PULL_W001", label: "Pull A",
  category: "Pull", color: "Marine", size: "M", qty: 1, amount: 50, ...o,
});

describe("buildProductGrids", () => {
  const rows = [
    agg({ qty: 3 }),
    agg({ size: "L", qty: 2 }),
    agg({ year: 2025, size: "L", qty: 4, reference: "PMPULL_W001", productName: "Pull A bis" }),
    agg({ color: "Beige", size: "XL", qty: 1 }),
    agg({ model: "PULL_W002", label: "Gilet B", productName: "Gilet B", qty: 20 }),
  ];
  const grids = buildProductGrids(rows);

  it("une grille par modèle, triées par volume, couleurs triées", () => {
    expect(grids.map((g) => g.model)).toEqual(["PULL_W002", "PULL_W001"]);
    expect(grids[1].colors.map((c) => c.color)).toEqual(["Marine", "Beige"]);
    expect(grids[1].references).toEqual(["NMPULL_W001", "PMPULL_W001"]);
    expect(grids[1].names).toEqual(["Pull A", "Pull A bis"]);
  });
  it("grille de tailles par couleur et par année, plus toutes couleurs", () => {
    const a = grids[1];
    expect(a.sizes).toEqual(["M", "L", "XL"]);
    expect(a.colors[0].byYear).toEqual([
      { year: 2024, sizes: { M: 3, L: 2 }, total: 5 },
      { year: 2025, sizes: { L: 4 }, total: 4 },
    ]);
    expect(a.allColors.sizes).toEqual({ M: 3, L: 6, XL: 1 });
    expect(a.byYear).toEqual({ 2024: 6, 2025: 4 });
  });
  it("statistiques de tailles : parts, taille n°1, synthèse par année", () => {
    expect(sizeShares({ M: 1, L: 2 })).toEqual({ M: 33.3, L: 66.7 });
    expect(topSize({ M: 3, L: 6, "?": 9 })).toBe("L");
    expect(topSize({ "?": 2 })).toBe("?");
    const s = sizeSummary(rows);
    expect(s.sizes).toEqual(["M", "L", "XL"]);
    expect(s.years.map((y) => [y.year, y.total, y.top])).toEqual([[2024, 26, "M"], [2025, 4, "L"]]);
    expect(s.all.shares.M).toBeCloseTo(76.7);
  });
  it("le classeur contient grilles (pièces + %) et synthèses", () => {
    const wb = buildSalesHistoryWorkbook(rows, "Test");
    expect(wb.SheetNames).toEqual(["Grilles modèle×couleur", "Tailles par année", "Par modèle", "Par couleur", "Données"]);
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Grilles modèle×couleur"], { header: 1 });
    expect(grid.some((r) => r.includes("% L"))).toBe(true);
    const t = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Tailles par année"]);
    expect(t.map((x) => x["Année"])).toEqual(["2024", "2025", "Toutes années"]);
  });
});
