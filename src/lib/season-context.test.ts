import { describe, it, expect } from "vitest";
import { pickSeasonId, seasonStorageKey } from "./season-context";

const list = [
  { id: "ah25", isActive: false },
  { id: "ah26", isActive: true },
  { id: "pe27", isActive: false },
];

describe("pickSeasonId", () => {
  it("garde la saison déjà sélectionnée — recharger la liste ne doit pas déplacer l'utilisateur", () => {
    expect(pickSeasonId(list, "pe27", "ah25")).toBe("pe27");
  });

  it("reprend le choix mémorisé quand rien n'est sélectionné", () => {
    expect(pickSeasonId(list, "", "pe27")).toBe("pe27");
  });

  it("préfère le choix mémorisé à la saison active en base", () => {
    // Sans mémorisation on retomberait sur ah26 (isActive) à chaque rechargement.
    expect(pickSeasonId(list, "", "ah25")).toBe("ah25");
  });

  it("retombe sur la saison active si le choix mémorisé n'existe plus", () => {
    // Saison supprimée, ou choix d'un autre environnement.
    expect(pickSeasonId(list, "", "saison-effacee")).toBe("ah26");
  });

  it("ignore une sélection courante devenue invalide", () => {
    expect(pickSeasonId(list, "disparue", "")).toBe("ah26");
  });

  it("prend la première saison quand aucune n'est active", () => {
    const sans = [{ id: "a", isActive: false }, { id: "b", isActive: false }];
    expect(pickSeasonId(sans, "", "")).toBe("a");
  });

  it("rend une chaîne vide sur une liste vide", () => {
    expect(pickSeasonId([], "x", "y")).toBe("");
  });
});

describe("seasonStorageKey", () => {
  it("isole les utilisateurs — deux personnes sur le même poste ne partagent pas leur saison", () => {
    expect(seasonStorageKey("u1")).not.toBe(seasonStorageKey("u2"));
    expect(seasonStorageKey("u1")).toBe("gestlog.season.u1");
  });
});
