import { describe, it, expect } from "vitest";
import { distributeOrderAmount, type AmountLine } from "./order-amount";

const l = (id: string, quantity: number, unitPrice: number): AmountLine => ({ id, quantity, unitPrice });
const somme = (m: Map<string, number>) => Math.round([...m.values()].reduce((a, b) => a + b, 0) * 100) / 100;

describe("répartition du CA d'une commande", () => {
  it("répartit au prorata de prix × quantité", () => {
    // 10 × 40 € = 400 et 10 × 10 € = 100 → 80 % / 20 % de 1 000 €.
    const { amounts, basis } = distributeOrderAmount([l("a", 10, 40), l("b", 10, 10)], 1000);
    expect(basis).toBe("prix");
    expect(amounts.get("a")).toBe(800);
    expect(amounts.get("b")).toBe(200);
  });

  // 🔴 La propriété qui compte : sans elle, la somme des lignes ne retombe pas sur le
  // total de la commande et l'incohérence se déplace au lieu de disparaître.
  it("la somme vaut EXACTEMENT le total, malgré les arrondis", () => {
    const lignes = [l("a", 3, 33.33), l("b", 7, 19.99), l("c", 1, 7.77)];
    for (const total of [1000, 1234.56, 0.03, 99999.99, 7]) {
      expect(somme(distributeOrderAmount(lignes, total).amounts)).toBe(total);
    }
  });

  it("attribue le reste d'arrondi à la plus grosse ligne", () => {
    // 3 lignes égales, 1,00 € à répartir : 33 + 33 + 33 = 99 centimes, reste 1.
    const { amounts } = distributeOrderAmount([l("a", 1, 10), l("b", 1, 10), l("c", 1, 10)], 1);
    expect(somme(amounts)).toBe(1);
    expect([...amounts.values()].filter((v) => v === 0.34)).toHaveLength(1);
  });

  it("retombe sur la quantité quand aucun prix n'est connu", () => {
    const { amounts, basis } = distributeOrderAmount([l("a", 30, 0), l("b", 10, 0)], 400);
    expect(basis).toBe("quantité");
    expect(amounts.get("a")).toBe(300);
    expect(amounts.get("b")).toBe(100);
  });

  it("ignore les lignes sans quantité", () => {
    const { amounts } = distributeOrderAmount([l("a", 10, 40), l("b", 0, 40)], 500);
    expect(amounts.get("a")).toBe(500);
    expect(amounts.has("b")).toBe(false);
  });

  it("ne répartit rien sans total", () => {
    for (const t of [0, -5, NaN]) {
      const r = distributeOrderAmount([l("a", 10, 40)], t);
      expect(r.amounts.size).toBe(0);
      expect(r.basis).toBe("aucune");
    }
  });

  it("ne répartit rien sur une commande sans ligne utile", () => {
    expect(distributeOrderAmount([], 1000).basis).toBe("aucune");
    expect(distributeOrderAmount([l("a", 0, 40)], 1000).basis).toBe("aucune");
  });

  it("un prix partiellement connu suffit à peser par les prix", () => {
    // 'b' sans prix reçoit 0 : il ne pèse pas. Discutable, mais explicite — et fidèle au
    // fait que le catalogue ne lui connaît aucune valeur.
    const { amounts, basis } = distributeOrderAmount([l("a", 10, 40), l("b", 10, 0)], 500);
    expect(basis).toBe("prix");
    expect(amounts.get("a")).toBe(500);
    expect(amounts.get("b")).toBe(0);
  });

  it("supporte une commande réelle de 200 lignes sans dérive", () => {
    const lignes = Array.from({ length: 200 }, (_, i) => l(`p${i}`, (i % 7) + 1, 12.34 + i * 0.11));
    expect(somme(distributeOrderAmount(lignes, 48631.27).amounts)).toBe(48631.27);
  });
});
