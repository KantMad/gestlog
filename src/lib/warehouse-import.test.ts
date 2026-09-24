import { describe, it, expect } from "vitest";
import {
  splitWarehouseRows,
  parseFrDate,
  tioOrderFromFileName,
  docTypeFromFileName,
  warehouseSeasonCode,
  type Row,
} from "./warehouse-import";

// Colonnes réelles de l'export Texas « CodesBarres_Livraison ».
const l = (doc: string, ref: string, qte: number, extra: Row = {}): Row => ({
  "N° Document": doc,
  "Saison Document": "W26",
  "Code Client": "MCSRU09201",
  "Raison sociale Client": "MCSRUEIL-MALMAISON",
  "Libellé marque": "MCS",
  "Date livraison": "17/09/2026",
  "Date préparation": "15/09/2026",
  "Type Traitement": "LIV",
  "Prix du Document": 109.67,
  "Code Produit Fini": ref,
  "Code Coloris": "213",
  Taille: "L",
  "Code Barre": "3665249654451",
  "Qté": qte,
  "Prix Unitaire": 329,
  "N° Ligne": "300",
  ...extra,
});

describe("import entrepôt — découpage par document", () => {
  // 🔴 Le défaut que ce module corrige : un fichier de plusieurs documents devenait UN
  // document portant le premier numéro.
  const rows = [
    l("144524", "AMBAGS_P006", 1),
    l("144509", "RMPOML_C001", 4, { "Raison sociale Client": "LE VESTIAIRE", "Code Client": "LEVES00301" }),
    l("144524", "RMCHML_C001", 2),
  ];
  const { documents, ignored } = splitWarehouseRows(rows, { docType: "BL" });

  it("rend un document par « N° Document », et non un seul", () => {
    expect(documents).toHaveLength(2);
    expect(documents.map((d) => d.documentNumber)).toEqual(["144509", "144524"]);
    expect(ignored).toBe(0);
  });

  it("rattache chaque ligne à SON document", () => {
    const d = documents.find((x) => x.documentNumber === "144524")!;
    expect(d.lines.map((x) => x.reference)).toEqual(["AMBAGS_P006", "RMCHML_C001"]);
    expect(d.totalQuantity).toBe(3);
  });

  it("lit l'en-tête sur la première ligne DU document, pas du fichier", () => {
    const d = documents.find((x) => x.documentNumber === "144509")!;
    expect(d.clientName).toBe("LE VESTIAIRE");
    expect(d.clientCode).toBe("LEVES00301");
  });

  it("ne perd aucune pièce", () => {
    const total = documents.reduce((n, d) => n + d.totalQuantity, 0);
    expect(total).toBe(rows.reduce((n, r) => n + Number(r["Qté"]), 0));
  });

  it("compte les lignes sans numéro de document au lieu de les rattacher au hasard", () => {
    const r = splitWarehouseRows([l("1", "A", 1), { ...l("", "B", 5), "N° Document": null }], {
      docType: "BL",
    });
    expect(r.ignored).toBe(1);
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0].totalQuantity).toBe(1);
  });

  it("ordonne les documents de façon stable et numérique", () => {
    const r = splitWarehouseRows([l("1000", "A", 1), l("99", "B", 1), l("200", "C", 1)], {
      docType: "BL",
    });
    expect(r.documents.map((d) => d.documentNumber)).toEqual(["99", "200", "1000"]);
  });
});

describe("import entrepôt — champs du document", () => {
  it("lit les dates de livraison pour un BL", () => {
    const [d] = splitWarehouseRows([l("1", "A", 1)], { docType: "BL" }).documents;
    expect(d.documentDate?.toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(d.secondaryDate?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("bascule sur les dates de facture pour une FAC", () => {
    const row = l("1", "A", 1, { "Date facture": "20/09/2026", "Date valeur": "30/09/2026" });
    const [d] = splitWarehouseRows([row], { docType: "FAC" }).documents;
    expect(d.documentDate?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(d.secondaryDate?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("retient le type de traitement du document", () => {
    const [d] = splitWarehouseRows([l("1", "A", 1, { "Type Traitement": "LIC" })], {
      docType: "BL",
    }).documents;
    expect(d.treatment).toBe("LIC");
  });

  it("tolère une date absente ou mal formée", () => {
    expect(parseFrDate(null)).toBeNull();
    expect(parseFrDate("2026-09-17")).toBeNull();
    expect(parseFrDate("17/09/2026")?.getUTCDate()).toBe(17);
  });
});

describe("import entrepôt — informations portées par le nom de fichier", () => {
  it("extrait la commande TIO", () => {
    expect(tioOrderFromFileName("BL_IS-041940245113_137391.xlsx")).toBe("IS-041940245113");
    expect(tioOrderFromFileName("FAC_PO-123_25697.xlsx")).toBe("PO-123");
  });

  it("rend null quand le nom n'en porte pas — cas de l'export multi-documents", () => {
    expect(tioOrderFromFileName("CodesBarres_Livraison 7.xlsx")).toBeNull();
  });

  it("déduit le type du préfixe", () => {
    expect(docTypeFromFileName("FAC_x.xlsx")).toBe("FAC");
    expect(docTypeFromFileName("BL_x.xlsx")).toBe("BL");
    expect(docTypeFromFileName("CodesBarres_Livraison.xlsx")).toBe("BL");
  });
});

describe("saison GestLog → code saison entrepôt", () => {
  it("traduit AH en W et PE en S", () => {
    expect(warehouseSeasonCode("AH", 2026)).toBe("W26");
    expect(warehouseSeasonCode("PE", 2027)).toBe("S27");
  });

  it("garde deux chiffres pour les petites années", () => {
    expect(warehouseSeasonCode("PE", 2005)).toBe("S05");
  });

  it("tolère une casse inattendue", () => {
    expect(warehouseSeasonCode("pe", 2026)).toBe("S26");
  });
});
