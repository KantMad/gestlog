import { describe, it, expect } from "vitest";
import { libelleColonne } from "./column-mapper";

// ⚠️ Cas réel : dans l'export Texas « CodesBarres », le FOURNISSEUR occupe la 79ᵉ
// colonne et son en-tête est vide — la lecture du tableur la nomme `__EMPTY`.
// Laisser ce nom dans la liste déroulante, c'est rendre la colonne introuvable.
describe("libellé d'une colonne sans titre", () => {
  it("laisse intact un en-tête normal", () => {
    expect(libelleColonne("Code Produit Fini")).toBe("Code Produit Fini");
  });

  it("nomme la première colonne sans titre, sans numéro parasite", () => {
    expect(libelleColonne("__EMPTY")).toBe("(colonne sans titre)");
  });

  it("numérote les suivantes à partir de 2", () => {
    expect(libelleColonne("__EMPTY_1")).toBe("(colonne sans titre 2)");
    expect(libelleColonne("__EMPTY_11")).toBe("(colonne sans titre 12)");
  });

  it("montre un exemple de valeur, seul repère exploitable", () => {
    expect(libelleColonne("__EMPTY", "KESSLY")).toBe("(colonne sans titre) — ex. « KESSLY »");
  });

  it("ne confond pas un en-tête qui contient EMPTY", () => {
    expect(libelleColonne("EMPTY")).toBe("EMPTY");
    expect(libelleColonne("__EMPTY_X")).toBe("__EMPTY_X");
  });
});
