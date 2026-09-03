import { describe, it, expect } from "vitest";
import {
  splitCsvLine, parseColorOrdersCsv, filterRows, buildCrossTable, crossTableToAoa,
  ROW_HEADER, type ColorOrderRow,
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
