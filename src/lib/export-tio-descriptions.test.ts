import { describe, it, expect } from "vitest";
import {
  parseTioCsv,
  addDescriptions,
  flattenDescription,
  COLONNE_DESCRIPTION,
} from "./export-tio-descriptions";

const EN_TETE = [
  "Numéro de commande", "Nom du client", "Mail client", "Référence produit",
  "Nom produit", "Taille", "SKU", "EAN", "Quantité",
];

function csv(lignes: string[][]) {
  return [EN_TETE, ...lignes].map((l) => l.join(";")).join("\n");
}

describe("flattenDescription", () => {
  it("transforme les <br /> en sauts de ligne", () => {
    expect(flattenDescription("Pull lambswool<br />\r\nJauge 7<br />")).toBe("Pull lambswool\nJauge 7");
  });

  // Cas réel TIO (THSPULL_906) : « <br />\r\n » partout, et un « <br /><br /> » pour
  // séparer les paragraphes. Le premier ne doit PAS doubler les sauts, le second si.
  it("ne double pas les sauts de ligne mais garde les paragraphes", () => {
    expect(flattenDescription("Jauge 7<br />\r\n<br />\r\nComposition:70% laine")).toBe(
      "Jauge 7\n\nComposition:70% laine"
    );
  });

  it("retire les balises et décode les entités", () => {
    expect(flattenDescription("<strong>Coton</strong> &amp; laine &eacute;cru")).toBe("Coton & laine écru");
  });

  it("puce les listes", () => {
    expect(flattenDescription("<ul><li>Coton</li><li>Laine</li></ul>")).toBe("• Coton\n• Laine");
  });

  it("ne rend jamais null ni undefined", () => {
    expect(flattenDescription("")).toBe("");
    expect(flattenDescription(undefined as unknown as string)).toBe("");
  });
});

describe("parseTioCsv", () => {
  it("conserve TOUTES les colonnes du fichier", () => {
    const p = parseTioCsv(csv([["C1", "Durand", "a@b.fr", "CCPE27_PT03", "Pantalon", "M", "SKU1", "123", "2"]]));
    expect(p.header).toEqual(EN_TETE);
    expect(p.rows[0]).toHaveLength(EN_TETE.length);
  });

  it("repère la référence et le nom produit PAR NOM", () => {
    const p = parseTioCsv(csv([["C1", "D", "a@b.fr", "REF1", "Pantalon", "M", "S", "1", "1"]]));
    expect(p.refIndex).toBe(3);
    expect(p.nameIndex).toBe(4);
  });

  it("retient la PREMIÈRE colonne « Référence produit » quand elle apparaît deux fois", () => {
    const entete = ["Référence produit", "Composition", "Référence produit", "Nom produit"];
    const p = parseTioCsv([entete, ["REF1", "coton", "REF1", "Pantalon"]].map((l) => l.join(";")).join("\n"));
    expect(p.refIndex).toBe(0);
  });

  it("complète une ligne plus courte que l'en-tête", () => {
    const p = parseTioCsv(`${EN_TETE.join(";")}\nC1;Durand`);
    expect(p.rows[0]).toHaveLength(EN_TETE.length);
  });

  it("tolère le BOM et respecte les guillemets", () => {
    const p = parseTioCsv(`﻿${EN_TETE.join(";")}\n"C;1";D;a@b.fr;REF1;"Pantalon, 5 poches";M;S;1;1`);
    expect(p.header[0]).toBe("Numéro de commande");
    expect(p.rows[0][0]).toBe("C;1");
    expect(p.rows[0][4]).toBe("Pantalon, 5 poches");
  });

  it("rend un résultat vide sur un fichier sans ligne de données", () => {
    expect(parseTioCsv(EN_TETE.join(";")).rows).toEqual([]);
  });
});

describe("addDescriptions", () => {
  const fichier = csv([
    ["C1", "Durand", "a@b.fr", "REF1", "Pantalon", "M", "SKU1", "111", "2"],
    ["C1", "Durand", "a@b.fr", "REF2", "Chemise", "L", "SKU2", "222", "3"],
  ]);

  it("insère la description JUSTE APRÈS le nom produit", () => {
    const r = addDescriptions(parseTioCsv(fichier), { REF1: "Pantalon en gaze" });
    expect(r.insertAt).toBe(5);
    expect(r.header[5]).toBe(COLONNE_DESCRIPTION);
    expect(r.rows[0][5]).toBe("Pantalon en gaze");
  });

  it("ne retire NI ne déplace aucune donnée du fichier", () => {
    const avant = parseTioCsv(fichier);
    const r = addDescriptions(avant, { REF1: "x" });
    for (let i = 0; i < avant.rows.length; i++) {
      const sansDesc = [...r.rows[i]];
      sansDesc.splice(r.insertAt, 1);
      expect(sansDesc).toEqual(avant.rows[i]);
    }
    const enTete = [...r.header];
    enTete.splice(r.insertAt, 1);
    expect(enTete).toEqual(avant.header);
  });

  it("laisse la cellule VIDE quand la référence n'a pas de descriptif", () => {
    const r = addDescriptions(parseTioCsv(fichier), { REF1: "Pantalon en gaze" });
    expect(r.rows[1][5]).toBe("");
    expect(r.unknownReferences).toEqual(["REF2"]);
    expect(r.withDescription).toBe(1);
  });

  it("aplatit le HTML des descriptifs", () => {
    const r = addDescriptions(parseTioCsv(fichier), { REF1: "Pull<br />Jauge 7" });
    expect(r.rows[0][5]).toBe("Pull\nJauge 7");
  });

  it("apparie sans tenir compte de la casse ni des espaces", () => {
    const r = addDescriptions(parseTioCsv(fichier), { " ref1 ": "Pantalon" });
    expect(r.rows[0][5]).toBe("Pantalon");
  });

  it("ajoute la colonne en FIN de ligne quand « Nom produit » est absent", () => {
    const entete = ["Numéro de commande", "Référence produit", "Quantité"];
    const p = parseTioCsv([entete, ["C1", "REF1", "2"]].map((l) => l.join(";")).join("\n"));
    const r = addDescriptions(p, { REF1: "Pantalon" });
    expect(r.insertAt).toBe(3);
    expect(r.header[3]).toBe(COLONNE_DESCRIPTION);
    expect(r.rows[0][3]).toBe("Pantalon");
  });

  it("liste les références distinctes du fichier", () => {
    const r = addDescriptions(parseTioCsv(fichier), {});
    expect(r.references).toEqual(["REF1", "REF2"]);
    expect(r.withDescription).toBe(0);
  });

  it("ne tombe pas sur un fichier vide", () => {
    const r = addDescriptions(parseTioCsv(""), { REF1: "x" });
    expect(r.rows).toEqual([]);
    expect(r.header).toEqual([]);
  });
});
