import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectMcsFormat,
  parseMcsStatgen,
  parseMcsPackingList,
} from "../src/lib/import/mcs-format";

// Construit un buffer .xlsx à partir d'une grille (tableau de lignes).
function buf(aoa: (string | number)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("detectMcsFormat / parseMcsStatgen — commande fournisseur, ancien format (« Fiche fournisseur »)", () => {
  // Ordre volontairement différent (coloris avant la référence) pour vérifier le repérage par nom.
  const grid = [
    ["Numéro de commande", "Fiche fournisseur", "Coloris produit fini", "Fiche produit fini", "Total Q", "Q. 1", "Q. 2", "Q. 3"],
    ["100717", "LIZAY", "751-Noir", "THQCHMC_901", 50, 0, 10, 25],
    ["100718", "IMDER", "006-Blanc", "EPOMC_C001", 12, 2, 5, 5],
    ["", "", "", "TOTAL", 62, 2, 15, 30], // ligne total → ignorée
  ];

  it("détecte le format statgen et lit n° de commande + fournisseur", () => {
    expect(detectMcsFormat(buf(grid))).toBe("statgen");
    const lines = parseMcsStatgen(buf(grid));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      orderNumber: "100717",
      supplierCode: "LIZAY",
      reference: "THQCHMC_901",
      colorCode: "751",
      quantities: [0, 10, 25],
    });
    expect(lines[1]).toMatchObject({ orderNumber: "100718", supplierCode: "IMDER", reference: "EPOMC_C001" });
  });
});

describe("parseMcsStatgen — nouvel export (« Code fournisseur », pas de « Fiche fournisseur »)", () => {
  // Reproduit le vrai fichier « OK » : le mot « fournisseur » apparaît dans « N° commande PF
  // fournisseur » ET « Code fournisseur » → le repérage doit prendre le CODE fournisseur.
  const grid = [
    ["N° commande PF fournisseur", "Fiche produit fini", "Coloris produit fini", "Saison", "Total Q", "Q. 1", "Q. 2", "Q. 3", "Code fournisseur(Commande PF fournisseur)"],
    ["100717", "RMGILE_W001", "206-Beige foncé", "W26", 30, 5, 10, 15, "ARETEX"],
    ["100718", "RMPULL_W002", "752-Bleu marine", "W26", 12, 2, 5, 5, "WENLOS"],
  ];

  it("détecte statgen et distingue n° de commande (col 0) du code fournisseur", () => {
    expect(detectMcsFormat(buf(grid))).toBe("statgen");
    const lines = parseMcsStatgen(buf(grid));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      orderNumber: "100717",
      supplierCode: "ARETEX",
      reference: "RMGILE_W001",
      colorCode: "206",
      quantities: [5, 10, 15],
    });
    expect(lines[1]).toMatchObject({ orderNumber: "100718", supplierCode: "WENLOS" });
  });
});

describe("parseMcsStatgen — reconstruction de grille via la légende (gamme + Taille début/fin), positions ABSOLUES", () => {
  // Légende : ligne « réf vide » où « Total Q » porte le code gamme et les Q.N portent
  // les tailles. Ici VES = [44,46,48,50] sur Q.1..Q.4.
  const grid = [
    ["N° commande PF fournisseur", "Fiche produit fini", "Coloris produit fini", "Code fournisseur", "Total Q", "Q. 1", "Q. 2", "Q. 3", "Q. 4", "Clé Langue+Gamme(Produit fini)", "Taille début(Produit fini)", "Taille fin(Produit fini)"],
    ["", "", "", "", "VES", "44", "46", "48", "50", "", "", ""], // légende gamme VES
    // Coloris à départ DÉCALÉ (deb=3) : seules Q.3,Q.4 sont remplies → tailles 48,50.
    ["100901", "THRBLAZ_902", "207-Camel", "TREZA", 10, 0, 0, 7, 3, "FRAVES", 3, 4],
    // Coloris pleine plage (deb=1..4) → 44,46,48,50.
    ["100901", "THRBLAZ_902", "700-Bleu", "TREZA", 20, 5, 6, 6, 3, "FRAVES", 1, 4],
  ];

  it("décode les Q.N par position absolue et déduit la sous-plage de tailles du coloris", () => {
    expect(detectMcsFormat(buf(grid))).toBe("statgen");
    const lines = parseMcsStatgen(buf(grid));
    expect(lines).toHaveLength(2);
    // Coloris décalé : la sous-plage démarre à la 3e taille, quantités bien alignées.
    expect(lines[0]).toMatchObject({ reference: "THRBLAZ_902", colorCode: "207", sizeScale: "48,50" });
    expect(lines[0].sizes).toEqual({ "48": 7, "50": 3 });
    // Coloris pleine plage.
    expect(lines[1]).toMatchObject({ colorCode: "700", sizeScale: "44,46,48,50" });
    expect(lines[1].sizes).toEqual({ "44": 5, "46": 6, "48": 6, "50": 3 });
  });
});

describe("parseMcsPackingList — format simple (tailles nommées), en-tête pas en ligne 0", () => {
  const grid = [
    ["FW26 COUNTRY CLUB — PACKING LIST LOT 1"], // titre au-dessus de l'en-tête
    ["REFERENCE", "COLOR", "S", "M", "L", "XL", "2XL", "Qty"],
    ["CCAH26-CH07", "752-Cognac", 1, 10, 20, 15, 5, 51],
    ["CCAH26-CH07", "752-Cognac", 2, 12, 12, 18, 11, 55], // 2e colis même réf/couleur → sommé
    ["CCAH26-PL03", "206", 3, 16, 18, 18, 8, 63],
    ["", "", "", "", "", "", "", ""],
    ["TOTAL", "", 6, 38, 50, 51, 24, 169], // ligne total → ignorée
  ];

  it("détecte packing-list et somme les tailles par (réf, couleur)", () => {
    expect(detectMcsFormat(buf(grid))).toBe("packing-list");
    const lines = parseMcsPackingList(buf(grid));
    expect(lines).toHaveLength(2);
    const ch07 = lines.find((l) => l.reference === "CCAH26_CH07")!;
    expect(ch07.colorCode).toBe("752"); // « 752-Cognac » → code seul
    expect(ch07.sizes).toEqual({ S: 3, M: 22, L: 32, XL: 33, "2XL": 16 });
    const pl03 = lines.find((l) => l.reference === "CCAH26_PL03")!;
    expect(pl03.colorCode).toBe("206");
    expect(pl03.sizes).toEqual({ S: 3, M: 16, L: 18, XL: 18, "2XL": 8 });
  });
});

describe("parseMcsPackingList — ancien format MCS (FULL MCS PRODUCT REF, tailles en lettres sur la ligne au-dessus)", () => {
  const grid = [
    ["", "", "S", "M", "L", "XL"], // tailles sur la ligne AU-DESSUS de l'en-tête
    ["FULL MCS PRODUCT REF", "COLOR CODE", "", "", "", ""],
    ["EPOMC-C001", "006", 2, 4, 6, 3],
    ["EPOMC-C001", "006", 1, 1, 0, 2],
  ];

  it("reste compatible avec l'ancien format", () => {
    expect(detectMcsFormat(buf(grid))).toBe("packing-list");
    const lines = parseMcsPackingList(buf(grid));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reference: "EPOMC_C001", colorCode: "006" });
    expect(lines[0].sizes).toEqual({ S: 3, M: 5, L: 6, XL: 5 });
  });
});
