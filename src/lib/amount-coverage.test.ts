import { describe, it, expect } from "vitest";
import {
  amountCoverage,
  coverageFromTotals,
  comparablePrices,
  SEUIL_FIABLE,
  SEUIL_INEXPLOITABLE,
  type CoverageInput,
} from "./amount-coverage";

const l = (amount: number, quantity: number): CoverageInput => ({ amount, quantity });

describe("couverture du CA — mesure", () => {
  it("compte la couverture en PIÈCES, pas en lignes", () => {
    // 1 ligne valorisée de 1 pièce, 1 ligne à zéro de 99 pièces :
    // 50 % des lignes, mais 1 % des pièces.
    const c = amountCoverage([l(40, 1), l(0, 99)]);
    expect(c.linesWithAmount).toBe(1);
    expect(c.percent).toBe(1);
  });

  it("le prix moyen ne porte que sur les pièces valorisées", () => {
    const c = amountCoverage([l(400, 10), l(0, 90)]);
    // 400 € / 10 pièces = 40 €, et non 400/100 = 4 €.
    expect(c.pricePerPiece).toBe(40);
  });

  it("additionne le CA réellement présent", () => {
    const c = amountCoverage([l(100, 2), l(50, 1), l(0, 5)]);
    expect(c.amount).toBe(150);
    expect(c.pieces).toBe(8);
    expect(c.piecesWithoutAmount).toBe(5);
  });

  it("ne divise pas par zéro sur un ensemble vide", () => {
    const c = amountCoverage([]);
    expect(c.percent).toBe(0);
    expect(c.pricePerPiece).toBe(0);
    expect(c.verdict).toBe("fiable"); // rien à signaler : il n'y a rien
  });

  it("tolère des valeurs non numériques venues de la base", () => {
    const c = amountCoverage([
      { amount: NaN, quantity: 5 },
      { amount: 40, quantity: NaN as unknown as number },
    ]);
    expect(Number.isFinite(c.percent)).toBe(true);
    expect(Number.isFinite(c.pricePerPiece)).toBe(true);
  });
});

describe("couverture du CA — verdict", () => {
  const avec = (pct: number) => amountCoverage([l(40, pct), l(0, 100 - pct)]);

  it("fiable au-dessus du seuil", () => {
    expect(avec(SEUIL_FIABLE).verdict).toBe("fiable");
    expect(avec(100).verdict).toBe("fiable");
  });

  it("partiel entre les deux seuils", () => {
    expect(avec(90).verdict).toBe("partiel");
    expect(avec(SEUIL_INEXPLOITABLE).verdict).toBe("partiel");
  });

  it("inexploitable sous le seuil bas", () => {
    expect(avec(SEUIL_INEXPLOITABLE - 1).verdict).toBe("inexploitable");
    // Cas réel PE25 : 5,6 % de couverture.
    expect(avec(6).verdict).toBe("inexploitable");
  });
});

// 🔴 Le cas signalé par l'exploitant le 28/09/2026.
describe("couverture du CA — le cas MCS Homme W25 / W26", () => {
  // Chiffres réels : W25 14 115 pièces valorisées à 37,17 € et 29 861 pièces à zéro ;
  // W26 41 173 pièces toutes valorisées à 39,68 €.
  const w25 = amountCoverage([l(37.17 * 14115, 14115), l(0, 29861)]);
  const w26 = amountCoverage([l(39.68 * 41173, 41173)]);

  it("démasque le trou de couverture de W25", () => {
    expect(w25.percent).toBeCloseTo(32.1, 1);
    expect(w25.verdict).toBe("inexploitable");
    expect(w26.percent).toBe(100);
    expect(w26.verdict).toBe("fiable");
  });

  it("montre que les PRIX, eux, sont comparables", () => {
    // C'est la preuve que l'écart de CA n'est pas une hausse de prix.
    expect(w25.pricePerPiece).toBeCloseTo(37.17, 1);
    expect(w26.pricePerPiece).toBeCloseTo(39.68, 1);
    expect(comparablePrices(w25, w26).comparable).toBe(true);
  });

  it("aurait signalé le CA affiché comme incomparable", () => {
    // Ce que l'écran montrait : 524 668 € sur 43 976 pièces contre 1 633 676 € sur 41 173.
    const affiche25 = amountCoverage([l(524668, 43976)]);
    const affiche26 = amountCoverage([l(1633676, 41173)]);
    const cmp = comparablePrices(affiche25, affiche26);
    expect(cmp.comparable).toBe(false);
    expect(cmp.ecart).toBeGreaterThan(60); // 11,93 € contre 39,68 €
  });
});

describe("prix comparables", () => {
  it("accepte un écart de prix plausible", () => {
    const a = amountCoverage([l(3700, 100)]);
    const b = amountCoverage([l(4000, 100)]);
    expect(comparablePrices(a, b)).toEqual({ comparable: true, ecart: 7.5 });
  });

  it("refuse un rapport de 1 à 3", () => {
    const a = amountCoverage([l(1200, 100)]);
    const b = amountCoverage([l(4000, 100)]);
    expect(comparablePrices(a, b).comparable).toBe(false);
  });

  it("se tait quand un côté n'a aucun prix", () => {
    expect(comparablePrices(amountCoverage([l(0, 10)]), amountCoverage([l(400, 10)])))
      .toEqual({ comparable: false, ecart: 0 });
  });
});

describe("couverture du CA — depuis des totaux agrégés en SQL", () => {
  it("donne le même verdict que le calcul ligne à ligne", () => {
    const lignes = [l(400, 10), l(0, 90)];
    const parLigne = amountCoverage(lignes);
    const parTotaux = coverageFromTotals({
      lines: 2, linesWithAmount: 1, pieces: 100, piecesWithAmount: 10, amount: 400,
    });
    expect(parTotaux).toEqual(parLigne);
  });

  it("déduit les pièces sans montant plutôt que de les exiger", () => {
    const c = coverageFromTotals({
      lines: 10, linesWithAmount: 3, pieces: 500, piecesWithAmount: 120, amount: 4800,
    });
    expect(c.piecesWithoutAmount).toBe(380);
    expect(c.pricePerPiece).toBe(40);
    expect(c.verdict).toBe("inexploitable");
  });

  it("ne rend jamais un nombre de pièces négatif", () => {
    const c = coverageFromTotals({
      lines: 1, linesWithAmount: 1, pieces: 10, piecesWithAmount: 12, amount: 100,
    });
    expect(c.piecesWithoutAmount).toBe(0);
  });
});
