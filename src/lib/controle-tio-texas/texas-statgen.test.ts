import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detecterFormat, lireTexasStatgen, decoderTailesTexas } from "./formats";

// En-tête réel du StatGen commande client exporté par Texas (variante sans « Langue+Gamme »).
const ENTETE = [
  "Fiche client", "Fiche produit fini", "Coloris produit fini", "N° commande client",
  "Total Q", "Q. 1", "Q. 2", "Q. 3", "Q. 4", "Q. 5", "Q. 6", "Q. 7",
  "Total CA", "CA. 1", "CA. 2", "CA. 3", "CA. 4", "CA. 5", "CA. 6", "CA. 7",
  "Code client(Client)", "Raison sociale(Client)", "Code produit fini(Produit fini)",
  "N° commande(Commande client)", "Référence commande client(Commande client)",
];
// Légende : code de gamme dans « Total Q », tailles dans les colonnes Q.N.
const legende = (code: string, ...tailles: string[]) => {
  const l: (string | number)[] = new Array(ENTETE.length).fill("");
  l[4] = code;
  tailles.forEach((t, i) => (l[5 + i] = t));
  return l;
};
const donnee = (
  ref: string, coloris: string, q: number[], total: number, ca: number, po = "PO-152847133072"
) => {
  const l: (string | number)[] = new Array(ENTETE.length).fill("");
  l[0] = "ABINE08801";
  l[1] = ref;
  l[2] = coloris;
  l[3] = "111554";
  l[4] = total;
  q.forEach((v, i) => (l[5 + i] = v));
  l[12] = ca;
  l[20] = "ABINE08801";
  l[21] = "ABINEMO";
  l[23] = "111554";
  l[24] = po;
  return l;
};
const classeur = (lignes: (string | number)[][]): ArrayBuffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENTETE, ...lignes]), "StatGen");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

describe("détection du StatGen Texas", () => {
  it("le distingue d'un StatGen TIO, qui porte aussi « Fiche client »", () => {
    const buf = classeur([donnee("AMTSMC_C013", "509-Rose framboise", [1, 1, 1, 1, 1], 5, 81.65)]);
    expect(detecterFormat(buf)).toBe("texas-statgen");
  });

  it("retombe sur « statgen » sans la colonne « Référence commande client »", () => {
    const entete = ENTETE.map((c) => (c.startsWith("Référence commande") ? "Commentaires" : c));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([entete]), "StatGen");
    expect(detecterFormat(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)).toBe(
      "statgen"
    );
  });
});

describe("lecture du StatGen Texas", () => {
  const lu = lireTexasStatgen(
    classeur([
      legende("000", "TU"),
      legende("CEI", "S", "M", "L", "XL", "2XL", "3XL", "4XL"),
      donnee("AMTSMC_C013", "509-Rose framboise", [1, 1, 1, 1, 1], 5, 81.65),
    ])
  );

  it("lit la légende des gammes en tête de fichier", () => {
    expect(lu.legende["000"]).toEqual(["TU"]);
    expect(lu.legende["CEI"]).toEqual(["S", "M", "L", "XL", "2XL", "3XL", "4XL"]);
  });

  it("ne prend pas les lignes de légende pour des commandes", () => {
    expect(lu.lignes).toHaveLength(1);
  });

  it("distingue le n° Texas du n° TIO", () => {
    expect(lu.lignes[0].numeroTexas).toBe("111554");
    expect(lu.lignes[0].numeroTio).toBe("PO-152847133072");
  });

  it("lit client, produit, coloris, total et montant", () => {
    expect(lu.lignes[0]).toMatchObject({
      codeClient: "ABINE08801",
      nomClient: "ABINEMO",
      reference: "AMTSMC_C013",
      codeCouleur: "509",
      libelleCouleur: "Rose framboise",
      quantite: 5,
      montant: 81.65,
    });
  });
});

describe("décodage des Q.N par la légende", () => {
  const PAN = ["28", "29", "30", "31", "32", "33", "34", "36", "38", "40", "42", "44", "46"];
  const CEI = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
  const leg = { PAN, CEI };

  it("décale les positions selon la grille du produit", () => {
    // Grille 29→44 dans une gamme qui commence à 28 : Q.2 vaut 29, pas 28.
    const grille = ["29", "30", "31", "32", "33", "34", "36", "38", "40", "42", "44"];
    const q = [0, 1, 0, 2, 1, 2, 1, 1, 0, 0, 0, 0, 0];
    expect(decoderTailesTexas(q, grille, leg, 8)).toEqual({
      "29": 1, "31": 2, "32": 1, "33": 2, "34": 1, "36": 1,
    });
  });

  it("aligne sur la position 1 quand la grille commence au début de la gamme", () => {
    expect(decoderTailesTexas([1, 1, 1, 1, 1, 0, 0], CEI, leg, 5)).toEqual({
      S: 1, M: 1, L: 1, XL: 1, "2XL": 1,
    });
  });

  it("refuse de décoder une quantité hors de la grille du produit", () => {
    // 4XL n'existe pas pour ce produit : le décodage serait faux, on préfère rien.
    const grille = ["S", "M", "L"];
    expect(decoderTailesTexas([0, 0, 0, 0, 0, 0, 2], grille, leg, 2)).toBeUndefined();
  });

  it("refuse de décoder si le total ne retombe pas", () => {
    expect(decoderTailesTexas([1, 1, 0, 0, 0, 0, 0], CEI, leg, 5)).toBeUndefined();
  });

  it("ne décode rien sans grille produit — un décalage conserverait le total", () => {
    expect(decoderTailesTexas([1, 1, 1, 0, 0, 0, 0], null, leg, 3)).toBeUndefined();
  });

  it("ne décode rien sans légende", () => {
    expect(decoderTailesTexas([1, 1, 1, 0, 0, 0, 0], CEI, {}, 3)).toBeUndefined();
  });
});
