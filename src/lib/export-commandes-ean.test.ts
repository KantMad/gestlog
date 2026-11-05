import { describe, it, expect } from "vitest";
import {
  parseCommandesEanCsv,
  buildCommandesEanExport,
  buildReferentiel,
  parsePrix,
  cleColoris,
  cleTaille,
  COLONNES,
} from "./export-commandes-ean";

// En-tête RÉEL de l'export TIO « commandes EAN » du 29/09/2026 (35 colonnes, « Référence
// produit » deux fois, colonne finale vide).
const ENTETE = [
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

/** Fabrique une ligne de l'export EAN. */
function ligne(o: Partial<Record<string, string>> = {}) {
  const c = new Array(35).fill("");
  c[0] = o.commande ?? "IS-455405299095";
  c[3] = o.enseigne ?? "Bazar Chic";
  c[9] = "DUPONT"; // nominatif : ne doit JAMAIS ressortir
  c[12] = "client@example.com";
  c[19] = o.ref ?? "PMMANT_S010";
  c[20] = o.cat ?? "Pièces à manches";
  c[21] = o.sousCat ?? "Manteaux";
  c[22] = "70% coton 30% polyester";
  c[23] = o.prix ?? "79.80";
  c[24] = o.remise ?? "40";
  c[25] = o.ref ?? "PMMANT_S010";
  c[26] = o.nom ?? "Manteau feutré";
  c[27] = o.codeCouleur ?? "951";
  c[28] = o.libCouleur ?? "Gris Anthracite";
  c[30] = o.taille ?? "S";
  c[32] = o.ean ?? "3665249545308";
  c[33] = o.qte ?? "2";
  return c.join(";");
}

const csv = (...lignes: string[]) => [ENTETE, ...lignes].join("\n");

describe("parsePrix", () => {
  it("lit le point et la virgule", () => {
    expect(parsePrix("79.80")).toBe(79.8);
    expect(parsePrix("79,80")).toBe(79.8);
    expect(parsePrix("1 234,50")).toBe(1234.5);
  });

  it("rend null sur une cellule vide — un prix absent n'est pas un prix nul", () => {
    expect(parsePrix("")).toBeNull();
    expect(parsePrix(undefined)).toBeNull();
    expect(parsePrix("n/a")).toBeNull();
  });

  it("accepte le zéro écrit explicitement", () => {
    expect(parsePrix("0")).toBe(0);
  });
});

describe("clés", () => {
  it("ignore casse, accents et espaces de bord", () => {
    expect(cleColoris(" pmmant_s010 ", "951")).toBe(cleColoris("PMMANT_S010", "951"));
    expect(cleTaille("REF", "951", " xl ")).toBe(cleTaille("ref", "951", "XL"));
  });
});

describe("parseCommandesEanCsv", () => {
  it("lit l'export EAN réel et retient la PREMIÈRE « Référence produit »", () => {
    const lu = parseCommandesEanCsv(csv(ligne()));
    expect(lu.manquantes).toEqual([]);
    expect(lu.lignes).toHaveLength(1);
    expect(lu.lignes[0]).toMatchObject({
      reference: "PMMANT_S010",
      productName: "Manteau feutré",
      colorCode: "951",
      colorLabel: "Gris Anthracite",
      size: "S",
      quantity: 2,
      ean: "3665249545308",
      price: 79.8,
      discount: 40,
      orderNumber: "IS-455405299095",
      shop: "Bazar Chic",
      category: "Pièces à manches",
      subCategory: "Manteaux",
    });
  });

  it("écarte et COMPTE les lignes à quantité nulle ou sans référence", () => {
    const lu = parseCommandesEanCsv(
      csv(ligne(), ligne({ qte: "0" }), ligne({ ref: "" }), ligne({ qte: "-3" }))
    );
    expect(lu.lignes).toHaveLength(1);
    expect(lu.lues).toBe(4);
    expect(lu.ecartees).toBe(3);
  });

  it("nomme les colonnes manquantes au lieu de rendre une liste vide", () => {
    const lu = parseCommandesEanCsv("Numéro de commande;Référence produit\nIS-1;REF");
    expect(lu.manquantes).toEqual(["Taille", "Quantité"]);
    expect(lu.lignes).toEqual([]);
  });

  it("refuse l'export « à la couleur » : ni taille ni EAN", () => {
    const entete = ["Numéro de commande", "Référence produit", "Prix unitaire HT", "T0", "T1"].join(";");
    const lu = parseCommandesEanCsv(`${entete}\nIS-1;REF;10.00;2;3`);
    expect(lu.manquantes).toContain("Taille");
  });

  it("lit aussi un fichier séparé par des virgules", () => {
    const lu = parseCommandesEanCsv(
      "Numéro de commande,Référence produit,Taille,Quantité,EAN\nIS-1,REF,M,4,3665249545308"
    );
    expect(lu.lignes[0]).toMatchObject({ size: "M", quantity: 4, ean: "3665249545308" });
  });

  it("tolère le BOM de TIO sur la première colonne", () => {
    const lu = parseCommandesEanCsv(`﻿${csv(ligne())}`);
    expect(lu.lignes[0].orderNumber).toBe("IS-455405299095");
  });

  it("rend une lecture vide sur un fichier sans ligne de données", () => {
    expect(parseCommandesEanCsv(ENTETE).lignes).toEqual([]);
    expect(parseCommandesEanCsv("").lignes).toEqual([]);
  });
});

describe("buildCommandesEanExport", () => {
  const referentiel = buildReferentiel({
    coloris: [
      {
        reference: "PMMANT_S010",
        colorCode: "951",
        colorLabel: "Gris Anthracite",
        category: "Pièces à manches",
        subCategory: "Manteaux",
      },
    ],
    prix: [{ reference: "PMMANT_S010", salePrice: 399, costPrice: 133 }],
    eans: [{ reference: "PMMANT_S010", color: "951", size: "M", ean: "3665249545315" }],
    clients: [{ orderNumber: "IS-455405299095", code: "BAZAR09201" }],
  });

  const lire = (t: string) => parseCommandesEanCsv(t).lignes;

  it("rend exactement les 14 colonnes demandées, dans l'ordre", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())), referentiel);
    expect(out.header).toEqual([
      "EAN", "Référence produit", "Nom produit", "Libellé couleur", "Code couleur", "Taille",
      "Quantité commandée", "Catégorie", "Sous-catégorie", "Prix wholesale",
      "Prix de vente conseillé", "Numéro de commande client", "Code client", "Enseigne client",
    ]);
    expect(out.header).toHaveLength(14);
    expect(out.rows[0]).toEqual([
      "3665249545308", "PMMANT_S010", "Manteau feutré", "Gris Anthracite", "951", "S",
      2, "Pièces à manches", "Manteaux", 79.8, 399, "IS-455405299095", "BAZAR09201", "Bazar Chic",
    ]);
  });

  it("NE FAIT PAS SORTIR les colonnes nominatives du fichier", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())), referentiel);
    const tout = JSON.stringify([out.header, ...out.rows]);
    expect(tout).not.toContain("DUPONT");
    expect(tout).not.toContain("client@example.com");
    expect(tout).not.toContain("Composition");
    expect(tout).not.toContain("70% coton");
  });

  it("garde l'EAN en TEXTE : converti en nombre, Excel l'afficherait 3,66525E+12", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())), referentiel);
    expect(typeof out.rows[0][0]).toBe("string");
    expect(out.rows[0][0]).toBe("3665249545308");
  });

  it("quantité et prix sont NUMÉRIQUES, pour qu'Excel les additionne", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())), referentiel);
    expect(typeof out.rows[0][6]).toBe("number");
    expect(typeof out.rows[0][9]).toBe("number");
    expect(typeof out.rows[0][10]).toBe("number");
  });

  it("prix wholesale « commande » = prix du fichier, remise NON redéduite", () => {
    // 🔴 Le fichier écrit 79,80 € pour un tarif catalogue de 133 € et une remise de 40 % :
    // 133 × 0,6 = 79,80. La remise est donc DÉJÀ dedans.
    const out = buildCommandesEanExport(lire(csv(ligne())), referentiel);
    expect(out.rows[0][9]).toBe(79.8);
    expect(out.rows[0][9]).not.toBe(47.88);
  });

  it("prix wholesale « catalogue » = costPrice, plus élevé que le prix facturé", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())), {
      ...referentiel,
      wholesaleSource: "catalogue",
    });
    expect(out.rows[0][9]).toBe(133);
    expect(out.totalWholesale).toBe(266);
  });

  it("totalise le montant wholesale = prix × quantité", () => {
    const out = buildCommandesEanExport(
      lire(csv(ligne({ qte: "2" }), ligne({ taille: "L", qte: "9" }))),
      referentiel
    );
    expect(out.pieces).toBe(11);
    expect(out.totalWholesale).toBe(877.8); // 79,80 × 11
  });

  it("complète l'EAN manquant depuis le référentiel, et le compte", () => {
    const out = buildCommandesEanExport(
      lire(csv(ligne({ taille: "M", ean: "" }))),
      referentiel
    );
    expect(out.rows[0][0]).toBe("3665249545315");
    expect(out.eansCompletes).toBe(1);
    expect(out.sansEan).toBe(0);
  });

  it("laisse l'EAN VIDE quand personne ne l'a — jamais un code inventé", () => {
    const out = buildCommandesEanExport(
      lire(csv(ligne({ taille: "4XL", ean: "" }))),
      referentiel
    );
    expect(out.rows[0][0]).toBe("");
    expect(out.sansEan).toBe(1);
    expect(out.rows).toHaveLength(1); // la ligne est CONSERVÉE
  });

  it("laisse vide, et signale, une référence sans prix conseillé", () => {
    const out = buildCommandesEanExport(lire(csv(ligne({ ref: "INCONNU_C001" }))), referentiel);
    expect(out.rows[0][10]).toBe("");
    expect(out.sansPrixConseille).toBe(1);
    expect(out.referencesSansPrixConseille).toEqual(["INCONNU_C001"]);
  });

  it("signale les commandes sans code client, sans perdre l'enseigne", () => {
    const out = buildCommandesEanExport(lire(csv(ligne({ commande: "IS-999" }))), referentiel);
    expect(out.rows[0][12]).toBe("");
    expect(out.rows[0][13]).toBe("Bazar Chic");
    expect(out.commandesSansCodeClient).toEqual(["IS-999"]);
  });

  it("se rabat sur le référentiel quand le fichier n'a ni libellé couleur ni catégorie", () => {
    const out = buildCommandesEanExport(
      lire(csv(ligne({ libCouleur: "", cat: "", sousCat: "" }))),
      referentiel
    );
    expect(out.rows[0][3]).toBe("Gris Anthracite");
    expect(out.rows[0][7]).toBe("Pièces à manches");
    expect(out.rows[0][8]).toBe("Manteaux");
  });

  it("sans référentiel du tout : les colonnes du fichier passent quand même", () => {
    const out = buildCommandesEanExport(lire(csv(ligne())));
    expect(out.rows[0][1]).toBe("PMMANT_S010");
    expect(out.rows[0][9]).toBe(79.8); // le prix est dans le fichier
    expect(out.rows[0][10]).toBe(""); // le conseillé ne l'est pas
    expect(out.rows[0][12]).toBe("");
  });

  it("compte les lignes sans prix wholesale et sous-estime le total en le disant", () => {
    const out = buildCommandesEanExport(lire(csv(ligne({ prix: "" }))), referentiel);
    expect(out.rows[0][9]).toBe("");
    expect(out.sansPrixWholesale).toBe(1);
    expect(out.totalWholesale).toBe(0);
  });

  it("une taille à 0 € reste 0 € : c'est une valeur, pas une absence", () => {
    const out = buildCommandesEanExport(lire(csv(ligne({ prix: "0" }))), referentiel);
    expect(out.rows[0][9]).toBe(0);
    expect(out.sansPrixWholesale).toBe(0);
  });

  it("rend des listes triées et dédoublonnées", () => {
    const out = buildCommandesEanExport(
      lire(
        csv(
          ligne({ ref: "ZZZ_C001", commande: "IS-2" }),
          ligne({ ref: "AAA_C001", commande: "IS-1" }),
          ligne({ ref: "AAA_C001", commande: "IS-1", taille: "M" })
        )
      ),
      referentiel
    );
    expect(out.references).toEqual(["AAA_C001", "ZZZ_C001"]);
    expect(out.commandes).toEqual(["IS-1", "IS-2"]);
  });

  it("un fichier vide donne un export vide, pas une erreur", () => {
    const out = buildCommandesEanExport([]);
    expect(out.rows).toEqual([]);
    expect(out.header).toHaveLength(COLONNES.length);
    expect(out.totalWholesale).toBe(0);
  });
});

describe("buildReferentiel", () => {
  it("indexe par clés normalisées : la base et TIO n'écrivent pas pareil", () => {
    const r = buildReferentiel({
      coloris: [
        { reference: " pmmant_s010 ", colorCode: "951", colorLabel: "Gris", category: null, subCategory: null },
      ],
      eans: [{ reference: "PMMANT_S010", color: "951", size: " m ", ean: "366" }],
      clients: [{ orderNumber: " is-1 ", code: "C1" }],
    });
    expect(r.colorisInfo?.[cleColoris("PMMANT_S010", "951")]?.colorLabel).toBe("Gris");
    expect(r.eans?.[cleTaille("pmmant_s010", "951", "M")]).toBe("366");
    expect(r.codesClient?.["is-1"]).toBe("C1");
  });

  it("une réponse serveur vide ne casse rien", () => {
    const r = buildReferentiel({});
    expect(r.colorisInfo).toEqual({});
    expect(r.eans).toEqual({});
  });
});
