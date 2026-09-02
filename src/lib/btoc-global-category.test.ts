import { describe, it, expect } from "vitest";
import {
  globalCategoryOf, globalCategoryLabel, normalizeTitle, singular, allGlobalCategories,
} from "./btoc-global-category";

describe("normalisation", () => {
  it("efface casse, accents et ponctuation", () => {
    expect(normalizeTitle("Chemise à Carreaux — CINTRÉE")).toBe("chemise a carreaux cintree");
  });
  it("ramène au singulier sans casser les mots courts", () => {
    expect(singular("chaussettes")).toBe("chaussette");
    expect(singular("jeans")).toBe("jean");
    expect(singular("gants")).toBe("gant");
    expect(singular("sac")).toBe("sac"); // trop court pour être dépluralisé
  });
});

describe("classement par titre", () => {
  it("ignore la casse", () => {
    expect(globalCategoryOf("PANTALON CHINO")).toBe("Pantalon");
    expect(globalCategoryOf("pantalon chino")).toBe("Pantalon");
  });
  it("ignore le pluriel", () => {
    expect(globalCategoryOf("Pantalons 5 poches")).toBe("Pantalon");
    expect(globalCategoryOf("3 paires de chaussettes")).toBe("Chaussettes");
  });
  it("ignore les accents", () => {
    expect(globalCategoryOf("Chèche imprimé")).toBe("Écharpe");
    expect(globalCategoryOf("Imperméable long")).toBe("Manteau");
  });

  it("prend le PREMIER type reconnu, pas n'importe lequel", () => {
    // Le piège : ces titres contiennent tous « jean » ou « denim » en second.
    expect(globalCategoryOf("Bermuda en jean")).toBe("Bermuda");
    expect(globalCategoryOf("Veste en jean")).toBe("Veste");
    expect(globalCategoryOf("Chemise en denim")).toBe("Chemise");
    expect(globalCategoryOf("Jean slim")).toBe("Jean");
  });

  it("ne confond pas surchemise et chemise", () => {
    expect(globalCategoryOf("Surchemise doublée")).toBe("Surchemise");
    expect(globalCategoryOf("Chemise doublée")).toBe("Chemise");
  });

  it("reconnaît les expressions en deux mots", () => {
    expect(globalCategoryOf("Porte-cartes en cuir")).toBe("Maroquinerie");
    expect(globalCategoryOf("Porte-monnaie zippé")).toBe("Maroquinerie");
    expect(globalCategoryOf("T-shirt manches longues")).toBe("T-shirt");
    expect(globalCategoryOf("Tee shirt col rond")).toBe("T-shirt");
  });

  it("tolère la faute de frappe du catalogue", () => {
    expect(globalCategoryOf("Bemuda chino stretch")).toBe("Bermuda");
  });

  it("regroupe les familles proches", () => {
    expect(globalCategoryOf("Blazer croisé")).toBe("Veste");
    expect(globalCategoryOf("Saharienne en lin")).toBe("Veste");
    expect(globalCategoryOf("Parka matelassée")).toBe("Manteau");
    expect(globalCategoryOf("Doudoune sans manches")).toBe("Manteau");
    expect(globalCategoryOf("Bombers zippé")).toBe("Blouson");
  });

  it("rend null quand rien n'est reconnu", () => {
    expect(globalCategoryOf("Coffret cadeau")).toBeNull();
    expect(globalCategoryOf("")).toBeNull();
    expect(globalCategoryLabel("Coffret cadeau")).toBe("Autres");
  });
});

describe("liste des catégories", () => {
  it("dédoublonne les synonymes", () => {
    const all = allGlobalCategories();
    expect(all).toContain("Pantalon");
    expect(all).toContain("Maroquinerie");
    expect(new Set(all).size).toBe(all.length);
  });
  it("est triée pour un affichage stable", () => {
    const all = allGlobalCategories();
    expect([...all].sort((a, b) => a.localeCompare(b, "fr"))).toEqual(all);
  });
});
