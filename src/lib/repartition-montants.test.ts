import { describe, it, expect } from "vitest";
import { buildMontantReport, SANS_CATALOGUE, type MontantLine } from "./repartition-montants";

const l = (p: Partial<MontantLine>): MontantLine => ({
  clientId: "c1",
  clientName: "MCS Romans",
  catalogId: "cat1",
  catalogName: "MCS Homme W26",
  amount: 1000,
  totalQuantity: 10,
  cancelledQty: 0,
  allocatedQty: 0,
  ...p,
});

describe("montants de répartition — le calcul", () => {
  it("valorise la quantité répartie au prorata de la pièce", () => {
    // 1 000 € pour 10 pièces = 100 €/pièce ; 4 réparties = 400 €.
    const r = buildMontantReport([l({ allocatedQty: 4 })]);
    expect(r.total.reparti).toBe(400);
    expect(r.total.manquant).toBe(600);
    expect(r.total.taux).toBe(40);
  });

  it("retire les soldés du manquant : une pièce soldée ne manque pas", () => {
    const r = buildMontantReport([l({ allocatedQty: 4, cancelledQty: 2 })]);
    expect(r.total.solde).toBe(200);
    expect(r.total.reparti).toBe(400);
    // 1 000 − 200 soldés − 400 répartis = 400, et non 600.
    expect(r.total.manquant).toBe(400);
  });

  it("rien de réparti = tout manque", () => {
    const r = buildMontantReport([l({})]);
    expect(r.total.reparti).toBe(0);
    expect(r.total.manquant).toBe(1000);
    expect(r.total.taux).toBe(0);
  });

  it("une ligne sans quantité ne fait pas exploser le prix unitaire", () => {
    const r = buildMontantReport([l({ amount: 500, totalQuantity: 0 })]);
    expect(r.total.reparti).toBe(0);
    expect(Number.isFinite(r.total.manquant)).toBe(true);
    expect(r.total.manquant).toBe(500);
  });

  it("un taux ne s'invente pas sur un montant nul", () => {
    expect(buildMontantReport([l({ amount: 0, allocatedQty: 5 })]).total.taux).toBe(0);
  });
});

describe("montants de répartition — les regroupements", () => {
  const LIGNES = [
    l({ clientId: "c1", clientName: "Romans", catalogId: "k1", catalogName: "Homme", amount: 1000, totalQuantity: 10, allocatedQty: 5 }),
    l({ clientId: "c2", clientName: "Roubaix", catalogId: "k1", catalogName: "Homme", amount: 3000, totalQuantity: 10, allocatedQty: 1 }),
    l({ clientId: "c1", clientName: "Romans", catalogId: "k2", catalogName: "Country", amount: 500, totalQuantity: 5, allocatedQty: 5 }),
    l({ clientId: "c3", clientName: "Sans cata", catalogId: null, catalogName: null, amount: 200, totalQuantity: 2, allocatedQty: 0 }),
  ];
  const r = buildMontantReport(LIGNES);

  it("trie par montant commandé décroissant, pas par ordre alphabétique", () => {
    expect(r.parBoutique.map((b) => b.label)).toEqual(["Roubaix", "Romans", "Sans cata"]);
    expect(r.parCatalogue.map((c) => c.label)).toEqual(["Homme", "Country", SANS_CATALOGUE]);
  });

  it("chaque regroupement retombe sur le total", () => {
    const somme = (xs: { commande: number; reparti: number }[]) => ({
      c: xs.reduce((n, x) => n + x.commande, 0),
      r: xs.reduce((n, x) => n + x.reparti, 0),
    });
    expect(somme(r.parBoutique)).toEqual({ c: r.total.commande, r: r.total.reparti });
    expect(somme(r.parCatalogue)).toEqual({ c: r.total.commande, r: r.total.reparti });
    expect(r.total.commande).toBe(4700);
  });

  it("cumule les deux commandes d'une même boutique", () => {
    const romans = r.parBoutique.find((b) => b.label === "Romans")!;
    expect(romans.commande).toBe(1500);
    expect(romans.reparti).toBe(1000); // 5×100 + 5×100
    expect(romans.taux).toBe(66.7);
  });

  it("nomme les commandes sans catalogue au lieu de les perdre", () => {
    const sans = r.parCatalogue.find((c) => c.label === SANS_CATALOGUE)!;
    expect(sans.commande).toBe(200);
  });
});

describe("montants de répartition — ce qui est signalé", () => {
  it("compte les lignes commandées sans montant", () => {
    const r = buildMontantReport([l({ amount: 0, totalQuantity: 4 }), l({})]);
    expect(r.lignesSansMontant).toBe(1);
  });

  it("signale une répartition supérieure au commandé net, sans l'écrêter", () => {
    const r = buildMontantReport([l({ totalQuantity: 10, cancelledQty: 2, allocatedQty: 9 })]);
    expect(r.surRepartition).toBe(1);
    // Non corrigé : le manquant devient négatif et se voit.
    expect(r.total.manquant).toBeLessThan(0);
  });

  it("ne crie pas quand la répartition est complète au dernier près", () => {
    const r = buildMontantReport([l({ totalQuantity: 10, cancelledQty: 2, allocatedQty: 8 })]);
    expect(r.surRepartition).toBe(0);
    expect(r.total.manquant).toBe(0);
  });
});
