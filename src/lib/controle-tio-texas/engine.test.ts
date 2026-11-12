import { describe, it, expect } from "vitest";
import {
  comparer, rapportVersFeuilles, cleCommande, cleCouleur,
  type LigneNormalisee,
} from "./engine";

const L = (p: Partial<LigneNormalisee>): LigneNormalisee => ({
  numeroTio: "PO-0001",
  codeClient: "LEKO097",
  reference: "RMPULL_W001",
  codeCouleur: "208",
  pieces: 0,
  ...p,
});

/** Ligne avec tailles : les pièces découlent des tailles (jamais incohérent). */
const T = (p: Partial<LigneNormalisee> & { tailles: Record<string, number> }): LigneNormalisee =>
  L({ ...p, pieces: Object.values(p.tailles).reduce((s, q) => s + q, 0) });

describe("clés de rapprochement", () => {
  it("rejoint les n° de commande quels que soient les séparateurs", () => {
    expect(cleCommande("IS-26 0014")).toBe(cleCommande("is26/0014"));
    expect(cleCommande("IS260014")).toBe(cleCommande("IS-26-0014"));
  });
  it("ne confond pas deux commandes différentes", () => {
    expect(cleCommande("PO-0001")).not.toBe(cleCommande("PO-0002"));
  });
  it("ignore les zéros de tête d'un code couleur numérique", () => {
    expect(cleCouleur("006")).toBe(cleCouleur("6"));
    expect(cleCouleur("06")).toBe(cleCouleur("6"));
  });
  it("laisse un code couleur alphabétique intact", () => {
    expect(cleCouleur("sss")).toBe("SSS");
    expect(cleCouleur("SSS")).not.toBe(cleCouleur("000"));
  });
});

describe("niveau commande", () => {
  it("signale une commande TIO jamais saisie dans Texas", () => {
    const r = comparer([T({ tailles: { M: 2 } })], []);
    expect(r.synthese.commandesManquantes).toBe(1);
    expect(r.commandes[0].statut).toBe("manquante_texas");
    expect(r.commandes[0].anomalies[0]).toMatch(/jamais saisie/);
  });

  it("signale une commande Texas qui n'existe pas dans TIO", () => {
    const r = comparer([], [T({ tailles: { M: 2 } })]);
    expect(r.synthese.commandesEnTrop).toBe(1);
    expect(r.commandes[0].statut).toBe("en_trop_texas");
  });

  it("déclare conforme une commande identique des deux côtés", () => {
    const l = T({ tailles: { S: 1, M: 2, L: 3 } });
    const r = comparer([l], [{ ...l, numeroTexas: "CC-900" }]);
    expect(r.commandes[0].statut).toBe("ok");
    expect(r.commandes[0].anomalies).toEqual([]);
    expect(r.commandes[0].numeroTexas).toBe("CC-900");
    expect(r.synthese.tauxConformite).toBe(100);
  });

  it("compte les pièces de chaque côté", () => {
    const r = comparer([T({ tailles: { M: 5 } })], [T({ tailles: { M: 3 } })]);
    expect(r.synthese.piecesTio).toBe(5);
    expect(r.synthese.piecesTexas).toBe(3);
    expect(r.commandes[0].anomalies[0]).toMatch(/2 pièces en moins/);
  });

  it("signale un code client différent sur la même commande", () => {
    const r = comparer(
      [T({ tailles: { M: 1 }, codeClient: "LEKO097" })],
      [T({ tailles: { M: 1 }, codeClient: "AUTRE01" })]
    );
    expect(r.commandes[0].anomalies.join()).toMatch(/code client différent/);
    expect(r.commandes[0].statut).toBe("ecart");
  });

  it("ne signale pas un code client écrit avec un séparateur différent", () => {
    const r = comparer(
      [T({ tailles: { M: 1 }, codeClient: "LE KO097" })],
      [T({ tailles: { M: 1 }, codeClient: "LEKO097" })]
    );
    expect(r.commandes[0].statut).toBe("ok");
  });

  it("rapproche malgré des séparateurs différents dans le n° de commande", () => {
    const r = comparer(
      [T({ numeroTio: "IS-26 0014", tailles: { M: 1 } })],
      [T({ numeroTio: "IS260014", tailles: { M: 1 } })]
    );
    expect(r.synthese.commandesCommunes).toBe(1);
    expect(r.commandes[0].statut).toBe("ok");
  });

  it("isole les lignes Texas sans référence TIO au lieu de les dire conformes", () => {
    const r = comparer(
      [T({ tailles: { M: 1 } })],
      [T({ tailles: { M: 1 } }), T({ numeroTio: "", numeroTexas: "CC-901", tailles: { L: 4 } })]
    );
    const orphelines = r.commandes.find((c) => c.numeroTio === "(sans référence TIO)");
    expect(orphelines).toBeDefined();
    expect(orphelines!.piecesTexas).toBe(4);
    expect(orphelines!.anomalies[0]).toMatch(/sans « Référence commande client »/);
    expect(r.synthese.commandesEnTrop).toBe(1);
  });

  it("peut ignorer les commandes soldées côté Texas", () => {
    const tio = [T({ tailles: { M: 1 } })];
    const texas = [T({ tailles: { M: 1 }, soldee: true })];
    expect(comparer(tio, texas).commandes[0].statut).toBe("ok");
    const r = comparer(tio, texas, { ignorerSoldees: true });
    expect(r.commandes[0].statut).toBe("manquante_texas");
  });

  it("calcule le taux de conformité sur le total des commandes TIO", () => {
    const r = comparer(
      [
        T({ numeroTio: "PO-1", tailles: { M: 1 } }),
        T({ numeroTio: "PO-2", tailles: { M: 1 } }),
        T({ numeroTio: "PO-3", tailles: { M: 1 } }),
        T({ numeroTio: "PO-4", tailles: { M: 1 } }),
      ],
      [T({ numeroTio: "PO-1", tailles: { M: 1 } }), T({ numeroTio: "PO-2", tailles: { M: 1 } })]
    );
    expect(r.synthese.tauxConformite).toBe(50);
  });

  it("classe les commandes manquantes en premier", () => {
    const r = comparer(
      [T({ numeroTio: "PO-1", tailles: { M: 1 } }), T({ numeroTio: "PO-2", tailles: { M: 1 } })],
      [T({ numeroTio: "PO-1", tailles: { M: 1 } })]
    );
    expect(r.commandes[0].numeroTio).toBe("PO-2");
    expect(r.commandes[0].statut).toBe("manquante_texas");
  });
});

describe("niveau produit", () => {
  it("signale un produit commandé dans TIO et absent de Texas", () => {
    const r = comparer(
      [T({ tailles: { M: 2 } }), T({ reference: "RMTEE_W002", tailles: { L: 3 } })],
      [T({ tailles: { M: 2 } })]
    );
    const manquant = r.lignes.find((l) => l.reference === "RMTEE_W002")!;
    expect(manquant.statut).toBe("manquante_texas");
    expect(manquant.piecesTexas).toBe(0);
    expect(r.commandes[0].anomalies.join()).toMatch(/1 produit\(s\) absent\(s\) de Texas/);
  });

  it("signale un produit saisi dans Texas et absent de la commande TIO", () => {
    const r = comparer(
      [T({ tailles: { M: 2 } })],
      [T({ tailles: { M: 2 } }), T({ reference: "RMTEE_W002", tailles: { L: 3 } })]
    );
    expect(r.lignes.find((l) => l.reference === "RMTEE_W002")!.statut).toBe("en_trop_texas");
    expect(r.synthese.lignesEnTrop).toBe(1);
  });

  it("ne détaille PAS les produits d'une commande absente d'un côté", () => {
    const r = comparer([T({ tailles: { M: 2 } })], []);
    expect(r.lignes).toEqual([]);
  });

  it("signale un écart de quantité", () => {
    const r = comparer([T({ tailles: { M: 5 } })], [T({ tailles: { M: 3 } })]);
    expect(r.lignes[0].statut).toBe("ecart_pieces");
    expect(r.lignes[0].anomalies[0]).toMatch(/2 pièces en moins/);
  });

  it("attrape le cas traître : même total, répartition des tailles différente", () => {
    const r = comparer(
      [T({ tailles: { S: 1, M: 2, L: 3 } })],
      [T({ tailles: { S: 3, M: 2, L: 1 } })]
    );
    expect(r.lignes[0].statut).toBe("ecart_tailles");
    expect(r.lignes[0].piecesTio).toBe(6);
    expect(r.lignes[0].piecesTexas).toBe(6);
    expect(r.lignes[0].tailles).toEqual([
      { taille: "S", tio: 1, texas: 3 },
      { taille: "L", tio: 3, texas: 1 },
    ]);
    expect(r.commandes[0].statut).toBe("ecart");
  });

  it("rapproche un coloris écrit 006 d'un coloris écrit 6", () => {
    const r = comparer(
      [T({ codeCouleur: "006", tailles: { M: 2 } })],
      [T({ codeCouleur: "6", tailles: { M: 2 } })]
    );
    expect(r.lignes[0].statut).toBe("ok");
    expect(r.synthese.lignesConformes).toBe(1);
  });

  it("rapproche un coloris écrit « 000 » d'un côté et « SSS » de l'autre", () => {
    // 9 produits sortaient « absents de Texas » et 9 « en trop » faute de cette tolérance :
    // c'étaient les mêmes lignes, ZZZ_LOGO et QMCHEC_C999, écrites 000 côté TIO et SSS côté Texas.
    const r = comparer(
      [T({ codeCouleur: "000", tailles: { TU: 1 } })],
      [T({ codeCouleur: "SSS", codeCouleurCanonique: "000", tailles: { TU: 1 } })]
    );
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].statut).toBe("ok");
    expect(r.synthese.lignesManquantes).toBe(0);
    expect(r.synthese.lignesEnTrop).toBe(0);
  });

  it("garde le code d'origine à l'affichage, même rapproché par équivalence", () => {
    const r = comparer(
      [T({ codeCouleur: "000", tailles: { TU: 2 } })],
      [T({ codeCouleur: "SSS", codeCouleurCanonique: "000", tailles: { TU: 1 } })]
    );
    expect(r.lignes[0].codeCouleur).toBe("000");
    expect(r.lignes[0].statut).toBe("ecart_pieces");
  });

  it("ne rapproche pas deux coloris sans équivalence déclarée", () => {
    const r = comparer(
      [T({ codeCouleur: "208", tailles: { M: 1 } })],
      [T({ codeCouleur: "714", tailles: { M: 1 } })]
    );
    expect(r.lignes).toHaveLength(2);
    expect(r.synthese.lignesManquantes).toBe(1);
    expect(r.synthese.lignesEnTrop).toBe(1);
  });

  it("additionne un produit réparti sur plusieurs lignes du même fichier", () => {
    const r = comparer(
      [T({ tailles: { M: 2 } }), T({ tailles: { L: 3 } })],
      [T({ tailles: { M: 2, L: 3 } })]
    );
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].statut).toBe("ok");
  });

  it("compare au total seulement quand un côté ne décode pas les tailles", () => {
    const r = comparer([L({ pieces: 6 })], [T({ tailles: { S: 1, M: 2, L: 3 } })]);
    expect(r.lignes[0].taillesComparables).toBe(false);
    expect(r.lignes[0].statut).toBe("ok");
    expect(r.synthese.taillesNonComparables).toBe(1);
    expect(r.synthese.taillesComparees).toBe(0);
  });

  it("ne prétend pas connaître les tailles d'un produit partiellement décodé", () => {
    const r = comparer(
      [T({ tailles: { M: 2 } }), L({ pieces: 3 })],
      [T({ tailles: { M: 5 } })]
    );
    expect(r.lignes[0].taillesComparables).toBe(false);
    expect(r.lignes[0].piecesTio).toBe(5);
    expect(r.lignes[0].statut).toBe("ok");
  });
});

describe("montants", () => {
  it("ne somme pas un montant répété sur chaque ligne de la commande", () => {
    const r = comparer(
      [
        T({ tailles: { M: 2 }, montantCommande: 1000 }),
        T({ reference: "RMTEE_W002", tailles: { L: 3 }, montantCommande: 1000 }),
      ],
      [
        T({ tailles: { M: 2 }, montantCommande: 1000 }),
        T({ reference: "RMTEE_W002", tailles: { L: 3 }, montantCommande: 1000 }),
      ]
    );
    expect(r.commandes[0].montantTio).toBe(1000);
    expect(r.synthese.montantTio).toBe(1000);
    expect(r.commandes[0].statut).toBe("ok");
  });

  it("somme les montants donnés à la ligne", () => {
    const r = comparer(
      [
        T({ tailles: { M: 2 }, montantLigne: 59.9 }),
        T({ reference: "RMTEE_W002", tailles: { L: 3 }, montantLigne: 40.1 }),
      ],
      [T({ tailles: { M: 2 }, montantCommande: 100 }), T({ reference: "RMTEE_W002", tailles: { L: 3 } })]
    );
    expect(r.commandes[0].montantTio).toBe(100);
    expect(r.commandes[0].statut).toBe("ok");
  });

  it("signale un écart de montant", () => {
    const r = comparer(
      [T({ tailles: { M: 2 }, montantCommande: 1000 })],
      [T({ tailles: { M: 2 }, montantCommande: 955.5 })]
    );
    expect(r.commandes[0].statut).toBe("ecart");
    expect(r.commandes[0].anomalies[0]).toMatch(/montant −44,50 €/);
  });

  it("respecte la tolérance demandée", () => {
    const tio = [T({ tailles: { M: 2 }, montantCommande: 1000 })];
    const texas = [T({ tailles: { M: 2 }, montantCommande: 1000.4 })];
    expect(comparer(tio, texas).commandes[0].statut).toBe("ecart");
    expect(comparer(tio, texas, { toleranceMontant: 0.5 }).commandes[0].statut).toBe("ok");
  });

  it("déclare les montants non comparables quand un fichier n'en porte pas", () => {
    const r = comparer(
      [T({ tailles: { M: 2 } })],
      [T({ tailles: { M: 2 }, montantCommande: 1000 })]
    );
    expect(r.synthese.montantComparable).toBe(false);
    expect(r.commandes[0].montantTio).toBeNull();
    expect(r.commandes[0].montantTexas).toBe(1000);
    expect(r.commandes[0].statut).toBe("ok");
  });
});

describe("rapport Excel", () => {
  const r = comparer(
    [T({ tailles: { S: 1, M: 2 }, montantCommande: 500 })],
    [T({ tailles: { S: 2, M: 2 }, montantCommande: 540 })]
  );
  const feuilles = rapportVersFeuilles(r, {
    fichierTio: "tio.xlsx",
    fichierTexas: "texas.xlsx",
    genereLe: "12/11/2026 10:00",
  });

  it("produit les quatre feuilles attendues", () => {
    expect(feuilles.map((f) => f.nom)).toEqual(["Synthèse", "Commandes", "Produits", "Tailles"]);
  });

  it("rappelle les deux fichiers comparés", () => {
    const plat = feuilles[0].lignes.flat().join(" ");
    expect(plat).toContain("tio.xlsx");
    expect(plat).toContain("texas.xlsx");
  });

  it("donne l'écart de montant signé", () => {
    const entetes = feuilles[1].lignes[0] as string[];
    const i = entetes.indexOf("Écart montant");
    expect(feuilles[1].lignes[1][i]).toBe(40);
  });

  it("détaille une ligne par taille en écart", () => {
    expect(feuilles[3].lignes).toHaveLength(2); // en-tête + la taille S
    expect(feuilles[3].lignes[1]).toContain("S");
  });

  it("avertit quand les montants ne sont pas comparables", () => {
    const sansMontant = rapportVersFeuilles(
      comparer([T({ tailles: { M: 1 } })], [T({ tailles: { M: 1 } })]),
      { fichierTio: "a", fichierTexas: "b", genereLe: "x" }
    );
    expect(sansMontant[0].lignes.flat().join(" ")).toMatch(/non comparables/);
  });
});
