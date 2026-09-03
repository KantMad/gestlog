import { describe, it, expect } from "vitest";
import { brandOf, brandsOf, DEFAULT_BRAND } from "./brand";

describe("brandOf", () => {
  it("TH → TDH", () => {
    expect(brandOf("THPULL_C001")).toBe("TDH");
    expect(brandOf("THAH26_CH02")).toBe("TDH");
  });
  it("CC → Country Classic", () => {
    expect(brandOf("CCAH26_CH07")).toBe("Country Classic");
    expect(brandOf("CCAH25_CT02")).toBe("Country Classic");
  });
  it("tout le reste → MCS", () => {
    expect(brandOf("RMPULL_W001")).toBe("MCS");
    expect(brandOf("QMVEST_L001")).toBe("MCS");
    expect(brandOf("AMBAGS_P006")).toBe("MCS");
    expect(brandOf(DEFAULT_BRAND)).toBe("MCS");
  });
  it("ignore la casse et les espaces autour", () => {
    expect(brandOf("  thpull_c001 ")).toBe("TDH");
    expect(brandOf("ccah26_ch07")).toBe("Country Classic");
  });
  it("ne se déclenche que sur les DEUX premières lettres", () => {
    // « T » seul ou « C » seul ne suffisent pas : ce sont d'autres familles.
    expect(brandOf("TEPULL_C001")).toBe("MCS");
    expect(brandOf("CMMR00900_P0110")).toBe("MCS");
    expect(brandOf("CVPULL_C001")).toBe("MCS");
  });
  it("rattache une référence vide ou absente à MCS", () => {
    expect(brandOf("")).toBe("MCS");
    expect(brandOf(null)).toBe("MCS");
    expect(brandOf(undefined)).toBe("MCS");
  });
});

describe("brandsOf", () => {
  it("dédoublonne et trie", () => {
    expect(
      brandsOf(["RMPULL_W001", "THPULL_C001", "CCAH26_CH07", "QMVEST_L001", "THBLOU_C002"])
    ).toEqual(["Country Classic", "MCS", "TDH"]);
  });
  it("rend une seule marque quand tout vient de la même", () => {
    expect(brandsOf(["RMPULL_W001", "AMBAGS_P006"])).toEqual(["MCS"]);
  });
  it("rend un tableau vide sans référence", () => {
    expect(brandsOf([])).toEqual([]);
  });
});
