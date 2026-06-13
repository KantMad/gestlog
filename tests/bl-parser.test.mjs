import { describe, it, expect } from "vitest";
import { parseLines } from "../scripts/bl-parser.mjs";

// Helpers : items texte positionnés { x, y, s }. y décroissant = haut → bas.
const I = (x, y, s) => ({ x, y, s: String(s) });

describe("parseLines — template PE26 standard (tailles alpha)", () => {
  it("mappe chaque quantité à sa taille et exclut le total à droite", () => {
    const items = [
      I(17, 100, "QMTSMC_C312"), // référence
      // en-tête tailles
      I(196, 80, "S"), I(218, 80, "M"), I(240, 80, "L"), I(259, 80, "XL"), I(278, 80, "2XL"),
      // ligne coloris 001 Blanc : quantités sous les tailles + total à x475
      I(17, 60, "001"), I(49, 60, "Blanc"),
      I(203, 60, "1"), I(224, 60, "2"), I(246, 60, "3"), I(268, 60, "2"), I(289, 60, "2"),
      I(475, 60, "10"),
    ];
    const lines = parseLines(items);
    expect(lines).toEqual([
      { reference: "QMTSMC_C312", colorCode: "001", colorLabel: "Blanc", size: "S", quantity: 1 },
      { reference: "QMTSMC_C312", colorCode: "001", colorLabel: "Blanc", size: "M", quantity: 2 },
      { reference: "QMTSMC_C312", colorCode: "001", colorLabel: "Blanc", size: "L", quantity: 3 },
      { reference: "QMTSMC_C312", colorCode: "001", colorLabel: "Blanc", size: "XL", quantity: 2 },
      { reference: "QMTSMC_C312", colorCode: "001", colorLabel: "Blanc", size: "2XL", quantity: 2 },
    ]);
    expect(lines.reduce((s, l) => s + l.quantity, 0)).toBe(10); // total exclu
  });
});

describe("parseLines — denim (tailles numériques + réf avec chiffres)", () => {
  it("reconnaît NMD201_D170 et la taille numérique 31", () => {
    const items = [
      I(17, 100, "OMD201_D170"),
      // tailles 28..46 (template large, x décalés)
      I(105, 80, "28"), I(128, 80, "29"), I(150, 80, "30"), I(171, 80, "31"),
      I(192, 80, "32"), I(214, 80, "33"), I(235, 80, "34"),
      I(17, 60, "740"), I(49, 60, "Bleu denim"),
      I(179, 60, "1"), // proche de 31 (x171)
      I(479, 60, "1"), // total exclu
    ];
    const lines = parseLines(items);
    expect(lines).toEqual([
      { reference: "OMD201_D170", colorCode: "740", colorLabel: "Bleu denim", size: "31", quantity: 1 },
    ]);
  });
});

describe("parseLines — article mono-coloris / taille unique (TU)", () => {
  it("sans code couleur → colorCode '000'", () => {
    const items = [
      I(17, 100, "QMCHEC_C999"),
      I(193, 80, "TU"),
      I(199, 60, "32"), // quantité, pas de code couleur à gauche
      I(475, 60, "32"), // total exclu
    ];
    const lines = parseLines(items);
    expect(lines).toEqual([
      { reference: "QMCHEC_C999", colorCode: "000", colorLabel: "", size: "TU", quantity: 32 },
    ]);
  });
});

describe("parseLines — garde-fou anti-EAN (codes 8-13 chiffres)", () => {
  it("ignore un EAN positionné près d'une colonne taille", () => {
    const items = [
      I(17, 100, "XMDENM_D001"),
      I(200, 80, "42"), I(222, 80, "44"), I(244, 80, "46"),
      I(17, 60, "001"), I(49, 60, "Noir"),
      I(202, 60, "2"), // vraie quantité (taille 42)
      I(224, 60, "124068580"), // EAN 9 chiffres près de 44 → doit être ignoré
    ];
    const lines = parseLines(items);
    expect(lines).toEqual([
      { reference: "XMDENM_D001", colorCode: "001", colorLabel: "Noir", size: "42", quantity: 2 },
    ]);
    expect(lines.every((l) => l.quantity < 10000)).toBe(true);
  });
});

describe("parseLines — dédoublonnage", () => {
  it("fusionne les lignes identiques (réf+couleur+taille)", () => {
    const items = [
      I(17, 100, "AMTSMC_C001"),
      I(196, 80, "S"),
      I(17, 60, "001"), I(49, 60, "Blanc"), I(199, 60, "2"),
      I(196, 40, "S"),
      I(17, 20, "001"), I(49, 20, "Blanc"), I(199, 20, "3"),
    ];
    const lines = parseLines(items);
    expect(lines).toEqual([
      { reference: "AMTSMC_C001", colorCode: "001", colorLabel: "Blanc", size: "S", quantity: 5 },
    ]);
  });
});
