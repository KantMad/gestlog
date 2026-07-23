import * as XLSX from "xlsx";

// ─── Fichier d'intégration CC ────────────────────────────────────────────────
// Transforme un export « EAN / BL » (format Texas, ~77 colonnes, en-tête ligne 0) en
// « fichier d'intégration » client (14 colonnes), UN FICHIER PAR N° DE DOCUMENT.
//
// Les colonnes source sont repérées PAR NOM (l'ordre peut varier d'un export à l'autre).
// Fonctions PURES (pas de DB, pas de réseau) → testables et utilisables côté écran.

export interface IntegrationSourceLine {
  documentNumber: string; // « N° Document » (143161…)
  season: string; // « Saison Document » (W26)
  brand: string; // « Libellé marque » (Country Classic / MCS)
  reference: string; // « Code Produit Fini »
  designation: string; // « Libellé 1 Produit Fini »
  size: string; // « Taille »
  colorLabel: string; // « Libellé Coloris »
  ean: string; // « Code Barre »
  price: number; // « Prix du Document » (repli « Prix Unitaire »)
  quantity: number; // « Qté »
  family: string; // « Libellé famille statistique »
  composition: string; // « Composition »
  clientCode: string; // « Code Client »
  clientName: string; // « Raison sociale Client »
}

/** En-têtes du fichier produit, dans l'ordre exact attendu par le client. */
export const INTEGRATION_HEADERS = [
  "fournisseur",
  "Code Article",
  "Désignation",
  "taille",
  "coloris",
  "EAN",
  "prix de revient HT",
  "Prix de vente TTC",
  "secteur",
  "saison",
  "code modele",
  "famille d'article",
  "matiere",
  "Quantité",
] as const;

/** Valeur constante de la colonne « secteur » (prêt-à-porter). */
export const SECTEUR = "PAP";

export type IntegrationRow = Record<string, string | number | null>;

export interface IntegrationDocument {
  documentNumber: string;
  clientCode: string;
  clientName: string;
  rows: IntegrationRow[];
  totalQuantity: number;
}

type Cell = string | number | boolean | null | undefined;

const norm = (v: Cell): string => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: Cell): string => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");

const num = (v: Cell): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Les exports Texas écrivent parfois les nombres en texte, avec virgule décimale.
  const n = parseFloat(norm(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse l'export source. Les colonnes sont trouvées par NOM (insensible à la casse,
 * aux accents d'espacement et à la ponctuation) → robuste au réordonnancement.
 * Les lignes sans référence ou sans quantité > 0 sont ignorées.
 */
export function parseIntegrationSource(buffer: ArrayBuffer): IntegrationSourceLine[] {
  const wb = XLSX.read(buffer, { type: "array" });
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (grid.length < 2) continue;

    const header = (grid[0] || []).map(key);
    const col = (...names: string[]) => {
      for (const n of names) {
        const i = header.indexOf(key(n));
        if (i >= 0) return i;
      }
      return -1;
    };

    const cDoc = col("N° Document", "No Document", "Numéro Document");
    const cRef = col("Code Produit Fini");
    if (cDoc < 0 || cRef < 0) continue; // pas le bon format → feuille suivante

    const cSeason = col("Saison Document", "Saison Produit fini");
    const cBrand = col("Libellé marque");
    const cDesig = col("Libellé 1 Produit Fini");
    const cSize = col("Taille");
    const cColor = col("Libellé Coloris");
    const cEan = col("Code Barre");
    // « le prix du document et aucun autre » — repli sur le prix unitaire si absent.
    const cPrice = col("Prix du Document");
    const cUnit = col("Prix Unitaire");
    const cQty = col("Qté", "Qte", "Quantité");
    const cFamily = col("Libellé famille statistique");
    const cCompo = col("Composition");
    const cClient = col("Code Client");
    const cClientName = col("Raison sociale Client");

    const lines: IntegrationSourceLine[] = [];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const reference = norm(row[cRef]);
      const documentNumber = norm(row[cDoc]);
      if (!reference || !documentNumber) continue;
      const quantity = num(row[cQty]);
      if (quantity <= 0) continue;

      const priceRaw = cPrice >= 0 ? num(row[cPrice]) : 0;
      lines.push({
        documentNumber,
        season: cSeason >= 0 ? norm(row[cSeason]) : "",
        brand: cBrand >= 0 ? norm(row[cBrand]) : "",
        reference,
        designation: cDesig >= 0 ? norm(row[cDesig]) : "",
        size: cSize >= 0 ? norm(row[cSize]) : "",
        colorLabel: cColor >= 0 ? norm(row[cColor]) : "",
        ean: cEan >= 0 ? norm(row[cEan]) : "",
        price: priceRaw > 0 ? priceRaw : cUnit >= 0 ? num(row[cUnit]) : 0,
        quantity,
        family: cFamily >= 0 ? norm(row[cFamily]) : "",
        composition: cCompo >= 0 ? norm(row[cCompo]) : "",
        clientCode: cClient >= 0 ? norm(row[cClient]) : "",
        clientName: cClientName >= 0 ? norm(row[cClientName]) : "",
      });
    }
    if (lines.length) return lines;
  }
  return [];
}

/**
 * Regroupe les lignes en documents (un fichier par « N° Document »), en ne gardant que
 * les marques demandées. `brands` vide = toutes les marques.
 */
export function buildIntegrationDocuments(
  lines: IntegrationSourceLine[],
  brands: string[] = []
): IntegrationDocument[] {
  const wanted = new Set(brands.map((b) => key(b)));
  const kept = wanted.size > 0 ? lines.filter((l) => wanted.has(key(l.brand))) : lines;

  const byDoc = new Map<string, IntegrationDocument>();
  for (const l of kept) {
    let doc = byDoc.get(l.documentNumber);
    if (!doc) {
      doc = {
        documentNumber: l.documentNumber,
        clientCode: l.clientCode,
        clientName: l.clientName,
        rows: [],
        totalQuantity: 0,
      };
      byDoc.set(l.documentNumber, doc);
    }
    doc.rows.push({
      fournisseur: l.brand,
      "Code Article": l.reference,
      Désignation: l.designation,
      taille: l.size,
      coloris: l.colorLabel,
      EAN: l.ean,
      "prix de revient HT": l.price,
      "Prix de vente TTC": null,
      secteur: SECTEUR,
      saison: l.season,
      "code modele": null,
      "famille d'article": l.family,
      matiere: l.composition,
      Quantité: l.quantity,
    });
    doc.totalQuantity += l.quantity;
  }

  return [...byDoc.values()].sort((a, b) => a.documentNumber.localeCompare(b.documentNumber));
}

/** Nom du fichier généré : « Fichier intégration TALANGE 142426.xlsx ». */
export function integrationFileName(documentNumber: string, city: string): string {
  // On retire les caractères interdits dans un nom de fichier, sans toucher aux accents.
  const clean = (s: string) => norm(s).replace(/[\\/:*?"<>|]/g, "").trim();
  const parts = ["Fichier intégration", clean(city), clean(documentNumber)].filter(Boolean);
  return `${parts.join(" ")}.xlsx`;
}
