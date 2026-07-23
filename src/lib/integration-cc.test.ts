import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseIntegrationSource,
  buildIntegrationDocuments,
  integrationFileName,
  formatImportDate,
  INTEGRATION_HEADERS,
} from "./integration-cc";

// Mini-export « EAN / BL » : mêmes libellés de colonnes que l'export Texas réel,
// dans un ordre volontairement différent (le parseur repère par NOM).
function sourceBuffer(): ArrayBuffer {
  const rows = [
    [
      "Saison Document", "N° Document", "Code Produit Fini", "Libellé 1 Produit Fini",
      "Libellé Coloris", "Taille", "Composition", "Code Barre", "Prix Unitaire", "Qté",
      "Libellé marque", "Libellé famille statistique", "Code Client", "Raison sociale Client",
      "Prix du Document",
    ],
    ["W26", "143161", "CCAH26_CH07", "Chemise ml", "Bleu marine", "S", "95% polyester", "3665249648641", 21.5, 2, "Country Classic", "Chemise", "MARKS02601", "MARK & STOCK", "21.5"],
    ["W26", "143161", "MCSREF_01", "Pull MCS", "Noir", "M", "100% laine", "3665249000001", 30, 4, "MCS", "Knitwear", "MARKS02601", "MARK & STOCK", "30"],
    ["W26", "143162", "MCSREF_02", "Jean MCS", "Brut", "L", "Sans", "3665249000002", 40, 3, "MCS", "Denim", "MARKS02601", "MARK & STOCK", "40"],
    // Ignorée : quantité nulle
    ["W26", "143162", "MCSREF_03", "Rien", "Noir", "XL", "Sans", "3665249000003", 10, 0, "MCS", "Denim", "MARKS02601", "MARK & STOCK", "10"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Feuil1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("fichier d'intégration CC", () => {
  const lines = parseIntegrationSource(sourceBuffer());

  it("parse les lignes utiles et ignore les quantités nulles", () => {
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.reference)).toEqual(["CCAH26_CH07", "MCSREF_01", "MCSREF_02"]);
  });

  it("prend le PRIX DU DOCUMENT (et pas un prix recalculé)", () => {
    expect(lines[0].price).toBe(21.5);
    expect(lines[2].price).toBe(40);
  });

  it("filtre par marque et découpe un document par N° Document", () => {
    const docs = buildIntegrationDocuments(lines, ["MCS"]);
    expect(docs.map((d) => d.documentNumber)).toEqual(["143161", "143162"]);
    // La ligne Country Classic du document 143161 est écartée.
    expect(docs[0].rows).toHaveLength(1);
    expect(docs[0].totalQuantity).toBe(4);
    expect(docs[1].totalQuantity).toBe(3);
  });

  it("produit les 14 colonnes attendues, dans l'ordre, avec les bonnes équivalences", () => {
    const [doc] = buildIntegrationDocuments(lines, ["MCS"]);
    const row = doc.rows[0];
    expect(Object.keys(row)).toEqual([...INTEGRATION_HEADERS]);
    expect(row).toEqual({
      fournisseur: "MCS",
      "Code Article": "MCSREF_01",
      Désignation: "Pull MCS",
      taille: "M",
      coloris: "Noir",
      EAN: "3665249000001",
      "prix de revient HT": 30,
      "Prix de vente TTC": null,
      secteur: "PAP",
      saison: "W26",
      "code modele": null,
      "famille d'article": "Knitwear",
      matiere: "100% laine",
      Quantité: 4,
    });
  });

  it("sans filtre de marque, garde tout", () => {
    const docs = buildIntegrationDocuments(lines);
    expect(docs[0].rows).toHaveLength(2);
  });

  it("nomme le fichier avec la ville, le n° de document et la date d'import", () => {
    expect(integrationFileName("142426", "TALANGE", "03-07-26")).toBe(
      "Fichier intégration TALANGE 142426 03-07-26.xlsx"
    );
    // Sans date → nom d'origine conservé
    expect(integrationFileName("142426", "TALANGE")).toBe("Fichier intégration TALANGE 142426.xlsx");
    // Ville inconnue → nom encore valide (pas de double espace)
    expect(integrationFileName("143161", "", "03-07-26")).toBe(
      "Fichier intégration 143161 03-07-26.xlsx"
    );
    // Caractères interdits neutralisés
    expect(integrationFileName("143161", "ROMANS/ISERE")).toBe("Fichier intégration ROMANSISERE 143161.xlsx");
  });

  it("formate la date d'import en JJ-MM-AA", () => {
    expect(formatImportDate(new Date(2026, 6, 3))).toBe("03-07-26"); // 3 juillet 2026
    expect(formatImportDate(new Date(2026, 11, 25))).toBe("25-12-26");
  });
});
