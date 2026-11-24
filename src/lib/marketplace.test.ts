import { describe, expect, it } from "vitest";
import { marketplaceFromMeta, marketplaceLabel } from "./marketplace";

describe("marketplaceFromMeta", () => {
  it("lit sf_marketplace et sf_reference", () => {
    expect(
      marketplaceFromMeta([
        { key: "_order_number", value: "87897" },
        { key: "sf_marketplace", value: "LaRedouteMirakl" },
        { key: "sf_reference", value: " LRFR20263273236715-A " },
      ])
    ).toEqual({ marketplace: "laredoutemirakl", marketplaceRef: "LRFR20263273236715-A" });
  });
  it("commande du site : rien", () => {
    expect(marketplaceFromMeta([{ key: "x", value: "y" }])).toEqual({ marketplace: null, marketplaceRef: null });
    expect(marketplaceFromMeta(undefined)).toEqual({ marketplace: null, marketplaceRef: null });
  });
});

describe("marketplaceLabel", () => {
  it("nomme les marketplaces", () => {
    expect(marketplaceLabel("laredoutemirakl")).toBe("La Redoute");
    expect(marketplaceLabel(null)).toBe("Site");
    expect(marketplaceLabel("autre")).toBe("autre");
  });
});
