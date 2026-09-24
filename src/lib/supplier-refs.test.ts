import { describe, it, expect } from "vitest";
import { normalizeKey, planSupplierRefImport, type SupplierRefRow } from "./supplier-refs";

// Les 27 fournisseurs de production sont écrits en capitales, sans accent.
const SUPPLIERS = [
  { code: "ENTEKS", name: "ENTEKS" },
  { code: "KATA", name: "KATA" },
  { code: "TGTEKSTIL", name: "TGTEKSTIL" },
];

const CATALOGUE = ["SMCHML_C025", "SMPTCH_C001", "THSPT5P_201"];

const plan = (rows: SupplierRefRow[]) =>
  planSupplierRefImport(rows, { suppliers: SUPPLIERS, catalogueRefs: CATALOGUE });

describe("correspondances fournisseur — rapprochement des codes", () => {
  it("rattache au fournisseur existant malgré la casse, les accents et les espaces", () => {
    const r = plan([
      { supplierCode: "Enteks", reference: "SMCHML_C025" },
      { supplierCode: " kata ", reference: "SMPTCH_C001" },
    ]);
    expect(r.newSuppliers).toEqual([]);
    expect(r.links.map((l) => l.supplierCode)).toEqual(["ENTEKS", "KATA"]);
    expect(r.rapprochements).toEqual([
      { fichier: "Enteks", base: "ENTEKS" },
      { fichier: "kata", base: "KATA" },
    ]);
  });

  it("crée le fournisseur vraiment absent, dans l'orthographe du fichier", () => {
    const r = plan([{ supplierCode: "NouvoTex", supplierName: "Nouvo Textile", reference: "SMCHML_C025" }]);
    expect(r.newSuppliers).toEqual([{ code: "NouvoTex", name: "Nouvo Textile" }]);
    expect(r.links[0].supplierCode).toBe("NouvoTex");
  });

  it("à défaut de nom, le code fait le nom", () => {
    expect(plan([{ supplierCode: "NouvoTex", reference: "SMCHML_C025" }]).newSuppliers[0].name).toBe(
      "NouvoTex"
    );
  });

  it("ne crée qu'une fois un fournisseur cité sur plusieurs lignes", () => {
    const r = plan([
      { supplierCode: "NouvoTex", reference: "SMCHML_C025" },
      { supplierCode: "NOUVOTEX", reference: "SMPTCH_C001" },
    ]);
    expect(r.newSuppliers).toHaveLength(1);
  });
});

describe("correspondances fournisseur — références", () => {
  it("retient l'orthographe du CATALOGUE quand la référence y figure", () => {
    const r = plan([{ supplierCode: "ENTEKS", reference: "smchml_c025" }]);
    expect(r.links[0].reference).toBe("SMCHML_C025");
    expect(r.unknownRefs).toEqual([]);
  });

  it("signale une référence inconnue sans la rejeter", () => {
    const r = plan([{ supplierCode: "ENTEKS", reference: "SMXXXX_999" }]);
    expect(r.unknownRefs).toEqual(["SMXXXX_999"]);
    expect(r.links).toHaveLength(1); // conservée : elle peut précéder la synchro TIO
  });

  it("relève une référence rattachée à deux fournisseurs", () => {
    const r = plan([
      { supplierCode: "ENTEKS", reference: "SMCHML_C025" },
      { supplierCode: "KATA", reference: "SMCHML_C025" },
    ]);
    expect(r.multiSupplier).toEqual([
      { reference: "SMCHML_C025", suppliers: ["ENTEKS", "KATA"] },
    ]);
    expect(r.links).toHaveLength(2); // le double sourcing est légitime
  });
});

describe("correspondances fournisseur — lignes fautives", () => {
  it("compte les doublons du fichier sans les réécrire", () => {
    const r = plan([
      { supplierCode: "ENTEKS", reference: "SMCHML_C025" },
      { supplierCode: "enteks", reference: "smchml_c025" },
    ]);
    expect(r.links).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it("désigne la ligne du tableur, en-tête compris", () => {
    const r = plan([
      { supplierCode: "ENTEKS", reference: "SMCHML_C025" },
      { supplierCode: "", reference: "SMPTCH_C001" },
      { supplierCode: "KATA", reference: "" },
    ]);
    expect(r.ignored).toEqual([
      { line: 3, reason: "code fournisseur manquant" },
      { line: 4, reason: "référence produit manquante" },
    ]);
  });

  it("passe une ligne entièrement vide sans la reprocher", () => {
    expect(plan([{ supplierCode: "", reference: "" }]).ignored).toEqual([]);
  });
});

describe("normalizeKey", () => {
  it("efface casse, accents et espaces superflus", () => {
    expect(normalizeKey("  Sté  Éntèks ")).toBe("STE ENTEKS");
  });
  it("supporte l'absence de valeur", () => {
    expect(normalizeKey(undefined as unknown as string)).toBe("");
  });
});

describe("correspondances fournisseur — fournisseurs qui se ressemblent", () => {
  // Cas réel de l'export Texas du 24/09/2026.
  it("signale une troncature d'un fournisseur existant sans la fusionner", () => {
    const r = planSupplierRefImport(
      [
        { supplierCode: "RASENTEKSTIL", reference: "SMPTCH_C001" },
        { supplierCode: "RASEN", reference: "SMCHML_C025" },
      ],
      { suppliers: [{ code: "RASENTEKSTIL", name: "RASENTEKSTIL" }], catalogueRefs: CATALOGUE }
    );
    expect(r.suspects).toEqual([{ fichier: "RASEN", ressemble: "RASENTEKSTIL" }]);
    // Signalé, pas corrigé : le lien est bien créé sous RASEN.
    expect(r.newSuppliers.map((s) => s.code)).toEqual(["RASEN"]);
  });

  it("repère aussi la troncature quand AUCUNE des deux formes n'est en base", () => {
    const r = planSupplierRefImport(
      [
        { supplierCode: "NOUVOTEXTILE", reference: "SMPTCH_C001" },
        { supplierCode: "NOUVO", reference: "SMCHML_C025" },
      ],
      { suppliers: [], catalogueRefs: CATALOGUE }
    );
    // Seul le plus court est signalé : c'est lui la troncature.
    expect(r.suspects).toEqual([{ fichier: "NOUVO", ressemble: "NOUVOTEXTILE" }]);
  });

  it("ne crie pas sur des codes courts qui partagent un début", () => {
    const r = planSupplierRefImport([{ supplierCode: "ABC", reference: "SMCHML_C025" }], {
      suppliers: [{ code: "ABCDEF", name: "ABCDEF" }],
      catalogueRefs: CATALOGUE,
    });
    expect(r.suspects).toEqual([]);
  });

  it("ne signale rien quand le fournisseur est franchement nouveau", () => {
    expect(plan([{ supplierCode: "ZARATEX", reference: "SMCHML_C025" }]).suspects).toEqual([]);
  });
});
