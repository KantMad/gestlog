import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  parseLancementCsv,
  buildLancementSheets,
  mergeSizeOrder,
  sortSizeScale,
  safeSheetName,
  countByStatus,
  countPieces,
  keepValidatedOnly,
  NO_SIZE,
} from "./lancement-commande";
import {
  buildLancementWorkbook,
  lancementLayout,
  lancementHeader,
  colLetter,
} from "./lancement-commande-xlsx";

// Mini-export « commandes à la couleur » : mêmes libellés que l'export TIO réel.
const CSV = [
  "Référence produit;Nom produit;Catégorie produit;Code couleur;Nom de la couleur;Type de taille;Quantité à la couleur;T0;T1;T2;T3",
  // Jersey — 2 produits, le 2e plus gros pour vérifier le TRI
  '"AMPOLO_1";"Polo uni";"Jersey";"752";"Bleu marine";"HAU";"10";"1";"3";"4";"2"',
  '"AMPOLO_1";"Polo uni";"Jersey";"999";"Noir";"HAU";"6";"1";"2";"2";"1"',
  '"AMPOLO_2";"Polo rayé";"Jersey";"006";"Beige";"HAU";"30";"5";"10";"10";"5"',
  // Denim — grille numérique
  '"RMJEAN_1";"Jean brut";"Denim";"213";"Chocolat";"PAN";"8";"2";"3";"3";"0"',
  // ligne à quantité nulle → ignorée
  '"RMJEAN_1";"Jean brut";"Denim";"850";"Taupe";"PAN";"0";"0";"0";"0";"0"',
].join("\n");

const SCALES: Record<string, string[]> = {
  AMPOLO_1: ["S", "M", "L", "XL"],
  AMPOLO_2: ["S", "M", "L", "XL"],
  RMJEAN_1: ["29", "30", "31", "32"],
};

describe("lancement de commande — lecture du CSV", () => {
  const rows = parseLancementCsv(CSV);

  it("lit les lignes utiles et ignore les quantités nulles", () => {
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.reference)).toEqual(["AMPOLO_1", "AMPOLO_1", "AMPOLO_2", "RMJEAN_1"]);
  });

  it("la somme des positions correspond à la quantité déclarée", () => {
    for (const r of rows) {
      expect(r.quantities.reduce((a, b) => a + b, 0)).toBe(r.totalQty);
    }
  });

  it("rejette un fichier qui n'est pas un export commandes couleur", () => {
    expect(parseLancementCsv("a;b;c\n1;2;3")).toEqual([]);
  });
});

describe("lancement de commande — construction des onglets", () => {
  const { sheets, warnings } = buildLancementSheets(parseLancementCsv(CSV), SCALES);

  it("un onglet par catégorie, le plus gros volume en premier", () => {
    expect(sheets.map((s) => s.category)).toEqual(["Jersey", "Denim"]);
    expect(warnings).toEqual([]);
  });

  it("nomme les tailles d'après la grille du PRODUIT (T0 = 1re taille)", () => {
    expect(sheets[0].sizes).toEqual(["S", "M", "L", "XL"]);
    expect(sheets[1].sizes).toEqual(["29", "30", "31"]); // 32 jamais commandé → pas de colonne
  });

  it("trie les produits, puis les couleurs, par quantité décroissante", () => {
    const jersey = sheets[0];
    const products = jersey.lines.filter((l) => l.kind === "product");
    expect(products.map((p) => p.label)).toEqual([
      "AMPOLO_2 Polo rayé", // 30 pièces
      "AMPOLO_1 Polo uni", // 16 pièces
    ]);
    const colors = jersey.lines.filter((l) => l.kind === "color").map((c) => c.label);
    // Polo rayé (Beige) puis les couleurs du Polo uni, la plus grosse d'abord
    expect(colors).toEqual(["006 Beige", "752 Bleu marine", "999 Noir"]);
  });

  it("la ligne catégorie totalise les produits, chaque produit ses couleurs", () => {
    const jersey = sheets[0];
    const cat = jersey.lines.find((l) => l.kind === "category")!;
    expect(cat.total).toBe(46); // 30 + 10 + 6
    expect(cat.bySize).toEqual({ S: 7, M: 15, L: 16, XL: 8 });
    const uni = jersey.lines.find((l) => l.label === "AMPOLO_1 Polo uni")!;
    expect(uni.total).toBe(16);
  });

  it("signale une référence absente du référentiel sans perdre ses quantités", () => {
    const res = buildLancementSheets(parseLancementCsv(CSV), { AMPOLO_1: ["S", "M", "L", "XL"] });
    expect(res.warnings.join(" ")).toContain("introuvable");
    const total = res.sheets.reduce((s, x) => s + x.total, 0);
    expect(total).toBe(54); // aucune pièce perdue : 46 + 8
  });
});

describe("lancement de commande — ordre des tailles", () => {
  it("fusionne des grilles différentes sans doublon", () => {
    expect(mergeSizeOrder([["S", "M", "L"], ["M", "L", "XL"]])).toEqual(["S", "M", "L", "XL"]);
  });

  it("garde les tailles numériques triées", () => {
    expect(mergeSizeOrder([["30", "32", "34"], ["29", "30"]])).toEqual(["29", "30", "32", "34"]);
  });

  it("tolère une grille vide", () => {
    expect(mergeSizeOrder([[], ["TU"]])).toEqual(["TU"]);
  });

  // ⚠️ Le référentiel contient de VRAIES grilles corrompues : s'y fier produisait un
  // onglet Jersey à 42 colonnes (« S » répété 6 fois) et un « S » rangé après « XL ».
  it("répare les grilles corrompues du référentiel", () => {
    // doublons (cas réel JMPOMC_C012, 42 entrées)
    expect(sortSizeScale("S,S,S,S,M,M,M,M,L,L,L,L".split(","))).toEqual(["S", "M", "L"]);
    // ordre d'habillage faux (le S en 4e position — ordre du SizeType HAU en base)
    expect(sortSizeScale("M,L,XL,S,2XL,3XL,4XL".split(","))).toEqual([
      "S", "M", "L", "XL", "2XL", "3XL", "4XL",
    ]);
    // numériques mélangées (cas réel GMD101_D040)
    expect(sortSizeScale("42,30,31,32,33,34,36,38,40,28,44,29".split(","))).toEqual([
      "28", "29", "30", "31", "32", "33", "34", "36", "38", "40", "42", "44",
    ]);
    expect(sortSizeScale(["TU", "TU"])).toEqual(["TU"]);
    // XXL/XXXL sont des synonymes de 2XL/3XL → pas de doublon
    expect(sortSizeScale(["XXL", "2XL", "L"])).toEqual(["L", "XXL"]);
  });

  it("groupe les familles : taille unique, puis lettres, puis numériques", () => {
    expect(mergeSizeOrder([["39-42", "43-46"], ["M", "L"], ["TU"], ["S-M", "L-XL"]])).toEqual([
      "TU", "S-M", "M", "L", "L-XL", "39-42", "43-46",
    ]);
  });
});

describe("lancement de commande — classeur Excel", () => {
  it("place les blocs de colonnes comme le modèle", () => {
    // 7 tailles → A + 7 + 1 + 7 + 1 + 7 + 7 + 1 + 7 + 1 = 40 colonnes
    const L = lancementLayout(7);
    expect(L).toEqual({
      qty: 2, qtyTotal: 9, site: 10, siteTotal: 17,
      pct: 18, rea: 25, reaTotal: 32, total: 33, totalTotal: 40,
    });
    expect(lancementHeader(["S", "M"])).toEqual([
      "Étiquettes de lignes", "S", "M", "Somme de Quantity",
      "site S", "site M", "site Somme de Quantity",
      "% réa S", "% réa M",
      "rea S", "rea M", "rea Somme de Quantity",
      "total S", "total M", "total Somme de Quantity",
    ]);
  });

  it("convertit un index de colonne en lettres", () => {
    expect([1, 26, 27, 40, 60].map(colLetter)).toEqual(["A", "Z", "AA", "AN", "BH"]);
  });

  it("écrit les formules et les couleurs attendues", async () => {
    const { sheets } = buildLancementSheets(parseLancementCsv(CSV), SCALES);
    const wb = buildLancementWorkbook(ExcelJS, sheets);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);

    const ws = back.getWorksheet("Jersey")!;
    const L = lancementLayout(4); // S,M,L,XL
    const formula = (r: number, c: number) => {
      const v = ws.getCell(r, c).value;
      return typeof v === "object" && v && "formula" in v ? (v as { formula: string }).formula : null;
    };
    const argb = (r: number, c: number) =>
      (ws.getCell(r, c).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

    // r2 = catégorie, r3 = produit, r4 = 1re couleur (formules ici seulement)
    expect(ws.getCell(4, 1).value).toBe("006 Beige");
    // 4 tailles : commandé B..E, total F | site G..J, total K | % réa L..O
    //             réa P..S, total T | total U..X, total Y
    expect(formula(4, L.pct)).toBe("B4/$F4"); // % réa S = S / total commandé
    expect(formula(4, L.rea)).toBe("ROUNDUP(($F4*0.1)*L4,0.5)"); // réa = ARRONDI.SUP
    expect(formula(4, L.total)).toBe("SUM(B4+G4+P4)"); // total = commandé + site + réa
    expect(formula(4, L.reaTotal)).toBe("SUM(P4:S4)");
    expect(formula(4, L.totalTotal)).toBe("SUM(U4:X4)");

    // Les lignes de regroupement n'ont PAS de formule (le travail se fait à la couleur).
    expect(formula(3, L.pct)).toBeNull();

    // Couleurs : en-tête bleu / jaune / bleu / orange / vert
    expect(argb(1, 1)).toBe("FF4472C4");
    expect(argb(1, L.site)).toBe("FFFFFF00");
    expect(argb(1, L.pct)).toBe("FF4472C4");
    expect(argb(1, L.total)).toBe("FFFFC000");
    expect(argb(1, L.totalTotal)).toBe("FF92D050");
    // Cellules : site jaune (vide), % réa cyan, total orange
    expect(ws.getCell(4, L.site).value).toBeNull();
    expect(argb(4, L.site)).toBe("FFFFFF00");
    expect(argb(4, L.pct)).toBe("FF00B0F0");
    expect(argb(4, L.total)).toBe("FFFFC000");
    expect(ws.getCell(4, L.pct).numFmt).toBe("0%");
  }, 60000);

  it("assainit les noms d'onglets (31 car. max, sans doublon)", () => {
    const taken = new Set<string>();
    expect(safeSheetName("Pièces à manches", taken)).toBe("Pièces à manches");
    expect(safeSheetName("Pièces à manches", taken)).toBe("Pièces à manches (2)");
    expect(safeSheetName("Cat/égorie: impossible*", taken)).toBe("Cat-égorie- impossible-");
    expect(safeSheetName("A".repeat(40), taken)).toHaveLength(31);
  });
});

// ─── Pièces sans taille et statut de commande ────────────────────────────────
// Reproduit deux travers de l'export TIO réel : une ligne dont la quantité couleur est
// renseignée sans aucune taille, et des paniers encore au statut « created ».
const CSV_REEL = [
  "Numéro de commande;Statut de commande;Référence produit;Nom produit;Catégorie produit;Code couleur;Nom de la couleur;Type de taille;Quantité à la couleur;T0;T1;T2;T3",
  '"PO-1";"validated";"SMCHML_C025";"Chemise rayée";"Chemise";"714";"Bleu ciel";"HAU";"10";"1";"3";"4";"2"',
  // ⚠️ quantité couleur sans ventilation : c'est ce cas qui faisait mentir les totaux
  '"PO-2";"validated";"SMCHML_C025";"Chemise rayée";"Chemise";"714";"Bleu ciel";"HAU";"3";"0";"0";"0";"0"',
  // panier non validé
  '"PO-3";"created";"SMCHML_C025";"Chemise rayée";"Chemise";"714";"Bleu ciel";"HAU";"14";"2";"4";"5";"3"',
  // ligne entièrement vide → ignorée
  '"PO-4";"validated";"SMCHML_C025";"Chemise rayée";"Chemise";"999";"Noir";"HAU";"0";"0";"0";"0";"0"',
].join("\n");

const SCALE_CHEMISE = { SMCHML_C025: ["S", "M", "L", "XL"] };

describe("lancement de commande — pièces sans taille", () => {
  const rows = parseLancementCsv(CSV_REEL);

  it("conserve une ligne sans taille mais rejette une ligne vide", () => {
    expect(rows).toHaveLength(3);
    expect(countPieces(rows)).toBe(27); // 10 + 3 + 14
  });

  it("le total du lancement retombe sur celui du fichier", () => {
    const { sheets } = buildLancementSheets(rows, SCALE_CHEMISE);
    expect(sheets.reduce((s, x) => s + x.total, 0)).toBe(countPieces(rows));
  });

  it("place les pièces non ventilées dans une colonne dédiée, en dernier", () => {
    const { sheets, warnings } = buildLancementSheets(rows, SCALE_CHEMISE);
    expect(sheets[0].sizes).toEqual(["S", "M", "L", "XL", NO_SIZE]);
    const produit = sheets[0].lines.find((l) => l.kind === "product")!;
    expect(produit.bySize[NO_SIZE]).toBe(3);
    expect(produit.total).toBe(27);
    expect(warnings.join(" ")).toContain("sans ventilation par taille");
  });

  it("n'invente pas de colonne quand tout est ventilé", () => {
    const { sheets } = buildLancementSheets(parseLancementCsv(CSV), SCALES);
    expect(sheets.every((s) => !s.sizes.includes(NO_SIZE))).toBe(true);
  });
});

describe("lancement de commande — statut des commandes", () => {
  const rows = parseLancementCsv(CSV_REEL);

  it("compte les pièces par statut, le plus gros d'abord", () => {
    expect(countByStatus(rows)).toEqual([
      { status: "created", pieces: 14, lines: 1 },
      { status: "validated", pieces: 13, lines: 2 },
    ]);
  });

  it("ne garde que les commandes validées", () => {
    const kept = keepValidatedOnly(rows);
    expect(countPieces(kept)).toBe(13);
    const { sheets } = buildLancementSheets(kept, SCALE_CHEMISE);
    expect(sheets.reduce((s, x) => s + x.total, 0)).toBe(13);
  });

  it("laisse passer un fichier sans colonne de statut", () => {
    const sansStatut = parseLancementCsv(CSV);
    expect(keepValidatedOnly(sansStatut)).toHaveLength(sansStatut.length);
  });
});
