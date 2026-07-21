import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectMcsFormat, parseMcsPackingList } from "./mcs-format";

// Construit un classeur xlsx en mémoire à partir d'une matrice (une ligne = un tableau).
function bufferFromRows(rows: (string | number | null)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "WK");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("réception — template IMDER (en-tête « REFERENCE produit fini », tailles en colonnes)", () => {
  // Reproduit « FW26 COUNTRY IMDER PL GESTLOG.xlsx » : titre + ligne COMMANDE FOURNISSEUR
  // au-dessus, puis l'en-tête RÉEL en ligne 2 (celui qui porte les tailles S,M,L,…).
  const rows: (string | number | null)[][] = [
    ["W26 COUNTRY IMDER PACKING LIST", null, null, null, null, null, null, null, null, null, null],
    ["COMMANDE FOURNISSEUR", 100770, null, null, null, null, null, null, null, null, null],
    ["REFERENCE produit fini", "COLOR CODE", "Coloris produit fini", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "Total quantités"],
    ["CCAH25_CT02", 999, "NOIR", null, 2, 2, 2, 2, 2, 2, 12],
    ["CCAH25_CT02", 999, "NOIR", null, null, 3, 6, 3, null, null, 12], // même réf+couleur → sommé
    ["CCAH25_CT01", 213, "CHOCALAT", 1, 2, 1, 3, 2, 1, 2, 12],
  ];
  const buffer = bufferFromRows(rows);

  it("détecte le format packing-list malgré l'en-tête enfoui et le libellé français", () => {
    expect(detectMcsFormat(buffer)).toBe("packing-list");
  });

  it("lit la bonne ligne d'en-tête (tailles en colonnes) et somme les colis", () => {
    const lines = parseMcsPackingList(buffer);
    const ct02 = lines.find((l) => l.reference === "CCAH25_CT02" && l.colorCode === "999");
    const ct01 = lines.find((l) => l.reference === "CCAH25_CT01" && l.colorCode === "213");

    expect(ct02).toBeDefined();
    // row3 (M2,L2,XL2,2XL2,3XL2,4XL2) + row4 (L3,XL6,2XL3)
    expect(ct02!.sizes).toEqual({ M: 2, L: 5, XL: 8, "2XL": 5, "3XL": 2, "4XL": 2 });
    expect(ct02!.colorName).toBe("NOIR");

    expect(ct01).toBeDefined();
    expect(ct01!.sizes).toEqual({ S: 1, M: 2, L: 1, XL: 3, "2XL": 2, "3XL": 1, "4XL": 2 });

    // La colonne « Total quantités » ne doit JAMAIS être lue comme une taille.
    expect(Object.keys(ct01!.sizes)).not.toContain("TOTALQUANTITÉS");
  });
});
