import { describe, it, expect } from "vitest";
import {
  buildComparison,
  totauxComparaison,
  nomsProches,
  normLabel,
  type SourceAgg,
} from "./source-comparison";

const a = (
  source: "TIO" | "TEXAS",
  id: string,
  label: string,
  pieces: number,
  amount = pieces * 10
): SourceAgg => ({ source, id, label, orders: 1, lines: 1, pieces, amount });

describe("comparaison TIO / Texas — croisement", () => {
  const rows = buildComparison([
    a("TIO", "c1", "MCS Romans", 100),
    a("TEXAS", "c1", "MCS Romans", 90),
    a("TIO", "c2", "BRANDS CORNER", 182),
    a("TEXAS", "c3", "BJB SAS / BRANDS CORNER", 182),
    a("TIO", "c4", "Numéro 28", 340),
  ]);

  it("réunit les deux sources sur un même identifiant", () => {
    const romans = rows.find((r) => r.id === "c1")!;
    expect(romans.tio.pieces).toBe(100);
    expect(romans.texas.pieces).toBe(90);
    expect(romans.presence).toBe("deux");
  });

  it("l'écart est TEXAS − TIO : négatif quand TIO en porte plus", () => {
    expect(rows.find((r) => r.id === "c1")!.ecartPieces).toBe(-10);
  });

  it("qualifie la présence d'un seul côté", () => {
    expect(rows.find((r) => r.id === "c2")!.presence).toBe("tio");
    expect(rows.find((r) => r.id === "c3")!.presence).toBe("texas");
  });

  it("trie par écart décroissant en valeur absolue", () => {
    // Numéro 28 (340), puis les deux à 182 — départagées par le libellé pour que deux
    // exécutions rendent toujours le même ordre — puis Romans (10).
    expect(rows.map((r) => r.label)).toEqual([
      "Numéro 28",
      "BJB SAS / BRANDS CORNER",
      "BRANDS CORNER",
      "MCS Romans",
    ]);
  });

  it("cumule les deux côtés", () => {
    const t = totauxComparaison(rows);
    expect(t.tio.pieces).toBe(622); // 100 + 182 + 340
    expect(t.texas.pieces).toBe(272); // 90 + 182
  });
});

// 🔴 Cas réel AH26 : la même boutique porte DEUX fiches client selon la source.
describe("comparaison TIO / Texas — fiches en double", () => {
  it("rapproche deux libellés voisins présents chacun d'un seul côté", () => {
    const rows = buildComparison([
      a("TIO", "c2", "BRANDS CORNER", 182),
      a("TEXAS", "c3", "BJB SAS / BRANDS CORNER", 182),
    ]);
    expect(rows.find((r) => r.id === "c2")!.ressemble).toBe("BJB SAS / BRANDS CORNER");
    expect(rows.find((r) => r.id === "c3")!.ressemble).toBe("BRANDS CORNER");
  });

  it("ne rapproche PAS deux lignes présentes des deux côtés", () => {
    const rows = buildComparison([
      a("TIO", "c1", "CLASSIC STOCK TALANGE", 10),
      a("TEXAS", "c1", "CLASSIC STOCK TALANGE", 10),
      a("TIO", "c2", "CLASSIC STOCK TALANGE MCS", 5),
      a("TEXAS", "c2", "CLASSIC STOCK TALANGE MCS", 5),
    ]);
    expect(rows.every((r) => r.ressemble === undefined)).toBe(true);
  });

  it("distingue le nom identique de la simple ressemblance", () => {
    const rows = buildComparison([
      a("TIO", "c1", "TERRITOIRE D'HOMME - DOLE", 10),
      a("TEXAS", "c2", "TERRITOIRE D'HOMME - DOLE", 12),
      a("TIO", "c3", "BRANDS CORNER", 5),
      a("TEXAS", "c4", "BJB SAS / BRANDS CORNER", 5),
    ]);
    expect(rows.find((r) => r.id === "c1")!.ressembleExact).toBe(true);
    expect(rows.find((r) => r.id === "c3")!.ressembleExact).toBeUndefined();
    expect(rows.find((r) => r.id === "c3")!.ressemble).toBe("BJB SAS / BRANDS CORNER");
  });

  it("n'apparie une jumelle qu'une seule fois", () => {
    // Trois fiches homonymes côté TIO pour une seule côté Texas.
    const rows = buildComparison([
      a("TIO", "c1", "MACASSAR", 10),
      a("TIO", "c2", "MACASSAR", 8),
      a("TEXAS", "c3", "MACASSAR", 12),
    ]);
    const appariees = rows.filter((r) => r.ressemble);
    expect(appariees).toHaveLength(2); // une paire, pas trois lignes qui se désignent
  });

  it("ne rapproche pas deux lignes du MÊME côté", () => {
    const rows = buildComparison([
      a("TIO", "c1", "CLASSIC STOCK TALANGE", 10),
      a("TIO", "c2", "CLASSIC STOCK TALANGE MCS", 5),
    ]);
    expect(rows.every((r) => r.ressemble === undefined)).toBe(true);
  });
});

describe("noms proches", () => {
  it("reconnaît un nom inclus dans l'autre", () => {
    expect(nomsProches("CLASSIC STOCK TALANGE", "Classic stock Talange MCS")).toBe(true);
    expect(nomsProches("BRANDS CORNER", "BJB SAS / BRANDS CORNER")).toBe(true);
  });

  it("ignore la casse, les accents et la ponctuation", () => {
    expect(nomsProches("Numéro 28", "NUMERO  28")).toBe(true);
  });

  it("ne confond pas deux boutiques d'une même enseigne", () => {
    expect(nomsProches("LE KORNER - Saint-Leu", "LE KORNER - Saint-Paul")).toBe(false);
    expect(nomsProches("MCS Romans", "MCS Roubaix")).toBe(false);
  });

  it("se tait quand il n'y a pas de mot signifiant", () => {
    expect(nomsProches("MPL", "MCS")).toBe(false);
    expect(nomsProches("", "BRANDS CORNER")).toBe(false);
  });

  it("refuse un rapprochement sur un seul mot générique", () => {
    expect(nomsProches("MCS", "MCS Romans")).toBe(false);
  });

  it("garde le mot court qui distingue", () => {
    // « LEU » et « PAUL » sont ce qui sépare ces deux boutiques.
    expect(nomsProches("LE KORNER Saint Leu", "LE KORNER Saint Paul")).toBe(false);
  });

  it("normalise proprement", () => {
    expect(normLabel("  Le Korner — Saint-Leu ")).toBe("LE KORNER SAINT LEU");
  });
});
