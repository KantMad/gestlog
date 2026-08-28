import { describe, it, expect } from "vitest";
import { NAV_TREE, NAV_FOOTER, visibleNav, activeHref, activeGroupId, isGroup } from "./navigation";
import { APP_SCREENS } from "./screens";

const flat = NAV_TREE.flatMap((e) => (isGroup(e) ? e.items : [e]));
const hrefs = flat.map((i) => i.href);

// Entrées de menu qui ne sont PAS des écrans restreignables :
// - /import/receptions est couvert par le préfixe /import ;
// - /users est gardé séparément (ADMIN).
const NOT_SCREENS = ["/import/receptions", "/users"];

describe("arborescence du menu", () => {
  it("expose CHAQUE écran de APP_SCREENS — aucun écran ne devient inaccessible", () => {
    const missing = APP_SCREENS.map((s) => s.key).filter((k) => !hrefs.includes(k));
    expect(missing).toEqual([]);
  });

  it("ne contient aucun href inconnu de APP_SCREENS", () => {
    const keys = APP_SCREENS.map((s) => s.key);
    const unknown = hrefs.filter((h) => !keys.includes(h) && !NOT_SCREENS.includes(h));
    expect(unknown).toEqual([]);
  });

  it("ne duplique aucune entrée", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("garde le Tableau de bord et le BtoC au premier niveau", () => {
    const top = NAV_TREE.filter((e) => !isGroup(e)).map((e) => (e as { href: string }).href);
    expect(top).toContain("/dashboard");
    expect(top).toContain("/btoc");
  });

  it("ne met ni l'aide ni le compte dans les groupes", () => {
    expect(hrefs).not.toContain("/aide");
    expect(hrefs).not.toContain("/account");
    expect(NAV_FOOTER.map((i) => i.href)).toEqual(["/aide", "/account"]);
  });
});

describe("visibleNav", () => {
  it("montre tout à un admin", () => {
    const v = visibleNav("ADMIN", null);
    const shown = v.flatMap((e) => (isGroup(e) ? e.items : [e])).map((i) => i.href);
    expect(shown).toEqual(expect.arrayContaining(hrefs));
  });

  it("cache Utilisateurs à un non-admin, même sans restriction d'écran", () => {
    const shown = visibleNav("USER", null)
      .flatMap((e) => (isGroup(e) ? e.items : [e])).map((i) => i.href);
    expect(shown).not.toContain("/users");
  });

  it("masque entièrement un groupe dont aucun écran n'est autorisé", () => {
    const v = visibleNav("USER", ["/btoc"]);
    expect(v.some((e) => isGroup(e) && e.id === "marchandise")).toBe(false);
  });

  it("APLATIT un groupe réduit à un seul écran — pas de sous-menu à une ligne", () => {
    const v = visibleNav("USER", ["/product-info"]);
    expect(v.some(isGroup)).toBe(false);
    expect(v.map((e) => (e as { href: string }).href)).toEqual(["/product-info"]);
  });

  it("conserve le groupe dès qu'il reste deux écrans", () => {
    const v = visibleNav("USER", ["/product-info", "/comparison"]);
    const g = v.find((e) => isGroup(e) && e.id === "marchandise");
    expect(g && isGroup(g) ? g.items.map((i) => i.href) : [])
      .toEqual(["/comparison", "/product-info"]);
  });

  // « Correction réception » (/import/receptions) n'est pas un écran distinct : il est
  // couvert par le PRÉFIXE /import. Accorder Import doit donc donner les deux lignes —
  // sinon l'écran de correction deviendrait inaccessible aux utilisateurs restreints.
  it("accorde Correction réception avec l'écran Import", () => {
    const v = visibleNav("USER", ["/import"]);
    const g = v.find((e) => isGroup(e) && e.id === "marchandise");
    expect(g && isGroup(g) ? g.items.map((i) => i.href) : [])
      .toEqual(["/import", "/import/receptions"]);
  });

  it("n'expose AUCUN écran non accordé", () => {
    const access = ["/allocation", "/shipments"];
    const shown = visibleNav("USER", access)
      .flatMap((e) => (isGroup(e) ? e.items : [e])).map((i) => i.href);
    expect(shown.sort()).toEqual(access.sort());
  });
});

describe("élément actif", () => {
  const v = visibleNav("ADMIN", null);
  it("choisit le href le plus spécifique", () => {
    expect(activeHref(v, "/import/receptions")).toBe("/import/receptions");
    expect(activeHref(v, "/import")).toBe("/import");
  });
  it("reste actif sur une sous-page", () => {
    expect(activeHref(v, "/recap/abc123")).toBe("/recap");
  });
  it("désigne le groupe à ouvrir", () => {
    expect(activeGroupId(v, "/import/receptions")).toBe("marchandise");
    expect(activeGroupId(v, "/btoc")).toBeNull();
  });
});
