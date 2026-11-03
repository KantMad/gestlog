import { describe, it, expect } from "vitest";
import {
  classifyQuery, digitsOnly, ean13Checksum, isEan13, formatEan, sortSizesByScale,
} from "./ean-search";

describe("digitsOnly", () => {
  it("retire espaces, tirets et lettres", () => {
    expect(digitsOnly("3 665249-594504")).toBe("3665249594504");
    expect(digitsOnly(null)).toBe("");
  });
});

describe("clé de contrôle EAN-13", () => {
  // EAN réel du référentiel (QMBLAZ_C820).
  it("valide un code du catalogue", () => {
    expect(isEan13("3665249594504")).toBe(true);
  });

  it("rejette un chiffre modifié", () => {
    expect(isEan13("3665249594505")).toBe(false);
  });

  it("rejette ce qui n'a pas 13 chiffres", () => {
    expect(isEan13("366524959450")).toBe(false);
    expect(isEan13("36652495945040")).toBe(false);
    expect(isEan13("")).toBe(false);
  });

  it("calcule la clé des 12 premiers chiffres", () => {
    expect(ean13Checksum("366524959450")).toBe(4);
  });
});

describe("classifyQuery", () => {
  it("reconnaît un EAN-13 scanné", () => {
    expect(classifyQuery("3665249594504")).toEqual({
      kind: "ean", value: "3665249594504", eanValide: true,
    });
  });

  it("tolère les espaces et tirets du copier-coller", () => {
    expect(classifyQuery(" 3 665249-594504 ")).toMatchObject({ kind: "ean", value: "3665249594504" });
  });

  // Un code recopié à la main : on le signale au lieu d'annoncer « aucun résultat ».
  it("signale un EAN-13 dont la clé est fausse", () => {
    expect(classifyQuery("3665249594505")).toEqual({
      kind: "ean", value: "3665249594505", eanValide: false,
    });
  });

  it("traite 4 chiffres ou plus comme un fragment de code-barres", () => {
    expect(classifyQuery("594504")).toEqual({ kind: "ean-partiel", value: "594504" });
    expect(classifyQuery("3665")).toEqual({ kind: "ean-partiel", value: "3665" });
  });

  // 🔴 Le piège : « 752 » est un CODE COULEUR, pas un début de code-barres.
  it("traite trois chiffres comme du texte (code couleur)", () => {
    expect(classifyQuery("752")).toEqual({ kind: "texte", value: "752" });
    expect(classifyQuery("999")).toEqual({ kind: "texte", value: "999" });
  });

  it("traite une référence comme du texte", () => {
    expect(classifyQuery("SMCHML_C025")).toEqual({ kind: "texte", value: "SMCHML_C025" });
  });

  it("traite un nom de produit comme du texte", () => {
    expect(classifyQuery("Blazer piqué")).toEqual({ kind: "texte", value: "Blazer piqué" });
  });

  it("rend « vide » sur une saisie blanche", () => {
    expect(classifyQuery("   ")).toEqual({ kind: "vide", value: "" });
    expect(classifyQuery(null)).toEqual({ kind: "vide", value: "" });
  });
});

describe("formatEan", () => {
  it("découpe en 1-6-6", () => {
    expect(formatEan("3665249594504")).toBe("3 665249 594504");
  });

  it("rend la valeur telle quelle si ce n'est pas un EAN-13", () => {
    expect(formatEan("12345")).toBe("12345");
  });
});

describe("sortSizesByScale", () => {
  it("suit la grille du produit, pas l'alphabet", () => {
    const lignes = [{ size: "XL" }, { size: "S" }, { size: "M" }, { size: "L" }];
    expect(sortSizesByScale(lignes, "S,M,L,XL").map((l) => l.size)).toEqual(["S", "M", "L", "XL"]);
  });

  it("ignore la casse et les espaces de la grille", () => {
    const lignes = [{ size: "m" }, { size: "s" }];
    expect(sortSizesByScale(lignes, " S , M ").map((l) => l.size)).toEqual(["s", "m"]);
  });

  // Une taille hors grille ne doit pas DISPARAÎTRE : elle passe à la fin.
  it("met les tailles absentes de la grille à la fin", () => {
    const lignes = [{ size: "3XL" }, { size: "S" }, { size: "M" }];
    expect(sortSizesByScale(lignes, "S,M").map((l) => l.size)).toEqual(["S", "M", "3XL"]);
  });

  it("trie numériquement à défaut de grille", () => {
    const lignes = [{ size: "44" }, { size: "38" }, { size: "40" }];
    expect(sortSizesByScale(lignes, null).map((l) => l.size)).toEqual(["38", "40", "44"]);
  });

  it("ne modifie pas le tableau d'origine", () => {
    const lignes = [{ size: "XL" }, { size: "S" }];
    sortSizesByScale(lignes, "S,XL");
    expect(lignes.map((l) => l.size)).toEqual(["XL", "S"]);
  });
});
