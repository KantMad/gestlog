import { describe, it, expect } from "vitest";
import { fileStamp } from "./file-stamp";

describe("fileStamp", () => {
  it("produit date + heure + minute", () => {
    expect(fileStamp(new Date(2026, 8, 4, 14, 32))).toBe("2026-09-04_14h32");
  });

  it("complète mois, jour, heure et minute à deux chiffres", () => {
    expect(fileStamp(new Date(2026, 0, 3, 7, 5))).toBe("2026-01-03_07h05");
  });

  it("gère minuit", () => {
    expect(fileStamp(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31_00h00");
  });

  it("distingue deux exports de la même journée", () => {
    const matin = fileStamp(new Date(2026, 8, 4, 9, 15));
    const soir = fileStamp(new Date(2026, 8, 4, 17, 40));
    expect(matin).not.toBe(soir);
  });

  it("ne contient aucun caractère interdit dans un nom de fichier", () => {
    expect(fileStamp(new Date())).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}h[0-9]{2}$/);
  });
});
