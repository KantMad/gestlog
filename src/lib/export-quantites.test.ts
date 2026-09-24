import { describe, it, expect } from "vitest";
import { buildQuantitySheet, parseQuantities, type QuantityLine } from "./export-quantites";

const line = (p: Partial<QuantityLine> & { quantitiesBySize: string }): QuantityLine => ({
  reference: "REF1",
  label: "Pull col rond",
  category: "Maille",
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
    expect(sheet.header).toEqual([
      "Référence", "Libellé 1", "Catégorie", "Coloris", "Libellé coloris",
      "S", "M", "L", "Total",
    ]);
  });

  it("cumule plusieurs boutiques sur une même (référence, coloris)", () => {
    // REF1/001 : S=2, M=3+1=4, L=4 → total 10
    expect(sheet.rows[0]).toEqual(["REF1", "Pull col rond", "Maille", "001", "Noir", 2, 4, 4, 10]);
  });

  it("laisse la cellule VIDE (et non 0) quand la taille n'est pas commandée", () => {
    expect(sheet.rows[1]).toEqual(["REF2", "Pull col rond", "Maille", "002", "Rouge", 5, "", "", 5]);
  });

  it("termine par la somme par taille et la somme totale", () => {
    expect(sheet.rows.at(-1)).toEqual(["TOTAL", "", "", "", "", 7, 4, 4, 15]);
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
      "Référence", "Libellé 1", "Catégorie", "Coloris", "Libellé coloris",
      "Boutique", "S", "M", "Total",
    ]);
  });

  it("additionne deux commandes d'une même boutique", () => {
    expect(sheet.rows[0]).toEqual([
      "REF1", "Pull col rond", "Maille", "001", "Noir", "Boutique A", 2, 8, 10,
    ]);
  });

  it("répète référence et coloris sur chaque ligne — fichier filtrable dans Excel", () => {
    expect(sheet.rows[1].slice(0, 5)).toEqual([
      "REF1", "Pull col rond", "Maille", "001", "Noir",
    ]);
    expect(sheet.rows[1]).toEqual([
      "REF1", "Pull col rond", "Maille", "001", "Noir", "Boutique B", "", 1, 1,
    ]);
  });

  it("insère un sous-total par (référence, coloris)", () => {
    expect(sheet.rows[2]).toEqual([
      "REF1", "Pull col rond", "Maille", "001", "Noir", "Total REF1 001", 2, 9, 11,
    ]);
  });

  it("le sous-total égale la somme des boutiques du groupe", () => {
    expect(Number(sheet.rows[2].at(-1))).toBe(
      Number(sheet.rows[0].at(-1)) + Number(sheet.rows[1].at(-1))
    );
  });

  it("le total général ne compte PAS deux fois les sous-totaux", () => {
    expect(sheet.rows.at(-1)).toEqual(["TOTAL", "", "", "", "", "", 2, 9, 11]);
    expect(sheet.grandTotal).toBe(11);
  });
});

describe("cas limites", () => {
  it("rend un tableau cohérent quand aucune ligne ne correspond", () => {
    const sheet = buildQuantitySheet([], { withBoutique: false });
    expect(sheet.groupCount).toBe(0);
    expect(sheet.grandTotal).toBe(0);
    expect(sheet.rows).toEqual([["TOTAL", "", "", "", "", 0]]);
  });

  it("écarte une ligne dont toutes les quantités sont nulles", () => {
    const sheet = buildQuantitySheet([line({ quantitiesBySize: '{"S":0}' })], {
      withBoutique: false,
    });
    expect(sheet.groupCount).toBe(0);
  });

  it("récupère libellé et catégorie même s'ils manquent sur la première ligne", () => {
    const sheet = buildQuantitySheet(
      [
        line({ label: "", category: "", quantitiesBySize: '{"S":1}' }),
        line({ label: "Pull col rond", category: "Maille", quantitiesBySize: '{"S":1}' }),
      ],
      { withBoutique: false }
    );
    expect(sheet.rows[0][1]).toBe("Pull col rond");
    expect(sheet.rows[0][2]).toBe("Maille");
  });

  it("chaque ligne a exactement autant de cellules que l'en-tête", () => {
    const sheet = buildQuantitySheet(
      [line({ quantitiesBySize: '{"S":1}' }), line({ reference: "REF9", quantitiesBySize: '{"XL":2}' })],
      { withBoutique: true }
    );
    for (const r of sheet.rows) expect(r).toHaveLength(sheet.header.length);
  });
});

// ─── Un onglet par fournisseur ───────────────────────────────────────────────
import { buildSupplierSheets, NO_SUPPLIER } from "./export-quantites";

const ligne = (
  reference: string,
  colorCode: string,
  clientCode: string,
  q: Record<string, number>,
  supplier?: string
): QuantityLine => ({
  reference,
  label: "Produit",
  category: "Cat",
  colorCode,
  colorLabel: "Coloris",
  clientCode,
  clientName: clientCode,
  quantitiesBySize: JSON.stringify(q),
  supplier,
});

describe("quantités commandées — un onglet par fournisseur", () => {
  const LIGNES = [
    ligne("SMCHML_C025", "714", "A", { S: 1, M: 3 }, "ENTEKS"),
    ligne("SMCHML_C025", "714", "B", { M: 2 }, "ENTEKS"),
    ligne("SMD201_D110", "000", "A", { "30": 4, "32": 6 }, "RASENTEKSTIL"),
    ligne("SMVEST_C001", "001", "A", { L: 5 }), // fournisseur inconnu
  ];

  it("un onglet par fournisseur, du plus gros volume au plus petit", () => {
    const wb = buildSupplierSheets(LIGNES, { withBoutique: false });
    expect(wb.sheets.map((s) => s.supplier)).toEqual([
      "RASENTEKSTIL", // 10 pièces
      "ENTEKS", // 6 pièces
      NO_SUPPLIER, // 5 pièces, mais toujours en dernier
    ]);
  });

  it("chaque onglet a SES tailles, pas une grille commune", () => {
    const wb = buildSupplierSheets(LIGNES, { withBoutique: false });
    const par = Object.fromEntries(wb.sheets.map((s) => [s.supplier, s.sheet.sizes]));
    expect(par["ENTEKS"]).toEqual(["S", "M"]);
    expect(par["RASENTEKSTIL"]).toEqual(["30", "32"]);
  });

  it("aucune pièce perdue ni doublée", () => {
    const wb = buildSupplierSheets(LIGNES, { withBoutique: false });
    expect(wb.grandTotal).toBe(21); // 4 + 2 + 10 + 5
    expect(wb.unknownPieces).toBe(5);
    expect(wb.supplierCount).toBe(2);
  });

  it("regroupe les boutiques par défaut et les déplie sur demande", () => {
    const sans = buildSupplierSheets(LIGNES, { withBoutique: false });
    const avec = buildSupplierSheets(LIGNES, { withBoutique: true });
    const enteksSans = sans.sheets.find((s) => s.supplier === "ENTEKS")!.sheet;
    const enteksAvec = avec.sheets.find((s) => s.supplier === "ENTEKS")!.sheet;
    // Sans détail : une seule ligne, toutes boutiques confondues.
    expect(enteksSans.rows.filter((r) => r[0] === "SMCHML_C025")).toHaveLength(1);
    // Avec détail : une ligne par boutique, PLUS la ligne de total du coloris.
    const avecLignes = enteksAvec.rows.filter((r) => r[0] === "SMCHML_C025");
    expect(avecLignes).toHaveLength(3);
    expect(avecLignes.map((r) => r[5])).toEqual(["A", "B", "Total SMCHML_C025 714"]);
    // Le total ne bouge pas selon la façon de le lire.
    expect(enteksSans.grandTotal).toBe(enteksAvec.grandTotal);
  });

  it("nomme les onglets sans collision", () => {
    const wb = buildSupplierSheets(
      [
        ligne("A", "1", "A", { S: 1 }, "FOURNISSEUR AU NOM INTERMINABLE NUMERO 1"),
        ligne("B", "1", "A", { S: 1 }, "FOURNISSEUR AU NOM INTERMINABLE NUMERO 2"),
      ],
      { withBoutique: false }
    );
    const noms = wb.sheets.map((s) => s.sheetName);
    expect(new Set(noms).size).toBe(2);
    noms.forEach((n) => expect(n.length).toBeLessThanOrEqual(31));
  });

  it("ne crée pas d'onglet « Sans fournisseur » quand tout est renseigné", () => {
    const wb = buildSupplierSheets(LIGNES.slice(0, 3), { withBoutique: false });
    expect(wb.sheets.map((s) => s.supplier)).not.toContain(NO_SUPPLIER);
    expect(wb.unknownPieces).toBe(0);
  });
});
