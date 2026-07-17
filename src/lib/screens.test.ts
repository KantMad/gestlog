import { describe, it, expect } from "vitest";
import { parseScreenAccess, screenForPath, screensForPath, canAccessScreen } from "./screens";

describe("parseScreenAccess", () => {
  it("null/vide → null (accès à tout)", () => {
    expect(parseScreenAccess(null)).toBeNull();
    expect(parseScreenAccess("")).toBeNull();
  });
  it("JSON tableau → tableau", () => {
    expect(parseScreenAccess('["/reassort","/btoc"]')).toEqual(["/reassort", "/btoc"]);
  });
  it("tableau direct → tableau", () => {
    expect(parseScreenAccess(["/reassort"])).toEqual(["/reassort"]);
  });
  it("JSON invalide → null", () => {
    expect(parseScreenAccess("{bad")).toBeNull();
  });
});

describe("screenForPath", () => {
  it("page → son écran", () => {
    expect(screenForPath("/reassort")).toBe("/reassort");
    expect(screenForPath("/recap/abc")).toBe("/recap");
  });
  it("API → écran mappé", () => {
    expect(screenForPath("/api/reassort/lines")).toBe("/reassort");
    expect(screenForPath("/api/btoc/stats")).toBe("/btoc");
  });
  it("endpoint transverse → null", () => {
    expect(screenForPath("/api/seasons")).toBeNull();
    expect(screenForPath("/api/clients")).toBeNull();
  });
  it("/users non rattaché (gardé séparément ADMIN)", () => {
    expect(screenForPath("/users")).toBeNull();
    expect(screenForPath("/api/users")).toBeNull();
  });
});

describe("canAccessScreen", () => {
  it("ADMIN accède à tout", () => {
    expect(canAccessScreen("ADMIN", null, "/users")).toBe(true);
    expect(canAccessScreen("ADMIN", [], "/reassort")).toBe(true);
  });
  it("non-admin n'accède jamais à /users", () => {
    expect(canAccessScreen("USER", null, "/users")).toBe(false);
  });
  it("screenAccess null = tous les écrans (sauf /users)", () => {
    expect(canAccessScreen("USER", null, "/reassort")).toBe(true);
  });
  it("restreint : seulement les écrans accordés", () => {
    expect(canAccessScreen("USER", ["/btoc"], "/btoc")).toBe(true);
    expect(canAccessScreen("USER", ["/btoc"], "/reassort")).toBe(false);
  });
  it("sous-chemin d'un écran accordé", () => {
    expect(canAccessScreen("USER", ["/recap"], "/recap/client123")).toBe(true);
  });
});

describe("screensForPath — une API peut servir plusieurs écrans", () => {
  // Cas réel : Audrey a « Tableau de bord » mais PAS « Statistiques ». Le Dashboard se
  // nourrit de /api/statistics/{season,charts} ; rattachées au seul écran /statistics,
  // elles lui renvoyaient 403 → sa page plantait (« page couldn't be loaded »).
  it("les données du dashboard sont accessibles avec /dashboard SEUL", () => {
    const screens = screensForPath("/api/statistics/season")!;
    expect(screens).toContain("/dashboard");
    expect(screens.some((s) => canAccessScreen("USER", ["/dashboard"], s))).toBe(true);
    expect(screensForPath("/api/statistics/charts")!.some((s) => canAccessScreen("USER", ["/dashboard"], s))).toBe(true);
  });

  it("… et avec /statistics seul", () => {
    expect(screensForPath("/api/statistics/season")!.some((s) => canAccessScreen("USER", ["/statistics"], s))).toBe(true);
  });

  it("mais restent refusées sans aucun des deux", () => {
    const screens = screensForPath("/api/statistics/season")!;
    expect(screens.some((s) => canAccessScreen("USER", ["/import"], s))).toBe(false);
  });

  it("les comparaisons gardent leur écran propre (préfixe plus spécifique d'abord)", () => {
    expect(screensForPath("/api/statistics/season-comparison")).toEqual(["/season-comparison"]);
    // Avoir le dashboard ne donne PAS accès aux comparaisons.
    expect(
      screensForPath("/api/statistics/season-comparison")!.some((s) =>
        canAccessScreen("USER", ["/dashboard"], s)
      )
    ).toBe(false);
  });
});
