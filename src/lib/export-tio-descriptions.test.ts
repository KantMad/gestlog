import { describe, it, expect } from "vitest";
import {
  parseTioCsv,
  enrichTioCsv,
  flattenDescription,
  parseNombre,
  COLONNE_DESCRIPTION,
  COLONNE_MONTANT,
} from "./export-tio-descriptions";

const EN_TETE = [
  "Numéro de commande", "Nom du client", "Mail client", "Référence produit",
  "Nom produit", "Prix à la variation", "Réduction à la variation",
  "Taille", "SKU", "EAN", "Quantité",
];

function csv(lignes: string[][]) {
  return [EN_TETE, ...lignes].map((l) => l.join(";")).join("\n");
}

const FICHIER = csv([
  ["C1", "Durand", "a@b.fr", "REF1", "Pantalon", "10.40", "0", "M", "SKU1", "111", "2"],
  ["C1", "Durand", "a@b.fr", "REF2", "Chemise", "12.50", "0", "L", "SKU2", "222", "3"],
]);

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

describe("parseNombre", () => {
  it("lit le point décimal de l'export TIO", () => {
    expect(parseNombre("10.40")).toBe(10.4);
  });

  it("lit aussi la virgule décimale", () => {
    expect(parseNombre("10,40")).toBe(10.4);
  });

  it("ignore espaces, insécables et symbole monétaire", () => {
    expect(parseNombre("1 234,56 €")).toBe(1234.56);
    expect(parseNombre("1 234,56")).toBe(1234.56);
  });

  // Les deux séparateurs présents : le DERNIER est le décimal.
  it("départage « 1.234,56 » et « 1,234.56 »", () => {
    expect(parseNombre("1.234,56")).toBe(1234.56);
    expect(parseNombre("1,234.56")).toBe(1234.56);
  });

  it("rend 0 sur du vide ou du texte", () => {
    expect(parseNombre("")).toBe(0);
    expect(parseNombre("n/a")).toBe(0);
    expect(parseNombre(undefined as unknown as string)).toBe(0);
  });
});

describe("parseTioCsv", () => {
  it("conserve TOUTES les colonnes du fichier", () => {
    const p = parseTioCsv(FICHIER);
    expect(p.header).toEqual(EN_TETE);
    expect(p.rows[0]).toHaveLength(EN_TETE.length);
  });

  it("repère référence, nom, prix, réduction et quantité PAR NOM", () => {
    const p = parseTioCsv(FICHIER);
    expect(p.refIndex).toBe(3);
    expect(p.nameIndex).toBe(4);
    expect(p.priceIndex).toBe(5);
    expect(p.discountIndex).toBe(6);
    expect(p.qtyIndex).toBe(10);
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
    const p = parseTioCsv(
      `﻿${EN_TETE.join(";")}\n"C;1";D;a@b.fr;REF1;"Pantalon, 5 poches";10.40;0;M;S;1;1`
    );
    expect(p.header[0]).toBe("Numéro de commande");
    expect(p.rows[0][0]).toBe("C;1");
    expect(p.rows[0][4]).toBe("Pantalon, 5 poches");
  });

  it("rend un résultat vide sur un fichier sans ligne de données", () => {
    expect(parseTioCsv(EN_TETE.join(";")).rows).toEqual([]);
  });
});

describe("enrichTioCsv — descriptif", () => {
  it("insère la description JUSTE APRÈS le nom produit", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { descriptionByReference: { REF1: "Pantalon en gaze" } });
    expect(r.descriptionAt).toBe(5);
    expect(r.header[5]).toBe(COLONNE_DESCRIPTION);
    expect(r.rows[0][5]).toBe("Pantalon en gaze");
  });

  it("ne retire NI ne déplace aucune donnée du fichier", () => {
    const avant = parseTioCsv(FICHIER);
    const r = enrichTioCsv(avant, { descriptionByReference: { REF1: "x" } });
    const ajoutees = [r.descriptionAt, r.amountAt].filter((i) => i >= 0).sort((a, b) => b - a);
    for (let i = 0; i < avant.rows.length; i++) {
      const sansAjouts = [...r.rows[i]];
      for (const c of ajoutees) sansAjouts.splice(c, 1);
      expect(sansAjouts).toEqual(avant.rows[i]);
    }
    const enTete = [...r.header];
    for (const c of ajoutees) enTete.splice(c, 1);
    expect(enTete).toEqual(avant.header);
  });

  it("laisse la cellule VIDE quand la référence n'a pas de descriptif", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { descriptionByReference: { REF1: "Pantalon en gaze" } });
    expect(r.rows[1][5]).toBe("");
    expect(r.unknownReferences).toEqual(["REF2"]);
    expect(r.withDescription).toBe(1);
  });

  it("aplatit le HTML des descriptifs", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { descriptionByReference: { REF1: "Pull<br />Jauge 7" } });
    expect(r.rows[0][5]).toBe("Pull\nJauge 7");
  });

  it("apparie sans tenir compte de la casse ni des espaces", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { descriptionByReference: { " ref1 ": "Pantalon" } });
    expect(r.rows[0][5]).toBe("Pantalon");
  });

  it("n'ajoute PAS la colonne descriptif si on n'en demande pas", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER));
    expect(r.descriptionAt).toBe(-1);
    expect(r.header).not.toContain(COLONNE_DESCRIPTION);
  });

  it("ajoute la colonne en FIN de ligne quand « Nom produit » est absent", () => {
    const entete = ["Numéro de commande", "Référence produit", "Quantité"];
    const p = parseTioCsv([entete, ["C1", "REF1", "2"]].map((l) => l.join(";")).join("\n"));
    const r = enrichTioCsv(p, { descriptionByReference: { REF1: "Pantalon" } });
    expect(r.header[r.descriptionAt]).toBe(COLONNE_DESCRIPTION);
    expect(r.rows[0][r.descriptionAt]).toBe("Pantalon");
  });
});

describe("enrichTioCsv — montant", () => {
  it("insère le montant JUSTE APRÈS la quantité", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER));
    expect(r.header[r.amountAt]).toBe(COLONNE_MONTANT);
    expect(r.amountAt).toBe(EN_TETE.length); // juste après « Quantité », dernière colonne
  });

  it("calcule prix × quantité", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER));
    expect(r.rows[0][r.amountAt]).toBe(20.8); // 10.40 × 2
    expect(r.rows[1][r.amountAt]).toBe(37.5); // 12.50 × 3
  });

  it("écrit un NOMBRE, pas du texte : Excel doit pouvoir sommer la colonne", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER));
    expect(typeof r.rows[0][r.amountAt]).toBe("number");
  });

  it("le total est exactement la somme de la colonne", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER));
    const somme = r.rows.reduce((s, l) => s + Number(l[r.amountAt]), 0);
    expect(r.total).toBeCloseTo(somme, 10);
    expect(r.total).toBe(58.3);
    expect(r.pieces).toBe(5);
  });

  // 0.1 × 3 vaut 0.30000000000000004 en flottant : arrondi à la ligne, pas seulement au total.
  it("arrondit chaque ligne au centime", () => {
    const p = parseTioCsv(csv([["C1", "D", "a@b.fr", "REF1", "P", "0.1", "0", "M", "S", "1", "3"]]));
    const r = enrichTioCsv(p);
    expect(r.rows[0][r.amountAt]).toBe(0.3);
    expect(r.total).toBe(0.3);
  });

  it("compte les lignes sans prix au lieu de les taire", () => {
    const p = parseTioCsv(csv([["C1", "D", "a@b.fr", "REF1", "P", "", "0", "M", "S", "1", "4"]]));
    const r = enrichTioCsv(p);
    expect(r.rows[0][r.amountAt]).toBe(0);
    expect(r.linesWithoutPrice).toBe(1);
  });

  // ⚠️ Le montant est BRUT : une réduction non nulle n'est pas déduite, il faut le dire.
  it("signale les lignes portant une réduction", () => {
    const p = parseTioCsv(csv([["C1", "D", "a@b.fr", "REF1", "P", "10", "5", "M", "S", "1", "2"]]));
    const r = enrichTioCsv(p);
    expect(r.rows[0][r.amountAt]).toBe(20);
    expect(r.linesWithDiscount).toBe(1);
  });

  it("n'invente PAS de colonne montant quand le prix manque au fichier", () => {
    const entete = ["Numéro de commande", "Référence produit", "Quantité"];
    const p = parseTioCsv([entete, ["C1", "REF1", "2"]].map((l) => l.join(";")).join("\n"));
    const r = enrichTioCsv(p);
    expect(r.amountAt).toBe(-1);
    expect(r.header).not.toContain(COLONNE_MONTANT);
    expect(r.total).toBe(0);
  });

  it("se laisse désactiver", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { withAmount: false });
    expect(r.amountAt).toBe(-1);
  });

  it("place les deux colonnes ajoutées au bon endroit ensemble", () => {
    const r = enrichTioCsv(parseTioCsv(FICHIER), { descriptionByReference: { REF1: "Pantalon" } });
    expect(r.header[r.descriptionAt - 1]).toBe("Nom produit");
    expect(r.header[r.amountAt - 1]).toBe("Quantité");
    expect(r.descriptionAt).toBeLessThan(r.amountAt);
  });

  it("ne tombe pas sur un fichier vide", () => {
    const r = enrichTioCsv(parseTioCsv(""), { descriptionByReference: { REF1: "x" } });
    expect(r.rows).toEqual([]);
    expect(r.header).toEqual([]);
    expect(r.total).toBe(0);
  });
});
