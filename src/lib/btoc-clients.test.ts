import { describe, it, expect } from "vitest";
import { clientSheetRows, clientDisplayName, type SegmentedClient } from "./btoc-clients";

const base: SegmentedClient = {
  email: "a@b.fr", firstName: "", lastName: "", customerName: "",
  phone: "", company: "",
  billingAddress: "", billingPostcode: "", billingCity: "", billingCountry: "",
  shippingFirstName: "", shippingLastName: "", shippingAddress: "",
  shippingPostcode: "", shippingCity: "", shippingCountry: "",
  orders: 0, spent: 0, averageBasket: 0, discount: 0, promoOrders: 0,
  firstOrder: null, lastOrder: null, pieces: 0, sizes: "", isVip: false,
};

describe("clientDisplayName", () => {
  it("préfère le nom de facturation", () => {
    expect(clientDisplayName({ ...base, firstName: "Jean", lastName: "Martin", customerName: "X" }))
      .toBe("Jean Martin");
  });
  it("retombe sur le nom de la commande", () => {
    expect(clientDisplayName({ ...base, customerName: "Jean M." })).toBe("Jean M.");
  });
  it("affiche un tiret si rien n'est renseigné", () => {
    expect(clientDisplayName(base)).toBe("—");
  });
});

describe("clientSheetRows", () => {
  it("produit 26 colonnes stables, identiques pour tous les exports", () => {
    const [row] = clientSheetRows([base]);
    expect(Object.keys(row)).toHaveLength(26);
    expect(Object.keys(row)[0]).toBe("E-mail");
  });
  it("formate les dates en français et le VIP en Oui/Non", () => {
    const [row] = clientSheetRows([
      { ...base, firstOrder: "2026-03-04T10:00:00.000Z", isVip: true },
    ]);
    expect(row["Première commande"]).toBe("04/03/2026");
    expect(row["Dernière commande"]).toBe("");
    expect(row.VIP).toBe("Oui");
  });
});
