import { describe, it, expect } from "vitest";
import { resolveProductSuppliers } from "./product-supplier";

describe("fournisseur d'une référence — cumul des deux sources", () => {
  it("la correspondance importée l'emporte sur la commande fournisseur", () => {
    const r = resolveProductSuppliers(
      [{ reference: "REF1", supplier: "ENTEKS" }],
      [{ reference: "REF1", supplier: "KATA" }]
    );
    expect(r.byReference.get("REF1")).toBe("ENTEKS");
    expect(r.originByReference.get("REF1")).toBe("correspondance");
    expect(r.counts).toEqual({ correspondance: 1, commande: 0 });
  });

  it("la commande fournisseur comble ce que la correspondance ignore", () => {
    const r = resolveProductSuppliers(
      [{ reference: "REF1", supplier: "ENTEKS" }],
      [{ reference: "REF2", supplier: "KATA" }]
    );
    expect(r.byReference.get("REF2")).toBe("KATA");
    expect(r.originByReference.get("REF2")).toBe("commande");
    expect(r.counts).toEqual({ correspondance: 1, commande: 1 });
  });

  it("une référence sans rien reste inconnue", () => {
    const r = resolveProductSuppliers([], []);
    expect(r.byReference.has("REF9")).toBe(false);
  });

  it("retient UN seul fournisseur en cas de conflit, et le signale", () => {
    const r = resolveProductSuppliers(
      [
        { reference: "REF1", supplier: "KATA" },
        { reference: "REF1", supplier: "ENTEKS" },
      ],
      []
    );
    // Un seul, sinon le classeur doublerait les quantités de REF1.
    expect(r.byReference.get("REF1")).toBe("ENTEKS");
    expect(r.conflicts).toEqual([{ reference: "REF1", suppliers: ["ENTEKS", "KATA"] }]);
  });

  it("ne crie pas au conflit quand les deux sources sont d'accord", () => {
    const r = resolveProductSuppliers(
      [{ reference: "REF1", supplier: "ENTEKS" }],
      [{ reference: "REF1", supplier: "ENTEKS" }]
    );
    expect(r.conflicts).toEqual([]);
  });

  it("ignore les lignes sans référence ou sans fournisseur", () => {
    const r = resolveProductSuppliers(
      [
        { reference: "", supplier: "ENTEKS" },
        { reference: "REF1", supplier: "  " },
      ],
      []
    );
    expect(r.byReference.size).toBe(0);
  });
});
