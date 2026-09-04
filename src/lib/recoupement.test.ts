import { describe, it, expect } from "vitest";
import {
  splitCsvLine, parseColorOrdersCsv, filterRows, buildCrossTable, crossTableToAoa,
  ROW_HEADER, parseLancementWorkbook, type ColorOrderRow,
} from "./recoupement";

const HEADER =
  "Référence produit;Nom produit;Catégorie produit;Sous-catégorie produit;" +
  "Code couleur;Nom de la couleur;Quantité à la couleur;T0;T1";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("splitCsvLine", () => {
  it("respecte les guillemets et le séparateur à l'intérieur", () => {
    expect(splitCsvLine('"a";"b;c";"d"')).toEqual(["a", "b;c", "d"]);
  });
  it("gère le guillemet doublé", () => {
    expect(splitCsvLine('"il dit ""oui""";"b"')).toEqual(['il dit "oui"', "b"]);
  });
  it("accepte les champs non quotés", () => {
    expect(splitCsvLine("a;b;c")).toEqual(["a", "b", "c"]);
  });
});

describe("parseColorOrdersCsv", () => {
  it("lit les colonnes PAR NOM, malgré le BOM", () => {
    const rows = parseColorOrdersCsv(
      "﻿" + csv('"REF1";"Chino";"Pantalons";"Chinos";"752";"Bleu marine";"10";"0";"0"')
    );
    expect(rows).toEqual([
      {
        reference: "REF1", productName: "Chino", category: "Pantalons",
        subCategory: "Chinos", colorCode: "752", colorName: "Bleu marine", quantity: 10,
      },
    ]);
  });

  it("retient la QUANTITÉ COULEUR même quand toutes les tailles sont à 0", () => {
    // Cas réel MMCHML_L009 : 79 lignes dans cet état. Sommer les tailles perdrait ces pièces.
    const rows = parseColorOrdersCsv(csv('"REF9";"Chemise";"Chemise";"";"006";"Beige";"4";"0";"0"'));
    expect(rows[0].quantity).toBe(4);
  });

  it("écarte les lignes sans référence ou à quantité nulle", () => {
    const rows = parseColorOrdersCsv(
      csv(
        '"";"x";"c";"s";"001";"Noir";"5";"0";"0"',
        '"REF1";"x";"c";"s";"001";"Noir";"0";"0";"0"'
      )
    );
    expect(rows).toEqual([]);
  });

  it("rend un tableau vide si les colonnes attendues manquent", () => {
    expect(parseColorOrdersCsv("a;b;c\n1;2;3")).toEqual([]);
    expect(parseColorOrdersCsv("")).toEqual([]);
  });
});

const rows: ColorOrderRow[] = [
  { reference: "P1", productName: "Chino", category: "Pantalons", subCategory: "Chinos", colorCode: "752", colorName: "Bleu marine", quantity: 10 },
  { reference: "P1", productName: "Chino", category: "Pantalons", subCategory: "Chinos", colorCode: "005", colorName: "Sable", quantity: 12 },
  // Même (modèle, couleur) sur une seconde commande → les quantités s'AJOUTENT.
  { reference: "P1", productName: "Chino", category: "Pantalons", subCategory: "Chinos", colorCode: "005", colorName: "Sable", quantity: 3 },
  { reference: "B1", productName: "Bermuda", category: "Bermudas", subCategory: "Chinos", colorCode: "752", colorName: "Bleu marine", quantity: 20 },
  { reference: "C1", productName: "Chemise", category: "Chemise", subCategory: "Unies", colorCode: "819", colorName: "Vert sauge", quantity: 7 },
];

describe("filterRows", () => {
  it("filtre par catégorie", () => {
    expect(filterRows(rows, { categories: ["Pantalons", "Bermudas"] })).toHaveLength(4);
  });
  it("filtre par sous-catégorie", () => {
    expect(filterRows(rows, { subCategories: ["Unies"] })).toHaveLength(1);
  });
  it("cherche dans la référence ET la désignation, sans casse", () => {
    expect(filterRows(rows, { search: "bermuda" }).map((r) => r.reference)).toEqual(["B1"]);
    expect(filterRows(rows, { search: "p1" })).toHaveLength(3);
  });
  it("sans filtre, garde tout", () => {
    expect(filterRows(rows)).toHaveLength(5);
  });
});

describe("buildCrossTable", () => {
  const t = buildCrossTable(filterRows(rows, { categories: ["Pantalons", "Bermudas"] }));

  it("additionne deux commandes du même modèle et de la même couleur", () => {
    expect(t.rows.find((r) => r.reference === "P1")!.cells["005"]).toBe(15);
  });

  it("classe couleurs et modèles par volume décroissant", () => {
    expect(t.columns.map((c) => c.code)).toEqual(["752", "005"]); // 30 puis 15
    expect(t.rows.map((r) => r.reference)).toEqual(["P1", "B1"]); // 25 puis 20
  });

  it("départage deux volumes égaux par la référence — sortie reproductible", () => {
    const egal = buildCrossTable([
      { reference: "ZZ", productName: "Z", category: "c", subCategory: "s", colorCode: "001", colorName: "Noir", quantity: 5 },
      { reference: "AA", productName: "A", category: "c", subCategory: "s", colorCode: "002", colorName: "Blanc", quantity: 5 },
    ]);
    expect(egal.rows.map((r) => r.reference)).toEqual(["AA", "ZZ"]);
    expect(egal.columns.map((c) => c.code)).toEqual(["001", "002"]);
  });

  it("compose les libellés attendus", () => {
    expect(t.columns[0].label).toBe("Bleu marine 752");
    expect(t.rows[0].label).toBe("P1 Chino");
  });

  it("les totaux se recoupent dans les deux sens", () => {
    const parLigne = t.rows.reduce((s, r) => s + r.total, 0);
    const parColonne = t.columns.reduce((s, c) => s + c.total, 0);
    expect(parLigne).toBe(t.grandTotal);
    expect(parColonne).toBe(t.grandTotal);
    expect(t.grandTotal).toBe(45);
  });

  it("n'invente aucune cellule pour une couleur non commandée", () => {
    expect(t.rows.find((r) => r.reference === "B1")!.cells["005"]).toBeUndefined();
  });
});

describe("crossTableToAoa", () => {
  const aoa = crossTableToAoa(buildCrossTable(rows), { title: "T", subtitle: "S" });

  it("reprend la disposition du modèle : titre, sous-titre, en-tête, corps, total", () => {
    expect(aoa[0]).toEqual(["T"]);
    expect(aoa[1]).toEqual(["S"]);
    expect(aoa[2][0]).toBe(ROW_HEADER);
    expect(aoa[2].at(-1)).toBe("Total Modèle");
    expect(aoa.at(-1)![0]).toBe("Total Couleurs");
  });

  it("laisse la cellule VIDE — et non 0 — quand la couleur n'est pas commandée", () => {
    const ligneC1 = aoa.find((r) => String(r[0]).startsWith("C1"))!;
    expect(ligneC1.filter((v) => v === 0)).toHaveLength(0);
    expect(ligneC1).toContain(null);
  });

  it("chaque ligne a autant de cellules que l'en-tête", () => {
    for (const r of aoa.slice(2)) expect(r).toHaveLength(aoa[2].length);
  });
});

describe("parseLancementWorkbook — classeur multi-onglets", () => {
  const HEAD = ["Étiquettes de lignes", "S", "M", "Somme de Quantity"];
  const sheets = {
    Pantalons: [
      HEAD,
      ["Pantalons", 10, 20, 60],
      ["SMPTCH_C001 Pantalon chino", 6, 12, 40],
      ["752 Bleu marine", 4, 8, 25],
      ["005 Sable", 2, 4, 15],
      ["SMPT5P_C002 Pantalon 5 poches", 4, 8, 20],
      ["005 Sable", 4, 8, 20],
    ],
    Bermudas: [
      HEAD,
      ["Bermudas", 1, 1, 5],
      ["SMSHCH_C003 Bermuda chino", 1, 1, 5],
      ["819 Vert sauge", 1, 1, 5],
    ],
  };
  const { rows, mismatches } = parseLancementWorkbook(sheets);

  it("prend le nom d'onglet comme catégorie", () => {
    expect([...new Set(rows.map((r) => r.category))]).toEqual(["Pantalons", "Bermudas"]);
  });

  it("rattache chaque coloris au produit qui le précède", () => {
    expect(rows.filter((r) => r.reference === "SMPTCH_C001").map((r) => r.colorCode))
      .toEqual(["752", "005"]);
    expect(rows.find((r) => r.reference === "SMPT5P_C002")!.colorCode).toBe("005");
  });

  it("découpe le libellé en code et nom de couleur", () => {
    expect(rows[0]).toMatchObject({
      reference: "SMPTCH_C001",
      productName: "Pantalon chino",
      colorCode: "752",
      colorName: "Bleu marine",
      quantity: 25,
    });
  });

  it("ignore la ligne de total de la catégorie", () => {
    expect(rows.reduce((s, r) => s + r.quantity, 0)).toBe(65);
  });

  it("ne renseigne PAS la sous-catégorie — ce format ne la porte pas", () => {
    expect(rows.every((r) => r.subCategory === "")).toBe(true);
  });

  it("ne signale aucun écart quand le fichier est cohérent", () => {
    expect(mismatches).toEqual([]);
  });

  it("SIGNALE un sous-total produit qui ne colle pas à ses coloris", () => {
    // Cas réel SMPT5P_C001 : la ligne produit annonce 341, ses coloris totalisent 410.
    const r = parseLancementWorkbook({
      Pantalons: [
        HEAD,
        ["Pantalons", 0, 0, 341],
        ["SMPT5P_C001 Pantalon 5 poches", 0, 0, 341],
        ["752 Bleu marine", 0, 0, 69],
        ["005 Sable", 0, 0, 192],
        ["819 Vert sauge", 0, 0, 128],
        ["210 Ecureuil", 0, 0, 21],
      ],
    });
    expect(r.mismatches).toEqual([
      {
        category: "Pantalons",
        reference: "SMPT5P_C001",
        productName: "Pantalon 5 poches",
        subtotal: 341,
        colorsTotal: 410,
      },
    ]);
    // Les lignes sont CONSERVÉES telles quelles : on signale, on ne corrige pas.
    expect(r.rows.reduce((s, x) => s + x.quantity, 0)).toBe(410);
  });

  it("ignore un onglet sans colonne de quantité", () => {
    expect(parseLancementWorkbook({ Vide: [["a", "b"], ["x", 1]] }).rows).toEqual([]);
  });

  it("alimente le même tableau croisé que le CSV", () => {
    const t = buildCrossTable(rows);
    expect(t.grandTotal).toBe(65);
    expect(t.rows.map((r) => r.reference)).toEqual([
      "SMPTCH_C001", "SMPT5P_C002", "SMSHCH_C003",
    ]);
  });
});

describe("parseLancementWorkbook — choix de la colonne de quantité", () => {
  // Le classeur porte quatre blocs : commandé, site, réa, total. Seul le TOTAL reflète
  // la commande finale. *Sur le fichier réel, lire le commandé donnait 5 601 pièces sur
  // Pantalons au lieu de 6 836.*
  const FULL = [
    "Étiquettes de lignes", "32", "Somme de Quantity",
    "site 32", "site Somme de Quantity",
    "rea 32", "rea Somme de Quantity",
    "total 32", "total Somme de Quantity",
  ];

  it("prend « total Somme de Quantity » quand il existe", () => {
    const r = parseLancementWorkbook({
      Pantalons: [
        FULL,
        ["Pantalons", 100, 100, 0, 20, 0, 30, 0, 150],
        ["SMPTCH_C001 Chino", 100, 100, 0, 20, 0, 30, 0, 150],
        ["752 Bleu marine", 100, 100, 20, 20, 30, 30, 150, 150],
      ],
    });
    expect(r.quantityColumn).toBe("total Somme de Quantity");
    expect(r.rows[0].quantity).toBe(150);
  });

  it("retombe sur le commandé quand le classeur n'a pas de bloc total", () => {
    const r = parseLancementWorkbook({
      Pantalons: [
        ["Étiquettes de lignes", "32", "Somme de Quantity"],
        ["Pantalons", 100, 100],
        ["SMPTCH_C001 Chino", 100, 100],
        ["752 Bleu marine", 100, 100],
      ],
    });
    expect(r.quantityColumn).toBe("Somme de Quantity");
    expect(r.rows[0].quantity).toBe(100);
  });

  it("contrôle la cohérence sur le COMMANDÉ, pas sur le total", () => {
    // Les lignes produit ne portent de sous-total que dans le bloc commandé : contrôler
    // sur le total ferait apparaître un écart sur CHAQUE produit.
    const r = parseLancementWorkbook({
      Pantalons: [
        FULL,
        ["Pantalons", 0, 341, 0, 0, 0, 0, 0, 0],
        ["SMPT5P_C001 Cinq poches", 0, 341, 0, null, 0, null, 0, null],
        ["752 Bleu marine", 0, 69, 0, 70, 0, 0, 0, 70],
        ["005 Sable", 0, 192, 0, 51, 0, 23, 0, 266],
        ["819 Vert sauge", 0, 128, 0, 39, 0, 18, 0, 185],
        ["210 Ecureuil", 0, 21, 0, 39, 0, 7, 0, 67],
      ],
    });
    // Un seul écart signalé, et il porte sur le commandé (341 vs 410).
    expect(r.mismatches).toEqual([
      {
        category: "Pantalons", reference: "SMPT5P_C001", productName: "Cinq poches",
        subtotal: 341, colorsTotal: 410,
      },
    ]);
    // Les quantités retenues sont bien les TOTAUX du fichier : 70 + 266 + 185 + 67.
    expect(r.rows.reduce((s, x) => s + x.quantity, 0)).toBe(588);
  });
});
