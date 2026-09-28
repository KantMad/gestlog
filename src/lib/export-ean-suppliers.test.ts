import { describe, it, expect } from "vitest";
import {
  parseEanOrdersCsv,
  splitEanBySupplier,
  splitCsvLine,
  SANS_FOURNISSEUR,
} from "./export-ean-suppliers";

// En-tête réel de l'export TIO « EAN ». Noter « Référence produit » DEUX FOIS (positions
// 19 et 25), et la colonne vide en fin de ligne.
const H = [
  "Numéro de commande", "Date de création de commande", "Statut de commande", "Nom d'enseigne",
  "Adresse de facturation 1", "Code postal de facturation", "Ville de facturation",
  "Pays de facturation", "Nom de société de la boutique", "Nom du client", "Prénom du client",
  "Genre du client", "Mail client", "Nom du responsable commercial",
  "Prénom du responsable commercial", "Genre du responsable commercial",
  "Mail responsable commercial", "Nom du catalogue de vente", "Catalogue Prix ID",
  "Référence produit", "Catégorie produit", "Sous-catégorie produit", "Composition",
  "Prix à la variation", "Réduction à la variation", "Référence produit", "Nom produit",
  "Code couleur", "Nom de la couleur", "Type de taille", "Taille", "SKU", "EAN", "Quantité", "",
].join(";");

const ligne = (o: Partial<Record<string, string>> & { ref: string; taille: string; qte: string; ean: string }) => {
  const c = Array(35).fill("");
  c[0] = o.cmd ?? "PO-1"; c[2] = "validated"; c[3] = o.boutique ?? "INDIGO";
  c[9] = "Grehan"; c[10] = "Lucas"; c[12] = "grehanlucas@gmail.com"; c[16] = "audrey@centralway.fr";
  c[4] = "12 rue de la Paix"; c[6] = "TALANGE";
  c[17] = "MCS Country classic S27"; c[19] = o.ref; c[20] = "Jersey"; c[21] = "Polos MC";
  c[23] = o.prix ?? "13.00"; c[25] = o.ref; c[26] = o.libelle ?? "Polo MC";
  c[27] = o.coloris ?? "001"; c[28] = "Blanc"; c[29] = "HAU"; c[30] = o.taille;
  c[31] = `${o.ref}-001-${o.taille}`; c[32] = o.ean; c[33] = o.qte;
  return c.map((v) => `"${v}"`).join(";");
};

const CSV = [H, ligne({ ref: "CCPE27_PL01", taille: "M", qte: "6", ean: "366501" }),
  ligne({ ref: "CCPE27_PL01", taille: "L", qte: "8", ean: "366502" }),
  ligne({ ref: "CCPE27_JE14", taille: "31", qte: "3", ean: "366503", libelle: "Jean" }),
  ligne({ ref: "SMXXXX_999", taille: "M", qte: "5", ean: "366504", libelle: "Inconnu" }),
  ligne({ ref: "CCPE27_PL01", taille: "XL", qte: "0", ean: "366505" })].join("\n");

const FOURNISSEURS = { CCPE27_PL01: "JUGROUP", CCPE27_JE14: "RASENTEKSTIL" };

describe("export EAN — lecture du fichier", () => {
  const rows = parseEanOrdersCsv(CSV);

  it("lit les lignes utiles et écarte les quantités nulles", () => {
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.size)).toEqual(["M", "L", "31", "M"]);
  });

  it("conserve EAN, SKU, taille et quantité", () => {
    expect(rows[0]).toMatchObject({
      reference: "CCPE27_PL01", size: "M", quantity: 6, ean: "366501",
      sku: "CCPE27_PL01-001-M", shop: "INDIGO", catalog: "MCS Country classic S27",
    });
  });

  // ⚠️ La colonne apparaît deux fois : on doit lire la première, pas se tromper d'index.
  it("lit « Référence produit » malgré sa présence en double", () => {
    expect(new Set(rows.map((r) => r.reference)).size).toBe(3);
  });

  it("rejette un fichier qui n'est pas cet export", () => {
    expect(parseEanOrdersCsv("a;b;c\n1;2;3")).toEqual([]);
    expect(parseEanOrdersCsv("")).toEqual([]);
  });

  it("tolère un BOM en tête de fichier", () => {
    expect(parseEanOrdersCsv("﻿" + CSV)).toHaveLength(4);
  });
});

describe("export EAN — découpage par fournisseur", () => {
  const rows = parseEanOrdersCsv(CSV);
  const s = splitEanBySupplier(rows, FOURNISSEURS);

  it("un onglet par fournisseur, du plus gros volume au plus petit", () => {
    expect(s.sheets.map((x) => x.supplier)).toEqual([
      "JUGROUP", // 14 pièces
      "RASENTEKSTIL", // 3
      SANS_FOURNISSEUR, // 5, mais toujours en dernier
    ]);
    expect(s.supplierCount).toBe(2);
  });

  it("ne perd aucune ligne ni aucune pièce", () => {
    expect(s.sheets.reduce((n, x) => n + x.rows.length, 0)).toBe(rows.length);
    expect(s.sheets.reduce((n, x) => n + x.pieces, 0)).toBe(s.pieces);
    expect(s.pieces).toBe(22); // 6 + 8 + 3 + 5
  });

  it("recense les références sans fournisseur", () => {
    expect(s.unknownReferences).toEqual(["SMXXXX_999"]);
  });

  // 🔴 Le fichier porte nom, e-mail et adresse du client : un onglet fournisseur ne doit
  // pas les transporter.
  it("n'emporte AUCUNE donnée personnelle", () => {
    const tout = JSON.stringify(s.sheets);
    for (const interdit of ["Grehan", "Lucas", "grehanlucas@gmail.com", "audrey@centralway.fr", "12 rue de la Paix"]) {
      expect(tout).not.toContain(interdit);
    }
  });

  it("n'inclut pas les prix par défaut", () => {
    expect(s.sheets[0].header).not.toContain("Prix à la variation");
    expect(JSON.stringify(s.sheets)).not.toContain("13.00");
  });

  it("ajoute les prix sur demande, en dernière colonne", () => {
    const avec = splitEanBySupplier(rows, FOURNISSEURS, { withPrices: true });
    expect(avec.sheets[0].header.at(-1)).toBe("Prix à la variation");
    expect(avec.sheets[0].rows[0].at(-1)).toBe("13.00");
  });

  it("laisse la colonne Fournisseur vide dans l'onglet des inconnues", () => {
    const sans = s.sheets.find((x) => x.supplier === SANS_FOURNISSEUR)!;
    expect(sans.rows.every((r) => r[0] === "")).toBe(true);
  });

  it("nomme les onglets sans collision et sous 31 caractères", () => {
    const long = splitEanBySupplier(rows, {
      CCPE27_PL01: "FOURNISSEUR AU NOM INTERMINABLE NUMERO 1",
      CCPE27_JE14: "FOURNISSEUR AU NOM INTERMINABLE NUMERO 2",
    });
    const noms = long.sheets.map((x) => x.sheetName);
    expect(new Set(noms).size).toBe(noms.length);
    noms.forEach((n) => expect(n.length).toBeLessThanOrEqual(31));
  });

  it("sans aucun fournisseur connu, tout va dans un onglet unique", () => {
    const r = splitEanBySupplier(rows, {});
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].supplier).toBe(SANS_FOURNISSEUR);
    expect(r.supplierCount).toBe(0);
  });
});

describe("découpage CSV", () => {
  it("respecte les guillemets et les séparateurs internes", () => {
    expect(splitCsvLine('"a";"b;c";"d"')).toEqual(["a", "b;c", "d"]);
  });
  it("gère un guillemet doublé", () => {
    expect(splitCsvLine('"il dit ""oui""";"b"')).toEqual(['il dit "oui"', "b"]);
  });
});
