import { describe, it, expect } from "vitest";
import { detecterFormat, lireColorOrders, texteCsv } from "./formats";

// En-tête réel de l'export TIO « commandes à la couleur » (52 colonnes), réduit ici aux
// colonnes que le contrôle exploite — le repérage se fait PAR NOM, pas par position.
const ENTETE =
  "Numéro de commande;Date de création de commande;Statut de commande;Nom d'enseigne;" +
  "Référence boutique;Nom du catalogue de vente;Référence produit;Nom produit;" +
  "Catégorie produit;Code couleur;Nom de la couleur;Type de taille;Prix unitaire HT;" +
  "Remise couleur;Quantité à la couleur;Montant total;T0;T1;T2;T3;T4;T5;T6";

const ligne = (
  cmd: string,
  statut: string,
  ref: string,
  couleur: string,
  qte: number,
  montant: string,
  t: (number | string)[],
  prix = "33",
  remise = "0.00"
) =>
  `"${cmd}";"20261102";"${statut}";"PAPARAZZI";"PAPAR00601";"MCS homme S27";"${ref}";` +
  `"Gilet uni zippé";"Maille";"${couleur}";"Mastic";"HAU";"${prix}";"${remise}";` +
  `"${qte}";"${montant}";` +
  t.map((v) => `"${v}"`).join(";");

const csv = (...lignes: string[]) => [ENTETE, ...lignes].join("\r\n");

/** Le fichier tel qu'il arrive : CSV UTF-8 **avec BOM** (c'est ce que TIO produit). */
const buffer = (texte: string, bom = true): ArrayBuffer => {
  const octets = new TextEncoder().encode((bom ? "﻿" : "") + texte);
  return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
};

describe("détection de l'export « commandes à la couleur »", () => {
  it("reconnaît le CSV malgré le BOM et le point-virgule", () => {
    const buf = buffer(csv(ligne("PO-556643029117", "confirmed", "SMGILE_C001", "003", 9, "297.00", [0, 2, 3, 2, 2, 0, 0])));
    expect(detecterFormat(buf)).toBe("color-orders");
  });

  it("reconnaît aussi un fichier encodé en Windows-1252", () => {
    const texte = csv(ligne("PO-1", "confirmed", "SMGILE_C001", "003", 2, "66.00", [0, 2, 0, 0, 0, 0, 0]));
    // Windows-1252 : « é » = 0xE9, « ° » = 0xB0 — un décodage UTF-8 y verrait des
    // caractères de remplacement et ne retrouverait aucun en-tête.
    const octets = Array.from(texte).map((c) => {
      const m: Record<string, number> = { é: 0xe9, è: 0xe8, à: 0xe0, ç: 0xe7, "°": 0xb0, "’": 0x92 };
      return m[c] ?? c.charCodeAt(0);
    });
    const buf = new Uint8Array(octets);
    expect(detecterFormat(buf.buffer as ArrayBuffer)).toBe("color-orders");
  });

  it("ne confond pas un classeur xlsx avec un CSV", () => {
    // Signature ZIP « PK\\x03\\x04 » : texteCsv doit refuser de le décoder en texte.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(texteCsv(zip.buffer as ArrayBuffer)).toBeNull();
  });
});

describe("lecture de l'export « commandes à la couleur »", () => {
  const lignes = lireColorOrders(
    csv(
      ligne("PO-556643029117", "confirmed", "SMGILE_C001", "003", 9, "297.00", [0, 2, 3, 2, 2, 0, 0]),
      ligne("PO-556643029117", "cancel", "SMCHML_C025", "714", 7, "231.00", [0, 1, 2, 2, 2, 0, 0])
    )
  );

  it("lit commande, boutique, enseigne, produit et coloris", () => {
    expect(lignes[0]).toMatchObject({
      numeroCommande: "PO-556643029117",
      statut: "confirmed",
      codeClient: "PAPAR00601",
      nomClient: "PAPARAZZI",
      catalogue: "MCS homme S27",
      reference: "SMGILE_C001",
      codeCouleur: "003",
      libelleCouleur: "Mastic",
      typeTaille: "HAU",
      quantite: 9,
      montant: 297,
    });
  });

  it("garde les quantités dans l'ordre des colonnes T0..Tn", () => {
    expect(lignes[0].quantitesParPosition).toEqual([0, 2, 3, 2, 2, 0, 0]);
  });

  it("rapporte le statut tel quel — l'exclusion se décide ailleurs", () => {
    expect(lignes.map((l) => l.statut)).toEqual(["confirmed", "cancel"]);
  });

  it("écarte une ligne à quantité nulle", () => {
    const l = lireColorOrders(
      csv(
        ligne("PO-1", "confirmed", "SMGILE_C001", "003", 0, "0.00", [0, 0, 0, 0, 0, 0, 0]),
        ligne("PO-1", "confirmed", "SMCHML_C025", "714", 3, "99.00", [0, 3, 0, 0, 0, 0, 0])
      )
    );
    expect(l).toHaveLength(1);
    expect(l[0].reference).toBe("SMCHML_C025");
  });

  it("ne réapplique PAS la remise au montant du fichier", () => {
    // 1 139 lignes de l'export réel portent une remise alors que le montant vaut déjà
    // prix × quantité : la remise est dans le prix, la réappliquer la compterait deux fois.
    const l = lireColorOrders(
      csv(ligne("PO-1", "confirmed", "SMGILE_C001", "003", 9, "297.00", [0, 9, 0, 0, 0, 0, 0], "33", "7.50"))
    );
    expect(l[0].montant).toBe(297);
  });

  it("lit un montant décimal écrit avec une virgule", () => {
    const l = lireColorOrders(
      csv(ligne("PO-1", "confirmed", "SMGILE_C001", "003", 14, "470,47", [0, 14, 0, 0, 0, 0, 0]))
    );
    expect(l[0].montant).toBe(470.47);
  });

  it("supporte une colonne T vide en fin de ligne", () => {
    const l = lireColorOrders(
      csv(ligne("PO-1", "confirmed", "SMGILE_C001", "003", 5, "165.00", [0, 2, 3, 0, 0, 0, ""]))
    );
    expect(l[0].quantitesParPosition).toEqual([0, 2, 3, 0, 0, 0, 0]);
  });

  it("ne perd pas les tailles quand un champ est rédigé sur deux lignes", () => {
    // 75 des 5 934 enregistrements de l'export réel portent un « Modalités de paiement »
    // sur deux lignes ; cette colonne précède les T0..T12. Découpé à la ligne, le fichier
    // rendait des tailles vides sans rien signaler.
    const entete =
      "Numéro de commande;Statut de commande;Référence boutique;Référence produit;" +
      "Code couleur;Type de taille;Quantité à la couleur;Montant total;" +
      "Modalités de paiement;T0;T1;T2";
    const texte =
      entete +
      "\r\n" +
      '"PO-1";"confirmed";"PAPAR00601";"SMGILE_C001";"003";"HAU";"5";"165.00";' +
      '"Quand toute la marchandise est prête .\n1 seul envoi.\n";"0";"2";"3"';
    const l = lireColorOrders(texte);
    expect(l).toHaveLength(1);
    expect(l[0].quantitesParPosition).toEqual([0, 2, 3]);
    expect(l[0].quantite).toBe(5);
  });

  it("rend une liste vide si les colonnes essentielles manquent", () => {
    expect(lireColorOrders("Nom;Prénom\r\nDupont;Jean")).toEqual([]);
  });
});
