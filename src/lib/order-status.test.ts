import { describe, it, expect } from "vitest";
import { mapOrderStatus, STATUT_DEFAUT } from "./order-status";

describe("statut de commande — traduction", () => {
  it("traduit les libellés TIO connus", () => {
    expect(mapOrderStatus("Confirmer")).toMatchObject({ status: "VALIDEE", known: true });
    expect(mapOrderStatus("Solder")).toMatchObject({ status: "SOLDEE", known: true });
    expect(mapOrderStatus("Annuler")).toMatchObject({ status: "ANNULEE", known: true });
    expect(mapOrderStatus("En cours")).toMatchObject({ status: "EN_COURS", known: true });
  });

  it("tolère la casse et les espaces de bord", () => {
    expect(mapOrderStatus("  en cours  ")).toMatchObject({ status: "EN_COURS", known: true });
    expect(mapOrderStatus("CONFIRMER")).toMatchObject({ status: "VALIDEE", known: true });
  });

  it("accepte un statut GestLog renvoyé tel quel", () => {
    expect(mapOrderStatus("VALIDEE")).toMatchObject({ status: "VALIDEE", known: true });
    expect(mapOrderStatus("soldee")).toMatchObject({ status: "SOLDEE", known: true });
  });

  // 🔴 Le cœur du correctif : ne PAS prétendre connaître.
  it("ne traduit pas une valeur absente", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(mapOrderStatus(v)).toMatchObject({ status: null, known: false });
    }
  });

  it("ne traduit pas un libellé inconnu, et le rend pour le signaler", () => {
    expect(mapOrderStatus("Expédiée partiellement")).toEqual({
      status: null,
      known: false,
      raw: "Expédiée partiellement",
    });
  });

  it("le défaut de création reste EN_COURS", () => {
    expect(STATUT_DEFAUT).toBe("EN_COURS");
  });
});
