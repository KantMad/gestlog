import { describe, it, expect } from "vitest";
import {
  isRealSeason, seasonRank, sortSeasons, seasonFromReference, resolveProductSeason,
} from "./a-vendre-season";

describe("isRealSeason", () => {
  it("accepte les collections PE/AH", () => {
    expect(isRealSeason("PE26")).toBe(true);
    expect(isRealSeason("AH23")).toBe(true);
  });
  it("REJETTE les saisons sentinelles — c'est tout l'objet du correctif", () => {
    expect(isRealSeason("Réassort")).toBe(false);
    expect(isRealSeason("Hors-saison")).toBe(false);
    expect(isRealSeason(null)).toBe(false);
    expect(isRealSeason("")).toBe(false);
  });
});

describe("ordre des saisons", () => {
  it("classe PE avant AH de la même année", () => {
    expect(seasonRank("PE25")).toBeLessThan(seasonRank("AH25"));
    expect(seasonRank("AH25")).toBeLessThan(seasonRank("PE26"));
  });
  it("trie de la plus ancienne à la plus récente et dédoublonne", () => {
    expect(sortSeasons(["AH26", "PE23", "AH26", "PE25"])).toEqual(["PE23", "PE25", "AH26"]);
  });
  it("évacue les sentinelles du tri", () => {
    expect(sortSeasons(["Réassort", "AH25", "Hors-saison"])).toEqual(["AH25"]);
  });
});

describe("seasonFromReference", () => {
  it("décode les lettres vérifiées", () => {
    expect(seasonFromReference("RMPULL_W001")).toBe("AH26");
    expect(seasonFromReference("SMCHEM_C001")).toBe("PE27");
    expect(seasonFromReference("KMPT5P_C001")).toBe("PE23");
  });
  it("ne décode PAS les lettres hors table — AM/CC/TH sont des lignes, pas des saisons", () => {
    expect(seasonFromReference("AMBAGS_P006")).toBeNull();
    expect(seasonFromReference("CCAH26_CH07")).toBeNull();
    expect(seasonFromReference("THPULL_C001")).toBeNull();
    expect(seasonFromReference("")).toBeNull();
  });
});

describe("resolveProductSeason", () => {
  it("retient la collection de LANCEMENT, pas la plus fréquente ni la plus récente", () => {
    const r = resolveProductSeason({
      reference: "PMPULL_C001",
      orderSeasons: ["AH26", "AH25", "AH26"],
    });
    expect(r).toEqual({ season: "AH25", seasons: ["AH25", "AH26"], origin: "commande" });
  });

  it("ignore les sentinelles et garde la vraie saison", () => {
    const r = resolveProductSeason({
      reference: "PMPULL_C001",
      orderSeasons: ["Réassort", "AH25", "Hors-saison"],
    });
    expect(r.season).toBe("AH25");
    expect(r.seasons).toEqual(["AH25"]);
  });

  it("bascule sur une autre couleur de la même référence", () => {
    const r = resolveProductSeason({
      reference: "IMPULL_C030",
      orderSeasons: ["Réassort"],
      siblingSeasons: ["PE25", "AH25"],
    });
    expect(r).toEqual({ season: "PE25", seasons: [], origin: "reference-soeur" });
  });

  it("bascule sur le préfixe quand rien d'autre n'est connu", () => {
    const r = resolveProductSeason({ reference: "QMVEST_L001", orderSeasons: [] });
    expect(r).toEqual({ season: "PE26", seasons: [], origin: "prefixe" });
  });

  it("préfère TOUJOURS une saison constatée à une saison déduite", () => {
    // La référence dit AH26, les commandes disent AH25 : les commandes gagnent.
    const r = resolveProductSeason({ reference: "RMPULL_W001", orderSeasons: ["AH25"] });
    expect(r.season).toBe("AH25");
    expect(r.origin).toBe("commande");
  });

  it("n'invente rien pour une collection antérieure à la table", () => {
    const r = resolveProductSeason({ reference: "GMPTCH_C001", orderSeasons: ["Réassort"] });
    expect(r).toEqual({ season: null, seasons: [], origin: "inconnue" });
  });

  it("ne renvoie JAMAIS une sentinelle comme saison de rattachement", () => {
    for (const ref of ["GMPTCH_C001", "PMPULL_C001", "AMBAGS_P006"]) {
      const r = resolveProductSeason({ reference: ref, orderSeasons: ["Réassort", "Hors-saison"] });
      expect(r.season === null || isRealSeason(r.season)).toBe(true);
      expect(r.seasons).toEqual([]);
    }
  });
});
