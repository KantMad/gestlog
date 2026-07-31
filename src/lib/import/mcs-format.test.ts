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

describe("réception — template KESSLY (tailles GROUPÉES « S/M », « L/XL », « TU »)", () => {
  // Accessoires : les colonnes de tailles sont groupées par « / ». Sans les reconnaître, une
  // seule colonne (TU) était vue comme taille → moins de 2 → format non détecté, import KO.
  const rows: (string | number | null)[][] = [
    ["W26 COUNTRY KESSLY LOT 1 PL", null, null, null, null, null],
    ["COMMANDE FOURNISSEUR", "Référence", "CODE COULEUR", "S/M", "L/XL", "TU"],
    [100777, "CCAH26_CA01", "006-Beige", "", "", 56],
    [100777, "CCAH26_CA02", "207-Camel", "", "", 38],
    [100777, "CCAH26_CA13", "951-Gris Anthracite", 12, 12, ""],
  ];
  const buffer = bufferFromRows(rows);

  it("détecte le format malgré les tailles groupées", () => {
    expect(detectMcsFormat(buffer)).toBe("packing-list");
  });

  it("lit S/M, L/XL et TU comme des tailles distinctes", () => {
    const lines = parseMcsPackingList(buffer);
    const ca13 = lines.find((l) => l.reference === "CCAH26_CA13")!;
    expect(ca13.sizes).toEqual({ "S/M": 12, "L/XL": 12 });
    const ca01 = lines.find((l) => l.reference === "CCAH26_CA01")!;
    expect(ca01.sizes).toEqual({ TU: 56 });
    expect(ca01.colorCode).toBe("006");
    const total = lines.reduce((s, l) => s + Object.values(l.sizes).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(56 + 38 + 24);
  });
});

describe("réception — template LVIE (en-tête « REF PRODEUIT », récap par catégorie en bas)", () => {
  // En-tête maison : la colonne référence s'appelle « REF PRODEUIT » (faute de frappe),
  // couleur = « code couleur » + libellé « COLOR ». Un RÉCAPITULATIF par catégorie termine
  // le fichier, avec des « références » comme « CH 02 » / « CH 10 12 13 » (avec espaces) et
  // des nombres dans des colonnes décalées → sans garde-fou ils gonflaient le total.
  const rows: (string | number | null)[][] = [
    ["", "COUNTRY W26 LVIE PACKING LIST", null, null, null, null, null, null, null, null, null, null, null],
    ["commande fournisseur", "REF PRODEUIT ", "code couleur", "COLOR ", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "", "TOTAL"],
    [100773, "CCAH26_CH02 ", "752", "752 marine ", 1, 4, 5, 5, 4, 0, 0, "", 19],
    [100773, "CCAH26_CH02 ", "811", "811 vert kaki ", 1, 5, 5, 5, 3, 0, 0, "", 19],
    [100773, "CCAH26_CH04", "001", "001 BLANC", 1, 5, 5, 6, 3, 0, 0, "", 20],
    // ── récapitulatif par catégorie (à ignorer) : « référence » avec espace, nombres décalés ──
    ["", "CH 02  ", "", "", "", "", "=", 329, "", "", "", "", ""],
    ["", "CH 10 12 13 14 ", "", "", "", "", "=", 1109, "", "", "", "", ""],
    ["", "", "", "", "TOTAL : ", "", "", "", "", "", "", "", ""],
  ];
  const buffer = bufferFromRows(rows);

  it("détecte le format packing-list malgré l'en-tête « REF PRODEUIT »", () => {
    expect(detectMcsFormat(buffer)).toBe("packing-list");
  });

  it("ignore le récapitulatif (réf. avec espaces) et somme le détail par TAILLE", () => {
    const lines = parseMcsPackingList(buffer);
    // Seuls les vrais produits : CCAH26_CH02 (2 couleurs) + CCAH26_CH04.
    expect(lines.map((l) => l.reference).sort()).toEqual(["CCAH26_CH02", "CCAH26_CH02", "CCAH26_CH04"]);
    const total = lines.reduce((s, l) => s + Object.values(l.sizes).reduce((a, b) => a + b, 0), 0);
    // 19 + 19 + 20 (sommes de tailles), PAS les 329/1109 du récap.
    expect(total).toBe(58);
    // Aucune « référence » fantôme issue du récap.
    expect(lines.some((l) => l.reference.includes("CH 02") || /\s/.test(l.reference))).toBe(false);
  });
});

describe("réception — template CLUB JU (détail par colis + récapitulatif décalé)", () => {
  // Le fichier porte DEUX blocs : le détail (une ligne par colis, précédé de
  // « CDE FOURNISSEUR / Box number / Client ») puis un RÉCAPITULATIF dont l'en-tête est
  // décalé d'une colonne. Sans garde-fou, le récap était relu comme du détail → quantités
  // DOUBLÉES (cas réel : 3130 pièces au lieu de 1748).
  const rows: (string | number | null)[][] = [
    ["", "W26 COUNTRY CLUB JU LOT 2 PL", null, null, null, null, null, null, null, null, null],
    ["CDE FOURNISSEUR", "Box number", "Client", "FULL MCS PRODUCT REF", "", "COLOR\r\nCODE", "DESCR COLOR", "S", "M", "L", "Qty"],
    [100771, 1, "MCS", "CCAH26_SW03", "%65 COTTON", 752, "BLEU MARINE", 4, 14, null, 18],
    [100771, 2, "MCS", "CCAH26_SW03", "%65 COTTON", 752, "BLEU MARINE", null, 8, 10, 18],
    [100771, 3, "MCS", "CCAH26_SW03", "%65 COTTON", 850, "TAUPE", 1, 2, 3, 6],
    // ── récapitulatif : en-tête DÉCALÉ (la réf passe en colonne 2) ──
    [null, null, "FULL MCS PRODUCT REF", "COLOR\r\nCODE", "DESCR COLOR", "S", "M", "L", null, null, "TOTAL"],
    [null, null, "CCAH26_SW03", 752, "BLEU MARINE", 4, 22, 10, null, null, 36],
    [null, null, "CCAH26_SW03", 850, "TAUPE", 1, 2, 3, null, null, 6],
    [null, null, null, null, null, null, null, null, null, "TOTAL", 42],
  ];
  const buffer = bufferFromRows(rows);

  it("détecte le format packing-list", () => {
    expect(detectMcsFormat(buffer)).toBe("packing-list");
  });

  it("s'arrête au récapitulatif et ne double PAS les quantités", () => {
    const lines = parseMcsPackingList(buffer);
    const total = lines.reduce(
      (s, l) => s + Object.values(l.sizes).reduce((a, b) => a + b, 0),
      0
    );
    // Seul le détail est compté : 18 + 18 + 6 = 42 (et non 84).
    expect(total).toBe(42);
    expect(lines).toHaveLength(2);
    const marine = lines.find((l) => l.colorCode === "752")!;
    expect(marine.sizes).toEqual({ S: 4, M: 22, L: 10 });
    // Aucune ligne fantôme issue du récap (référence = un code couleur).
    expect(lines.map((l) => l.reference)).toEqual(["CCAH26_SW03", "CCAH26_SW03"]);
  });
});

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
