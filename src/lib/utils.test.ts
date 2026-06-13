import { describe, it, expect } from "vitest";
import {
  parseSizeQuantities,
  sumQuantities,
  subtractQuantities,
  addQuantities,
  parseSizeScale,
  formatNumber,
  parseSeasonFromCatalog,
} from "./utils";

describe("parseSizeQuantities", () => {
  it("parse un JSON valide", () => {
    expect(parseSizeQuantities('{"S":2,"M":3}')).toEqual({ S: 2, M: 3 });
  });
  it("renvoie {} sur JSON invalide", () => {
    expect(parseSizeQuantities("pas du json")).toEqual({});
  });
  it("renvoie {} sur chaîne vide", () => {
    expect(parseSizeQuantities("")).toEqual({});
  });
});

describe("sumQuantities", () => {
  it("additionne les quantités", () => {
    expect(sumQuantities({ S: 1, M: 2, L: 3 })).toBe(6);
  });
  it("renvoie 0 sur objet vide", () => {
    expect(sumQuantities({})).toBe(0);
  });
});

describe("subtractQuantities", () => {
  it("soustrait sans descendre sous 0", () => {
    expect(subtractQuantities({ S: 5, M: 2 }, { S: 3, M: 5 })).toEqual({ S: 2, M: 0 });
  });
  it("conserve les tailles non soustraites", () => {
    expect(subtractQuantities({ S: 5, L: 1 }, { S: 1 })).toEqual({ S: 4, L: 1 });
  });
});

describe("addQuantities", () => {
  it("additionne par taille", () => {
    expect(addQuantities({ S: 1 }, { S: 2, M: 3 })).toEqual({ S: 3, M: 3 });
  });
});

describe("parseSizeScale", () => {
  it("découpe et trim", () => {
    expect(parseSizeScale("S, M , L")).toEqual(["S", "M", "L"]);
  });
});

describe("formatNumber", () => {
  it("groupe les milliers (fr-FR)", () => {
    // ICU fr-FR peut utiliser un espace fine insécable : on normalise.
    expect(formatNumber(1234567).replace(/\s/g, " ")).toBe("1 234 567");
  });
  it("formate 0", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("parseSeasonFromCatalog", () => {
  it("S26 → PE 2026", () => {
    expect(parseSeasonFromCatalog("MCS Homme S26")).toEqual({ type: "PE", year: 2026, canonicalName: "PE26" });
  });
  it("W26 → AH 2026", () => {
    expect(parseSeasonFromCatalog("Territoire d'homme W26")).toEqual({ type: "AH", year: 2026, canonicalName: "AH26" });
  });
  it("H26 (hiver) → AH 2026", () => {
    expect(parseSeasonFromCatalog("Offre H26")).toEqual({ type: "AH", year: 2026, canonicalName: "AH26" });
  });
  it("Réassort → null", () => {
    expect(parseSeasonFromCatalog("Réassort")).toBeNull();
  });
  it("S26 suivi d'un mot (stock) → PE 2026", () => {
    expect(parseSeasonFromCatalog("MCS Country classic S26 stock")?.canonicalName).toBe("PE26");
  });
  it("aucun code → null", () => {
    expect(parseSeasonFromCatalog("Catalogue générique")).toBeNull();
  });
});
