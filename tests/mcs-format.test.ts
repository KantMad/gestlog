import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectMcsFormat,
  parseMcsStatgen,
  parseMcsPackingList,
  parseTexasClientOrders,
  pickReceptionSizes,
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
      season: "W26", // code saison lu dans la colonne « Saison » (pour l'export réceptions)
      reference: "RMGILE_W001",
      colorCode: "206",
      quantities: [5, 10, 15],
    });
    expect(lines[1]).toMatchObject({ orderNumber: "100718", supplierCode: "WENLOS", season: "W26" });
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

describe("parseTexasClientOrders — « Référence commande client » = n° de commande TIO", () => {
  // Les n° de commande Texas et TIO sont DISJOINTS (vérifié : 0 recoupement sur 282
  // commandes AH26). Le seul lien est cette colonne : PO-… pour une commande de catalogue,
  // IS-… pour un réassort. C'est elle qui permet de retrouver le catalogue de vente TIO.
  const grid = [
    ["Saison", "Fiche produit fini", "Coloris produit fini", "N° commande client", "Code client(Commande client)", "Référence commande client(Commande client)", "Total Q", "Q. 1", "Q. 2", "Clé Langue+Gamme(Produit fini)", "Taille début(Produit fini)", "Taille fin(Produit fini)", "Montant commandé net total(Commande client)", "Soldé(Commande client)"],
    ["", "", "", "", "", "", "MAI", "S", "M", "", "", "", "", ""], // légende gamme MAI
    ["W26", "CCAH26_JE12", "000-Bleu", "110891", "RIVED02701", "PO-643911056017", 7, 3, 4, "FRAMAI", 1, 2, 210, "N"],
    ["TDH", "THRPULL_906", "711-Canard", "110433", "GENT 07801", "IS-842577046121", 5, 2, 3, "FRAMAI", 1, 2, 150, "N"],
  ];

  it("lit la référence TIO sans la confondre avec le n° de commande Texas", () => {
    const lines = parseTexasClientOrders(buf(grid));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ orderNumber: "110891", tioOrderNumber: "PO-643911056017" });
    // Un réassort porte une référence IS-… : elle est lue telle quelle (aucune jumelle TIO
    // ne sera trouvée à l'import → commande sans catalogue, ce qui est correct).
    expect(lines[1]).toMatchObject({ orderNumber: "110433", tioOrderNumber: "IS-842577046121" });
  });

  it("tolère l'absence de la colonne référence (tioOrderNumber vide)", () => {
    const sansRef = grid.map((r) => [...r.slice(0, 5), ...r.slice(6)]);
    const lines = parseTexasClientOrders(buf(sansRef));
    expect(lines[0].tioOrderNumber).toBe("");
    expect(lines[0].orderNumber).toBe("110891"); // le n° Texas reste correctement lu
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

describe("parseMcsPackingList — disposition LONGUE (une ligne par taille, colonnes « Taille » + « Quantité »)", () => {
  // Cas réel « FW26 TDH ARETEX PL GESTLOG.xlsx » : la taille et la quantité sont des
  // VALEURS et non des colonnes, donc aucune colonne de taille à détecter.
  const grid = [
    ["FW26 TDH ARETEX PL"], // titre
    ["N° COMMANDE FOURNISSEUR", "", "100718"],
    [],
    [],
    ["REFERENCE", "COULEUR", "Concat", "Article/Réf.", "Coloris", "Taille", "Quantité"],
    ["THRPULL_906", "711", "THRPULL_906-711", "Pull", "711 BLEU CANARD", "S", 3],
    ["THRPULL_906", "711", "THRPULL_906-711", "Pull", "711 BLEU CANARD", "M", 9],
    ["THRPULL_906", "711", "THRPULL_906-711", "Pull", "711 BLEU CANARD", "M", 1], // 2e colis → sommé
    ["THRPULL_906", "999", "THRPULL_906-999", "Pull", "999 NOIR", "L", 17],
    ["THRPULL_906", "999", "THRPULL_906-999", "Pull", "999 NOIR", "XL", 0], // qté 0 → ignorée
    ["TOTAL", "", "", "", "", "", 30],
  ];

  it("détecte packing-list et somme les quantités par (réf, couleur, taille)", () => {
    expect(detectMcsFormat(buf(grid))).toBe("packing-list");
    const lines = parseMcsPackingList(buf(grid));
    expect(lines).toHaveLength(2);
    const c711 = lines.find((l) => l.colorCode === "711")!;
    expect(c711.reference).toBe("THRPULL_906");
    expect(c711.sizes).toEqual({ S: 3, M: 10 });
    const c999 = lines.find((l) => l.colorCode === "999")!;
    expect(c999.sizes).toEqual({ L: 17 }); // le XL à 0 n'est pas retenu
  });
});

describe("parseMcsPackingList — tailles portées par l'en-tête lui-même (template CITIME, une seule colonne)", () => {
  // Cas réel « FW26 TDH CITIME PL.xlsx » : en-tête ancien format (FULL MCS PRODUCT REF)
  // MAIS la taille (« TU ») est dans l'en-tête, pas sur la ligne au-dessus (qui est vide).
  const grid = [
    ["FW26 TDH CITIME PACKING LIST"],
    ["Order nr", "", 100762],
    [],
    ["", "", "FULL MCS PRODUCT REF", "COLOR\r\nCODE", "DESCR COLOR", "TU", "TOTAL", "Box number"],
    ["", "", "THRBOUT_901", "009", "NACRE", 8, 8, 1],
    ["", "", "THRCRAV_901", 405, "ROUGE BORDEAUX", 6, 6, 2],
    ["", "", "TOTAL", "", "", "", 14, ""],
  ];

  it("lit les tailles de l'en-tête quand la ligne au-dessus n'en porte pas", () => {
    expect(detectMcsFormat(buf(grid))).toBe("packing-list");
    const lines = parseMcsPackingList(buf(grid));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ reference: "THRBOUT_901", colorCode: "009", colorName: "NACRE" });
    expect(lines[0].sizes).toEqual({ TU: 8 }); // la colonne « TOTAL » n'est pas une taille
    expect(lines[1].sizes).toEqual({ TU: 6 });
  });
});

describe("parseMcsPackingList — deux lignes de libellés de tailles (template RASEN : lettres + numériques)", () => {
  // Cas réel « FW26 COUNTRY RASEN PL » : les MÊMES colonnes sont libellées en lettres
  // (ligne au-dessus) ET en numérique (en-tête). La colonne 5 vaut « L » ou « 31 » selon
  // que le produit est une maille ou un jean → le fichier seul ne peut pas trancher.
  const grid = [
    ["W26 COUNTRY RASEN PACKING LIST"],
    ["", "", "", "", "", "TU", "XS", "S", "M", "L", "", ""], // lettres (s'arrêtent à la col 9)
    ["Box number", "Client", "FULL MCS PRODUCT REF", "COLOR\r\nCODE", "DESCR COLOR", 27, 28, 29, 30, 31, 32, "Qty"],
    [1, "", "CCAH26_JE12", "000", "BLEU JEAN", "", "", 5, 9, 12, "", 26],
    [2, "", "CCAH26_JE12", "000", "BLEU JEAN", "", "", "", "", "", 15, 15], // col 10 : hors lettres
    ["", "", "TOTAL", "", "", "", "", "", "", "", "", 41],
  ];

  it("retient la lecture qui capte toutes les pièces et remonte l'autre en alternative", () => {
    const lines = parseMcsPackingList(buf(grid));
    expect(lines).toHaveLength(1);
    // Les lettres ne couvrent pas la colonne « 32 » → 15 pièces perdues → numérique gagne.
    expect(lines[0].sizes).toEqual({ "29": 5, "30": 9, "31": 12, "32": 15 });
    expect(lines[0].sizesAlt).toEqual({ S: 5, M: 9, L: 12 });
  });

  it("pickReceptionSizes tranche avec la grille du produit", () => {
    const line = parseMcsPackingList(buf(grid))[0];
    // Jean → grille numérique : on garde la lecture principale.
    expect(pickReceptionSizes(line, "27,28,29,30,31,32,33")).toBe(line.sizes);
    // Maille → grille en lettres : on bascule sur l'alternative.
    expect(pickReceptionSizes(line, "XS,S,M,L,XL")).toBe(line.sizesAlt);
    // Pas de grille exploitable → lecture principale.
    expect(pickReceptionSizes(line, "")).toBe(line.sizes);
    expect(pickReceptionSizes(line, null)).toBe(line.sizes);
  });

  it("ne renvoie pas d'alternative quand le fichier n'est pas ambigu", () => {
    const simple = [
      ["REFERENCE", "COLOR", "S", "M"],
      ["CCAH26-CH07", "752", 1, 2],
    ];
    expect(parseMcsPackingList(buf(simple))[0].sizesAlt).toBeUndefined();
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
