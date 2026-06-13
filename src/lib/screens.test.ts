import { describe, it, expect } from "vitest";
import { parseScreenAccess, screenForPath, canAccessScreen } from "./screens";

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
