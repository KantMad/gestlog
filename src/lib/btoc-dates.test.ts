import { describe, it, expect } from "vitest";
import { parisDayStartUtc, parisRangeToUtc } from "./btoc-dates";

describe("parisDayStartUtc — minuit Paris → instant UTC", () => {
  it("été (CEST, UTC+2) : minuit Paris = 22:00 UTC la veille", () => {
    expect(parisDayStartUtc("2026-07-17").toISOString()).toBe("2026-07-16T22:00:00.000Z");
  });

  it("hiver (CET, UTC+1) : minuit Paris = 23:00 UTC la veille", () => {
    expect(parisDayStartUtc("2026-01-15").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});

describe("parisRangeToUtc — période de jours Paris, borne haute EXCLUSIVE", () => {
  it("17-18/07 : couvre les deux jours entiers (bug historique : le 18 était perdu)", () => {
    const { gte, lt } = parisRangeToUtc("2026-07-17", "2026-07-18");
    // début = 17/07 00:00 Paris ; fin = 19/07 00:00 Paris (→ 18/07 inclus en entier)
    expect(gte?.toISOString()).toBe("2026-07-16T22:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-07-18T22:00:00.000Z");
  });

  it("un seul jour reste un jour entier", () => {
    const { gte, lt } = parisRangeToUtc("2026-07-18", "2026-07-18");
    expect(gte?.toISOString()).toBe("2026-07-17T22:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-07-18T22:00:00.000Z");
  });

  it("bornes absentes → null", () => {
    expect(parisRangeToUtc(null, null)).toEqual({ gte: null, lt: null });
  });
});
