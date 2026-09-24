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
  deliveredQty: 0,
  ...p,
});

describe("montants de répartition — le calcul", () => {
  it("valorise réparti et livré au prorata de la pièce", () => {
    // 1 000 € pour 10 pièces = 100 €/pièce.
    const r = buildMontantReport([l({ allocatedQty: 4, deliveredQty: 3 })]);
    expect(r.total.reparti).toBe(400);
    expect(r.total.livre).toBe(300);
    expect(r.total.taux).toBe(40);
    expect(r.total.tauxLivre).toBe(30);
  });

  // 🔴 Le manquant se mesure sur le LIVRÉ : une pièce répartie mais jamais expédiée
  // manque toujours à la boutique.
  it("le manquant se calcule sur le livré, pas sur le réparti", () => {
    const r = buildMontantReport([l({ allocatedQty: 10, deliveredQty: 4 })]);
    expect(r.total.reparti).toBe(1000);
    expect(r.total.manquant).toBe(600);
  });

  it("retire les soldés du manquant : une pièce soldée ne manque pas", () => {
    const r = buildMontantReport([l({ deliveredQty: 4, cancelledQty: 2 })]);
    expect(r.total.solde).toBe(200);
    expect(r.total.livre).toBe(400);
    // 1 000 − 200 soldés − 400 livrés = 400, et non 600.
    expect(r.total.manquant).toBe(400);
  });

  it("rien de livré = tout manque, même si tout est réparti", () => {
    const r = buildMontantReport([l({ allocatedQty: 10 })]);
    expect(r.total.livre).toBe(0);
    expect(r.total.manquant).toBe(1000);
    expect(r.total.tauxLivre).toBe(0);
  });

  // Cas réel AH26 : MCS Homme n'a jamais été réparti et a pourtant été livré.
  it("mesure une livraison SANS aucune répartition", () => {
    const r = buildMontantReport([l({ allocatedQty: 0, deliveredQty: 10 })]);
    expect(r.total.taux).toBe(0);
    expect(r.total.tauxLivre).toBe(100);
    expect(r.total.manquant).toBe(0);
  });

  it("une ligne sans quantité ne fait pas exploser le prix unitaire", () => {
    const r = buildMontantReport([l({ amount: 500, totalQuantity: 0, deliveredQty: 3 })]);
    expect(r.total.livre).toBe(0);
    expect(r.total.reparti).toBe(0);
    expect(Number.isFinite(r.total.manquant)).toBe(true);
    expect(r.total.manquant).toBe(500);
  });

  it("un taux ne s'invente pas sur un montant nul", () => {
    const r = buildMontantReport([l({ amount: 0, allocatedQty: 5, deliveredQty: 5 })]);
    expect(r.total.taux).toBe(0);
    expect(r.total.tauxLivre).toBe(0);
  });
});

describe("montants de répartition — les regroupements", () => {
  const LIGNES = [
    l({ clientId: "c1", clientName: "Romans", catalogId: "k1", catalogName: "Homme", amount: 1000, totalQuantity: 10, allocatedQty: 5, deliveredQty: 5 }),
    l({ clientId: "c2", clientName: "Roubaix", catalogId: "k1", catalogName: "Homme", amount: 3000, totalQuantity: 10, allocatedQty: 1, deliveredQty: 1 }),
    l({ clientId: "c1", clientName: "Romans", catalogId: "k2", catalogName: "Country", amount: 500, totalQuantity: 5, allocatedQty: 5, deliveredQty: 5 }),
    l({ clientId: "c3", clientName: "Sans cata", catalogId: null, catalogName: null, amount: 200, totalQuantity: 2, allocatedQty: 0, deliveredQty: 0 }),
  ];
  const r = buildMontantReport(LIGNES);

  it("trie par montant commandé décroissant, pas par ordre alphabétique", () => {
    expect(r.parBoutique.map((b) => b.label)).toEqual(["Roubaix", "Romans", "Sans cata"]);
    expect(r.parCatalogue.map((c) => c.label)).toEqual(["Homme", "Country", SANS_CATALOGUE]);
  });

  it("chaque regroupement retombe sur le total", () => {
    const somme = (xs: { commande: number; reparti: number; livre: number }[]) => ({
      c: xs.reduce((n, x) => n + x.commande, 0),
      r: xs.reduce((n, x) => n + x.reparti, 0),
      l: xs.reduce((n, x) => n + x.livre, 0),
    });
    const attendu = { c: r.total.commande, r: r.total.reparti, l: r.total.livre };
    expect(somme(r.parBoutique)).toEqual(attendu);
    expect(somme(r.parCatalogue)).toEqual(attendu);
    expect(r.total.commande).toBe(4700);
  });

  it("cumule les deux commandes d'une même boutique", () => {
    const romans = r.parBoutique.find((b) => b.label === "Romans")!;
    expect(romans.commande).toBe(1500);
    expect(romans.reparti).toBe(1000); // 5×100 + 5×100
    expect(romans.livre).toBe(1000);
    expect(romans.taux).toBe(66.7);
    expect(romans.tauxLivre).toBe(66.7);
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
    expect(r.surLivraison).toBe(0);
  });

  it("signale une LIVRAISON supérieure au commandé net", () => {
    const r = buildMontantReport([l({ totalQuantity: 10, cancelledQty: 2, deliveredQty: 9 })]);
    expect(r.surLivraison).toBe(1);
    // Non corrigé : le manquant devient négatif et se voit.
    expect(r.total.manquant).toBeLessThan(0);
  });

  it("ne crie pas quand la livraison est complète au dernier près", () => {
    const r = buildMontantReport([l({ totalQuantity: 10, cancelledQty: 2, deliveredQty: 8 })]);
    expect(r.surLivraison).toBe(0);
    expect(r.total.manquant).toBe(0);
  });
});
