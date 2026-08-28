import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseConditionalFile, computeBalance, summarize, invoiceAmount,
  lineKey, normReference, normColor, normSize,
  type ConditionalStoredLine,
} from "./conditional";

function xlsx(rows: (string | number | null)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "F");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("conditionnelle — lecture des fichiers clients", () => {
  it("lit un fichier EAN + quantité", () => {
    const lines = parseConditionalFile(xlsx([
      ["EAN", "Quantité"],
      ["3665249648641", 3],
      ["3665249648658", 1],
    ]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ ean: "3665249648641", quantity: 3 });
  });

  it("lit un fichier référence + couleur + taille", () => {
    const lines = parseConditionalFile(xlsx([
      ["Référence", "Code couleur", "Taille", "Qté"],
      ["CCAH26-CH07", "752-Bleu marine", "M", 2],
    ]));
    expect(lines[0]).toMatchObject({ reference: "CCAH26-CH07", size: "M", quantity: 2 });
  });

  it("trouve l'en-tête même s'il n'est pas en 1re ligne", () => {
    const lines = parseConditionalFile(xlsx([
      ["Relevé de ventes — TALANGE", null, null],
      [null, null, null],
      ["EAN", "Taille", "Quantité"],
      ["3665249648641", "L", 5],
    ]));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(5);
  });

  it("ignore les quantités nulles et les lignes TOTAL", () => {
    const lines = parseConditionalFile(xlsx([
      ["Référence", "Quantité"],
      ["REF_A", 4],
      ["REF_B", 0],
      ["TOTAL", 4],
    ]));
    expect(lines.map((l) => l.reference)).toEqual(["REF_A"]);
  });

  it("rejette un fichier sans quantité ni identifiant", () => {
    expect(parseConditionalFile(xlsx([["Client", "Ville"], ["X", "Y"]]))).toEqual([]);
  });
});

describe("conditionnelle — normalisation des clés", () => {
  it("aligne les écritures d'un même produit", () => {
    expect(normReference("ccah26-ch07")).toBe("CCAH26_CH07");
    expect(normColor("752-Bleu marine")).toBe("752");
    expect(normSize(" m ")).toBe("M");
    // Le même produit écrit de deux façons doit tomber sur la MÊME clé
    expect(lineKey("CCAH26-CH07", "752-Bleu marine", "m")).toBe(lineKey("ccah26_ch07", "752", "M"));
  });
});

describe("conditionnelle — solde", () => {
  const L = (type: "LIVRAISON" | "VENTE" | "RETOUR", ref: string, size: string, q: number): ConditionalStoredLine =>
    ({ type, productId: "p_" + ref, ean: null, reference: ref, color: "999", size, quantity: q });

  it("solde = livré − vendu − rendu, et se cumule sur plusieurs imports", () => {
    const rows = computeBalance([
      L("LIVRAISON", "A", "M", 10),
      L("LIVRAISON", "A", "M", 5), // recomplément
      L("VENTE", "A", "M", 4),
      L("VENTE", "A", "M", 3), // 2e déclaration mensuelle
      L("RETOUR", "A", "M", 8),
    ]);
    expect(rows[0]).toMatchObject({ delivered: 15, sold: 7, returned: 8, remaining: 0 });
  });

  it("repère un produit déclaré mais JAMAIS livré", () => {
    const rows = computeBalance([L("LIVRAISON", "A", "M", 5), L("VENTE", "B", "L", 2)]);
    const b = rows.find((r) => r.reference === "B")!;
    expect(b.neverDelivered).toBe(true);
    expect(b.remaining).toBe(-2);
  });

  it("repère une sur-déclaration (plus vendu que livré)", () => {
    const rows = computeBalance([L("LIVRAISON", "A", "M", 3), L("VENTE", "A", "M", 5)]);
    expect(rows[0].remaining).toBe(-2);
    expect(rows[0].neverDelivered).toBe(false);
  });

  it("résume l'opération et compte les anomalies", () => {
    const s = summarize(computeBalance([
      L("LIVRAISON", "A", "M", 10), L("VENTE", "A", "M", 4),   // reste 6
      L("LIVRAISON", "B", "L", 5), L("VENTE", "B", "L", 7),    // sur-déclaré de 2
      L("VENTE", "C", "S", 3),                                  // jamais livré
    ]));
    expect(s).toMatchObject({
      delivered: 15, sold: 14, returned: 0,
      neverDeliveredLines: 1, neverDeliveredPieces: 3,
      overDeclaredLines: 2, overDeclaredPieces: 5, // B (-2) et C (-3)
      openLines: 1,
    });
  });

  it("un retour qui solde tout laisse 0 ligne ouverte", () => {
    const s = summarize(computeBalance([
      L("LIVRAISON", "A", "M", 10), L("VENTE", "A", "M", 6), L("RETOUR", "A", "M", 4),
    ]));
    expect(s.remaining).toBe(0);
    expect(s.openLines).toBe(0);
  });
});

describe("conditionnelle — montant à facturer", () => {
  it("valorise les ventes au prix de gros", () => {
    const rows = computeBalance([
      { type: "LIVRAISON", productId: "p1", ean: null, reference: "A", color: "999", size: "M", quantity: 10 },
      { type: "VENTE", productId: "p1", ean: null, reference: "A", color: "999", size: "M", quantity: 4 },
    ]);
    expect(invoiceAmount(rows, { p1: 25 })).toEqual({ pieces: 4, amount: 100, piecesWithoutPrice: 0 });
  });

  it("signale les pièces sans prix", () => {
    const rows = computeBalance([
      { type: "VENTE", productId: null, ean: null, reference: "X", color: "999", size: "M", quantity: 3 },
    ]);
    expect(invoiceAmount(rows, {})).toMatchObject({ pieces: 3, amount: 0, piecesWithoutPrice: 3 });
  });
});
