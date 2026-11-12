import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detecterFormat, lireFormatLong, coteDuFormat, LIBELLE_FORMAT, type FormatControle,
} from "./formats";

/** Construit un classeur en mémoire à partir de lignes brutes. */
function classeur(lignes: (string | number)[][], nomFeuille = "Commandes"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lignes), nomFeuille);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// En-tête réel de l'export GestLog « Commandes clients — détail par code-barres ».
const ENTETE_GESTLOG = [
  "EAN", "Référence produit", "Nom produit", "Libellé couleur", "Code couleur", "Taille",
  "Quantité commandée", "Catégorie", "Sous-catégorie", "Prix wholesale",
  "Prix de vente conseillé", "Numéro de commande client", "Code client", "Enseigne client",
];
const ligneGestlog = (taille: string, qte: number, prix = 25, commande = "PO-0001") => [
  "3665251234567", "RMPULL_W001", "Pull col rond", "Cognac", "208", taille,
  qte, "Maille", "Pull", prix, 69.9, commande, "LEKO097", "LE KORNER",
];

describe("détection du format", () => {
  it("reconnaît l'export GestLog (une ligne par taille)", () => {
    expect(detecterFormat(classeur([ENTETE_GESTLOG, ligneGestlog("M", 2)]))).toBe("long");
  });

  it("reconnaît un export Texas AVANT de le prendre pour autre chose", () => {
    const entete = [
      "Saison", "Fiche produit fini", "Coloris", "N° commande client",
      "Référence commande client", "Code client(Commande client)", "Langue+Gamme",
      "Taille début", "Taille fin", "Q. 1", "Q. 2", "Total Q",
      "Montant commandé net total", "Soldé(Commande client)",
    ];
    expect(detecterFormat(classeur([entete]))).toBe("texas");
  });

  it("reconnaît une commande client TIO StatGen", () => {
    const entete = [
      "N° commande client", "Fiche client", "Raison sociale", "Fiche produit fini",
      "Coloris", "Q. 1", "Q. 2", "Q. 3",
    ];
    expect(detecterFormat(classeur([entete]))).toBe("statgen");
  });

  it("rend null sur un fichier qui n'a rien à voir", () => {
    expect(detecterFormat(classeur([["Nom", "Prénom"], ["Dupont", "Jean"]]))).toBeNull();
  });

  it("trouve l'en-tête même enfoui sous quelques lignes de titre", () => {
    const buf = classeur([
      ["Export du 12/11/2026"], [], ["Saison AH26"], [], ENTETE_GESTLOG, ligneGestlog("M", 2),
    ]);
    expect(detecterFormat(buf)).toBe("long");
  });

  it("accepte des colonnes nommées autrement (référence / taille / quantité / n° commande)", () => {
    const entete = ["N° commande", "Référence", "Coloris", "Taille", "Qté"];
    const buf = classeur([entete, ["PO-1", "RMPULL_W001", "208-Cognac", "M", 3]]);
    expect(detecterFormat(buf)).toBe("long");
  });
});

describe("lecture du format « une ligne par taille »", () => {
  it("lit commande, client, produit, taille et quantité", () => {
    const lignes = lireFormatLong(classeur([ENTETE_GESTLOG, ligneGestlog("M", 2)]));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      numeroCommande: "PO-0001",
      codeClient: "LEKO097",
      nomClient: "LE KORNER",
      reference: "RMPULL_W001",
      codeCouleur: "208",
      libelleCouleur: "Cognac",
      taille: "M",
      quantite: 2,
    });
  });

  it("déduit le montant de la ligne du prix wholesale × quantité", () => {
    const lignes = lireFormatLong(classeur([ENTETE_GESTLOG, ligneGestlog("M", 3, 24.97)]));
    expect(lignes[0].montantLigne).toBe(74.91);
  });

  it("ne retient pas le prix de vente conseillé comme montant", () => {
    const entete = ENTETE_GESTLOG.map((c) => (c === "Prix wholesale" ? "Prix public" : c));
    const lignes = lireFormatLong(classeur([entete, ligneGestlog("M", 3)]));
    expect(lignes[0].montantLigne).toBeUndefined();
  });

  it("écarte les tailles à quantité nulle — une taille à 0 n'a pas été commandée", () => {
    const lignes = lireFormatLong(
      classeur([ENTETE_GESTLOG, ligneGestlog("S", 0), ligneGestlog("M", 2)])
    );
    expect(lignes.map((l) => l.taille)).toEqual(["M"]);
  });

  it("écarte la ligne « Total » d'un export", () => {
    const total = ligneGestlog("", 99);
    total[1] = "TOTAL";
    const lignes = lireFormatLong(classeur([ENTETE_GESTLOG, ligneGestlog("M", 2), total]));
    expect(lignes).toHaveLength(1);
  });

  it("sépare un coloris écrit « 208-Cognac »", () => {
    const buf = classeur([
      ["N° commande", "Référence", "Coloris", "Taille", "Qté"],
      ["PO-1", "RMPULL_W001", "208-Cognac", "M", 3],
    ]);
    const lignes = lireFormatLong(buf);
    expect(lignes[0].codeCouleur).toBe("208");
    expect(lignes[0].libelleCouleur).toBe("Cognac");
  });

  it("lit une quantité écrite en texte avec une virgule ou une espace", () => {
    const buf = classeur([
      ["N° commande", "Référence", "Taille", "Quantité"],
      ["PO-1", "RMPULL_W001", "M", "12"],
      ["PO-1", "RMTEE_W002", "L", "1 000"],
    ]);
    const lignes = lireFormatLong(buf);
    expect(lignes.map((l) => l.quantite)).toEqual([12, 1000]);
  });

  it("garde un montant déjà donné à la ligne plutôt que de le recalculer", () => {
    const buf = classeur([
      ["N° commande", "Référence", "Taille", "Quantité", "Prix wholesale", "Montant"],
      ["PO-1", "RMPULL_W001", "M", 2, 25, 49],
    ]);
    expect(lireFormatLong(buf)[0].montantLigne).toBe(49);
  });
});

// L'écran et le serveur recopiaient chacun cette correspondance : ajouter le StatGen de
// Texas n'a mis à jour que le serveur, et l'écran rangeait le fichier Texas du côté TIO.
// Elle n'existe plus qu'une fois — ces tests la verrouillent.
describe("correspondance format → côté et libellé", () => {
  const TOUS: FormatControle[] = ["texas", "texas-statgen", "color-orders", "long", "statgen"];

  it("range du côté TEXAS tout ce qui vient de l'ERP", () => {
    expect(coteDuFormat("texas")).toBe("TEXAS");
    expect(coteDuFormat("texas-statgen")).toBe("TEXAS");
  });

  it("range du côté TIO tout le reste", () => {
    expect(coteDuFormat("color-orders")).toBe("TIO");
    expect(coteDuFormat("long")).toBe("TIO");
    expect(coteDuFormat("statgen")).toBe("TIO");
  });

  it("donne un libellé non vide à chaque format", () => {
    for (const f of TOUS) expect(LIBELLE_FORMAT[f]?.length).toBeGreaterThan(0);
  });

  it("ne laisse pas deux formats partager le même libellé", () => {
    const libelles = TOUS.map((f) => LIBELLE_FORMAT[f]);
    expect(new Set(libelles).size).toBe(libelles.length);
  });
});
