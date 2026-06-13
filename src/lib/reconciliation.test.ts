import { describe, it, expect } from "vitest";
import { orderStatus, remaining, effectiveOrdered } from "./reconciliation";

describe("orderStatus", () => {
  it("rien livré, rien soldé → NON_LIVREE", () => {
    expect(orderStatus(10, 0, 0)).toBe("NON_LIVREE");
  });
  it("tout livré → LIVREE", () => {
    expect(orderStatus(10, 0, 10)).toBe("LIVREE");
  });
  it("livré partiel → PARTIELLE", () => {
    expect(orderStatus(10, 0, 4)).toBe("PARTIELLE");
  });
  it("livré + soldé = commandé → SOLDEE", () => {
    expect(orderStatus(10, 3, 7)).toBe("SOLDEE");
  });
  it("partiellement livré ET partiellement soldé mais reste à livrer → PARTIELLE", () => {
    // commandé 10, soldé 2 → attendu 8 ; livré 5 < 8 → partielle
    expect(orderStatus(10, 2, 5)).toBe("PARTIELLE");
  });
  it("entièrement soldé, rien livré → SOLDEE", () => {
    expect(orderStatus(10, 10, 0)).toBe("SOLDEE");
  });
  it("sur-livraison (livré > commandé) → LIVREE", () => {
    expect(orderStatus(10, 0, 12)).toBe("LIVREE");
  });
  it("rien soldé, rien livré mais commande non vide → NON_LIVREE", () => {
    expect(orderStatus(5, 0, 0)).toBe("NON_LIVREE");
  });
});

describe("remaining", () => {
  it("reste = commandé − soldé − livré", () => {
    expect(remaining(10, 2, 5)).toBe(3);
  });
  it("jamais négatif (sur-livraison)", () => {
    expect(remaining(10, 0, 15)).toBe(0);
  });
  it("tout soldé → reste 0", () => {
    expect(remaining(10, 10, 0)).toBe(0);
  });
});

describe("effectiveOrdered", () => {
  it("commandé − soldé", () => {
    expect(effectiveOrdered(10, 3)).toBe(7);
  });
  it("jamais négatif", () => {
    expect(effectiveOrdered(5, 8)).toBe(0);
  });
});
