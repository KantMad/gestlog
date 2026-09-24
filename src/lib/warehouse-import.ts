// Découpage d'un fichier « CodesBarres » entrepôt en documents (BL / FAC).
//
// Deux chemins d'entrée utilisent ce module :
//   • la synchro FTP (n8n → /api/sync/shipments), un fichier par document ;
//   • l'import manuel (/shipments), un fichier contenant PLUSIEURS documents.
//
// 🔴 C'est le découpage qui compte. L'implémentation d'origine prenait l'en-tête sur la
// PREMIÈRE ligne et additionnait toutes les autres : un fichier de 475 documents serait
// devenu UN document de 63 679 pièces portant le premier numéro, sans message d'erreur.
// Ici, une ligne appartient au document que porte sa propre colonne « N° Document ».

export type Row = Record<string, unknown>;

export interface WarehouseLine {
  lineNo: string | null;
  reference: string | null;
  productLabel: string | null;
  colorCode: string | null;
  colorLabel: string | null;
  size: string | null;
  ean: string | null;
  quantity: number;
  unitPrice: number;
  parcelNo: string | null;
  location: string | null;
  statFamily: string | null;
  statSubFamily: string | null;
  orderRef: string | null;
  raw: Row;
}

export interface WarehouseDoc {
  docType: "BL" | "FAC";
  documentNumber: string;
  season: string | null;
  clientCode: string | null;
  clientName: string | null;
  brandLabel: string | null;
  documentDate: Date | null;
  secondaryDate: Date | null;
  documentTotal: number;
  totalQuantity: number;
  /** « Type Traitement » du document (LIV, LIC…) — homogène par document. */
  treatment: string | null;
  lines: WarehouseLine[];
}

export interface SplitResult {
  documents: WarehouseDoc[];
  /** Lignes sans « N° Document » : inexploitables, comptées et non rattachées. */
  ignored: number;
}

/** "02/12/2025" → Date (minuit UTC). Null si vide ou format inattendu. */
export function parseFrDate(s: unknown): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  // UTC minuit pour une date pure : sinon l'affichage en UTC recule d'un jour.
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

export function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

/**
 * Regroupe les lignes par « N° Document ».
 *
 * ⚠️ L'en-tête d'un document est lu sur sa PREMIÈRE ligne à lui, jamais sur la première
 * ligne du fichier. Les dates changent de colonne selon le type : `Date livraison` /
 * `Date préparation` pour un BL, `Date facture` / `Date valeur` pour une facture.
 *
 * ⚠️ `documentTotal` reprend la règle historique (le plus grand « Prix du Document » du
 * document) pour ne pas diverger des 5 030 documents déjà en base. *Cette colonne n'est
 * PAS un total : sur le document 143718, elle vaut au mieux 99,67 € pour 1 439 pièces —
 * c'est un prix à la ligne.* Le champ n'est lu nulle part dans l'application ; le
 * corriger demande de trancher quelle colonne fait foi.
 */
export function splitWarehouseRows(
  rows: Row[],
  { docType }: { docType: "BL" | "FAC" }
): SplitResult {
  const parNumero = new Map<string, Row[]>();
  let ignored = 0;

  for (const r of rows) {
    const n = str(r["N° Document"]);
    if (!n) {
      ignored++;
      continue;
    }
    const b = parNumero.get(n);
    if (b) b.push(r);
    else parNumero.set(n, [r]);
  }

  const documents: WarehouseDoc[] = [];
  for (const [documentNumber, rs] of parNumero) {
    const h = rs[0];
    documents.push({
      docType,
      documentNumber,
      season: str(h["Saison Document"]),
      clientCode: str(h["Code Client"]),
      clientName: str(h["Raison sociale Client"]),
      brandLabel: str(h["Libellé marque"]),
      documentDate: parseFrDate(docType === "FAC" ? h["Date facture"] : h["Date livraison"]),
      secondaryDate: parseFrDate(docType === "FAC" ? h["Date valeur"] : h["Date préparation"]),
      documentTotal: Math.max(0, ...rs.map((r) => num(r["Prix du Document"]))),
      totalQuantity: rs.reduce((s, r) => s + (Number(r["Qté"]) || 0), 0),
      treatment: str(h["Type Traitement"]),
      lines: rs.map((r) => ({
        lineNo: str(r["N° Ligne"]),
        reference: str(r["Code Produit Fini"]),
        productLabel: str(r["Libellé 1 Produit Fini"]),
        colorCode: str(r["Code Coloris"]),
        colorLabel: str(r["Libellé Coloris"]),
        size: str(r["Taille"]),
        ean: str(r["Code Barre"]),
        quantity: Number(r["Qté"]) || 0,
        unitPrice: num(r["Prix Unitaire"]),
        parcelNo: str(r["N° Colis"]),
        location: str(r["Code Emplacement"]),
        statFamily: str(r["Libellé famille statistique"]),
        statSubFamily: str(r["Libellé sous famille statistique"]),
        orderRef: str(r["Référence Commande"]),
        raw: r,
      })),
    });
  }

  // Ordre stable : deux imports du même fichier écrivent dans le même ordre.
  documents.sort((a, b) => a.documentNumber.localeCompare(b.documentNumber, "fr", { numeric: true }));
  return { documents, ignored };
}

/**
 * N° de commande TIO porté par le nom de fichier : `BL_IS-041940245113_137391.xlsx`.
 * `IS-` = commande en stock, `PO-` = précommande.
 *
 * ⚠️ Un export multi-documents n'en porte aucun : le lien BL ↔ commande client reste
 * alors vide, et le rattachement se fait par le seul code client.
 */
export function tioOrderFromFileName(fileName: string): string | null {
  return (String(fileName).match(/(?:IS|PO)-\d+/) || [])[0] || null;
}

/** Type de document déduit du nom de fichier : `FAC…` → facture, sinon bon de livraison. */
export function docTypeFromFileName(fileName: string): "BL" | "FAC" {
  return /^FAC/i.test(String(fileName)) ? "FAC" : "BL";
}

/**
 * Saison GestLog → code saison porté par les documents entrepôt.
 * `AH 2026` → « W26 » (Winter), `PE 2027` → « S27 » (Summer).
 *
 * ⚠️ C'est l'inverse de `parseSeasonFromCatalog` (lib/utils.ts), qui lit W/S/H. On
 * n'émet que W et S : `H` n'apparaît qu'en lecture, sur d'anciens libellés.
 */
export function warehouseSeasonCode(type: string, year: number): string {
  const lettre = String(type).toUpperCase() === "PE" ? "S" : "W";
  return `${lettre}${String(year % 100).padStart(2, "0")}`;
}
