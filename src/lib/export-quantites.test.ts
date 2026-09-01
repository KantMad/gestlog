import { describe, it, expect } from "vitest";
import { buildQuantitySheet, parseQuantities, type QuantityLine } from "./export-quantites";

const line = (p: Partial<QuantityLine> & { quantitiesBySize: string }): QuantityLine => ({
  reference: "REF1",
  colorCode: "001",
  colorLabel: "Noir",
  clientCode: "B1",
  clientName: "Boutique A",
  ...p,
});

describe("parseQuantities", () => {
  it("lit un JSON de tailles", () => {
    expect(parseQuantities('{"S":2,"M":3}')).toEqual({ S: 2, M: 3 });
  });
  it("ignore les tailles à 0 — une grille de zéros est illisible", () => {
    expect(parseQuantities('{"S":0,"M":3}')).toEqual({ M: 3 });
  });
  it("normalise la casse des tailles", () => {
    expect(parseQuantities('{"m":1,"M":2}')).toEqual({ M: 3 });
  });
  it("survit à un JSON absent, vide ou invalide", () => {
    expect(parseQuantities(null)).toEqual({});
    expect(parseQuantities("pas du json")).toEqual({});
    expect(parseQuantities("[1,2]")).toEqual({});
  });
});

describe("buildQuantitySheet — sans détail boutique", () => {
  const lines = [
    line({ quantitiesBySize: '{"S":2,"M":3}' }),
    line({ clientName: "Boutique B", clientCode: "B2", quantitiesBySize: '{"M":1,"L":4}' }),
    line({ reference: "REF2", colorCode: "002", colorLabel: "Rouge", quantitiesBySize: '{"S":5}' }),
  ];
  const sheet = buildQuantitySheet(lines, { withBoutique: false });

  it("met les tailles en colonnes, dans l'ordre des grilles", () => {
    expect(sheet.sizes).toEqual(["S", "M", "L"]);
    expect(sheet.header).toEqual(["Référence", "Coloris", "Libellé coloris", "S", "M", "L", "Total"]);
  });

  it("cumule plusieurs boutiques sur une même (référence, coloris)", () => {
    // REF1/001 : S=2, M=3+1=4, L=4 → total 10
    expect(sheet.rows[0]).toEqual(["REF1", "001", "Noir", 2, 4, 4, 10]);
  });

  it("laisse la cellule VIDE (et non 0) quand la taille n'est pas commandée", () => {
    expect(sheet.rows[1]).toEqual(["REF2", "002", "Rouge", 5, "", "", 5]);
  });

  it("termine par la somme par taille et la somme totale", () => {
    expect(sheet.rows.at(-1)).toEqual(["TOTAL", "", "", 7, 4, 4, 15]);
    expect(sheet.grandTotal).toBe(15);
  });

  it("la somme des totaux par coloris égale le total général", () => {
    const perColor = sheet.rows.slice(0, -1).reduce((a, r) => a + Number(r.at(-1)), 0);
    expect(perColor).toBe(sheet.grandTotal);
  });
});

describe("buildQuantitySheet — avec détail boutique", () => {
  const lines = [
    line({ quantitiesBySize: '{"S":2,"M":3}' }),
    line({ clientCode: "B2", clientName: "Boutique B", quantitiesBySize: '{"M":1}' }),
    // Deux commandes de la MÊME boutique sur la même référence : elles s'additionnent.
    line({ quantitiesBySize: '{"M":5}' }),
  ];
  const sheet = buildQuantitySheet(lines, { withBoutique: true });

  it("ajoute la colonne Boutique", () => {
    expect(sheet.header).toEqual([
      "Référence", "Coloris", "Libellé coloris", "Boutique", "S", "M", "Total",
    ]);
  });

  it("additionne deux commandes d'une même boutique", () => {
    expect(sheet.rows[0]).toEqual(["REF1", "001", "Noir", "Boutique A", 2, 8, 10]);
  });

  it("répète référence et coloris sur chaque ligne — fichier filtrable dans Excel", () => {
    expect(sheet.rows[1].slice(0, 3)).toEqual(["REF1", "001", "Noir"]);
    expect(sheet.rows[1]).toEqual(["REF1", "001", "Noir", "Boutique B", "", 1, 1]);
  });

  it("insère un sous-total par (référence, coloris)", () => {
    expect(sheet.rows[2]).toEqual(["REF1", "001", "Noir", "Total REF1 001", 2, 9, 11]);
  });

  it("le sous-total égale la somme des boutiques du groupe", () => {
    expect(Number(sheet.rows[2].at(-1))).toBe(
      Number(sheet.rows[0].at(-1)) + Number(sheet.rows[1].at(-1))
    );
  });

  it("le total général ne compte PAS deux fois les sous-totaux", () => {
    expect(sheet.rows.at(-1)).toEqual(["TOTAL", "", "", "", 2, 9, 11]);
    expect(sheet.grandTotal).toBe(11);
  });
});

describe("cas limites", () => {
  it("rend un tableau cohérent quand aucune ligne ne correspond", () => {
    const sheet = buildQuantitySheet([], { withBoutique: false });
    expect(sheet.groupCount).toBe(0);
    expect(sheet.grandTotal).toBe(0);
    expect(sheet.rows).toEqual([["TOTAL", "", "", 0]]);
  });

  it("écarte une ligne dont toutes les quantités sont nulles", () => {
    const sheet = buildQuantitySheet([line({ quantitiesBySize: '{"S":0}' })], {
      withBoutique: false,
    });
    expect(sheet.groupCount).toBe(0);
  });

  it("chaque ligne a exactement autant de cellules que l'en-tête", () => {
    const sheet = buildQuantitySheet(
      [line({ quantitiesBySize: '{"S":1}' }), line({ reference: "REF9", quantitiesBySize: '{"XL":2}' })],
      { withBoutique: true }
    );
    for (const r of sheet.rows) expect(r).toHaveLength(sheet.header.length);
  });
});
