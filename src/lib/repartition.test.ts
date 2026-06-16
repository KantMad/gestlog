import { describe, it, expect } from "vitest";
import {
  normalizeSize,
  parseLegend,
  extractDataRows,
  pickGrid,
  sanitizeSheetName,
  buildRepartition,
  COL,
} from "./repartition";

// Construit une ligne aoa (45 colonnes) à partir d'un objet partiel par index.
function aoaRow(set: Record<number, unknown>): unknown[] {
  const r = new Array(45).fill("");
  for (const [i, v] of Object.entries(set)) r[Number(i)] = v;
  return r;
}

const HEADER = aoaRow({ [COL.reference]: "Code produit fini" });

describe("normalizeSize", () => {
  it("2XL → XXL, le reste inchangé (majuscule)", () => {
    expect(normalizeSize("2XL")).toBe("XXL");
    expect(normalizeSize(" m ")).toBe("M");
    expect(normalizeSize("3XL")).toBe("3XL");
  });
});

describe("parseLegend", () => {
  it("lit les grilles (code en Total Q, libellés en Q.1..Q.16) et ignore les lignes produit", () => {
    const aoa = [
      HEADER,
      aoaRow({ [COL.totalQ]: "CEI", [COL.qStart]: "S", [COL.qStart + 1]: "M", [COL.qStart + 2]: "L", [COL.qStart + 3]: "XL", [COL.qStart + 4]: "2XL" }),
      aoaRow({ [COL.totalQ]: "000", [COL.qStart]: "TU" }),
      // ligne produit → ignorée par la légende
      aoaRow({ [COL.reference]: "CCAH26_PU01", [COL.supplier]: "ARETEX", [COL.totalQ]: 17, [COL.qStart]: 1 }),
    ];
    const legend = parseLegend(aoa);
    expect(legend).toEqual({ CEI: ["S", "M", "L", "XL", "XXL"], "000": ["TU"] });
  });
});

describe("pickGrid", () => {
  const legend = { CEI: ["S", "M", "L", "XL", "XXL", "3XL", "4XL"], CHA: ["S", "M", "L", "XL"], "000": ["TU"] };
  it("choisit le plus petit sur-ensemble", () => {
    expect(pickGrid(["S", "M", "L", "XL"], legend)).toEqual(["S", "M", "L", "XL"]); // CHA, pas CEI
    expect(pickGrid(["S", "M", "2XL"], legend)).toEqual(["S", "M", "L", "XL", "XXL", "3XL", "4XL"]); // CEI (2XL→XXL)
    expect(pickGrid(["TU"], legend)).toEqual(["TU"]);
  });
  it("null si aucune grille ne couvre", () => {
    expect(pickGrid(["42"], legend)).toBeNull();
  });
});

describe("sanitizeSheetName", () => {
  it("retire les caractères interdits et tronque à 31", () => {
    expect(sanitizeSheetName("A/B:C*?")).toBe("ABC");
    expect(sanitizeSheetName("x".repeat(40)).length).toBe(31);
    expect(sanitizeSheetName("")).toBe("Inconnu");
  });
});

describe("extractDataRows", () => {
  it("ne garde que les lignes avec référence ET fournisseur", () => {
    const aoa = [
      HEADER,
      aoaRow({ [COL.totalQ]: "CEI", [COL.qStart]: "S" }), // légende
      aoaRow({ [COL.reference]: "R1", [COL.supplier]: "ARETEX", [COL.client]: "C1", [COL.ville]: "PARIS", [COL.coloris]: "752-Bleu", [COL.totalQ]: 5, [COL.qStart]: 2, [COL.qStart + 1]: 3 }),
    ];
    const rows = extractDataRows(aoa);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client: "C1", ville: "PARIS", reference: "R1", coloris: "752-Bleu", supplier: "ARETEX", totalQ: 5 });
    expect(rows[0].q.slice(0, 2)).toEqual([2, 3]);
  });
});

describe("buildRepartition", () => {
  it("un onglet par fournisseur, placement par libellé, TOTAL conservé", () => {
    const rows = [
      { client: "C1", ville: "PARIS", reference: "PU01", coloris: "752", supplier: "ARETEX", totalQ: 17, q: [1, 3, 5, 4, 3, 1, 0] },
      { client: "C1", ville: "PARIS", reference: "BO01", coloris: "006", supplier: "KESSLY", totalQ: 24, q: [24] },
    ];
    const gridByRef = { PU01: ["S", "M", "L", "XL", "XXL", "3XL", "4XL"], BO01: ["TU"] };
    const res = buildRepartition(rows, gridByRef);
    expect(res.sheets.map((s) => s.sheetName).sort()).toEqual(["ARETEX", "KESSLY"]);
    const aretex = res.sheets.find((s) => s.supplier === "ARETEX")!;
    expect(aretex.header).toEqual(["Client", "Ville", "Référence", "Coloris", "Fournisseur", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "TOTAL"]);
    expect(aretex.rows[0]).toEqual(["C1", "PARIS", "PU01", "752", "ARETEX", 1, 3, 5, 4, 3, 1, 0, 17]);
    const kessly = res.sheets.find((s) => s.supplier === "KESSLY")!;
    expect(kessly.header).toEqual(["Client", "Ville", "Référence", "Coloris", "Fournisseur", "TU", "TOTAL"]);
    expect(kessly.rows[0]).toEqual(["C1", "PARIS", "BO01", "006", "KESSLY", 24, 24]);
    expect(res.totalDropped).toBe(0);
  });

  it("grille ÉLARGIE : un fournisseur multi-familles couvre toutes les tailles, 0 perte", () => {
    // fournisseur avec des produits TU ET des produits S/M → grille élargie S/M/TU
    const rows = [
      { client: "C1", ville: "V", reference: "TU1", coloris: "a", supplier: "MIX", totalQ: 10, q: [10] },
      { client: "C1", ville: "V", reference: "TU2", coloris: "b", supplier: "MIX", totalQ: 8, q: [8] },
      { client: "C1", ville: "V", reference: "AP1", coloris: "c", supplier: "MIX", totalQ: 5, q: [2, 3] },
    ];
    const gridByRef = { TU1: ["TU"], TU2: ["TU"], AP1: ["S", "M"] };
    const res = buildRepartition(rows, gridByRef);
    const mix = res.report.find((r) => r.supplier === "MIX")!;
    expect(mix.grid).toBe("S/M/TU"); // ordre canonique (la grille la plus longue d'abord)
    expect(res.totalDropped).toBe(0); // rien n'est laissé de côté
    const sheet = res.sheets.find((s) => s.supplier === "MIX")!;
    expect(sheet.header).toEqual(["Client", "Ville", "Référence", "Coloris", "Fournisseur", "S", "M", "TU", "TOTAL"]);
    // le produit TU1 : sa pièce sous TU, 0 en S/M ; TOTAL conservé
    const tu1 = sheet.rows.find((r) => r[2] === "TU1")!;
    expect(tu1).toEqual(["C1", "V", "TU1", "a", "MIX", 0, 0, 10, 10]);
    const ap1 = sheet.rows.find((r) => r[2] === "AP1")!;
    expect(ap1).toEqual(["C1", "V", "AP1", "c", "MIX", 2, 3, 0, 5]);
  });

  it("élargit la grille apparel quand un produit dépasse (CEI + HAU → S..6XL)", () => {
    const rows = [
      { client: "C1", ville: "V", reference: "P_CEI", coloris: "x", supplier: "AP", totalQ: 6, q: [1, 2, 3] },
      { client: "C1", ville: "V", reference: "P_HAU", coloris: "y", supplier: "AP", totalQ: 4, q: [0, 0, 0, 0, 0, 0, 0, 1, 3] },
    ];
    const gridByRef = {
      P_CEI: ["S", "M", "L", "XL", "XXL", "3XL", "4XL"],
      P_HAU: ["S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"],
    };
    const res = buildRepartition(rows, gridByRef);
    const ap = res.sheets.find((s) => s.supplier === "AP")!;
    expect(ap.header).toEqual(["Client", "Ville", "Référence", "Coloris", "Fournisseur", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL", "TOTAL"]);
    expect(res.totalDropped).toBe(0);
    const hau = ap.rows.find((r) => r[2] === "P_HAU")!;
    expect(hau.slice(-3)).toEqual([1, 3, 4]); // 5XL=1, 6XL=3, TOTAL=4
  });
});
