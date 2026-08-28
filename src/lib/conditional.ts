import * as XLSX from "xlsx";

// ─── Vente en conditionnelle (dépôt-vente) ────────────────────────────────────
//
// Trois natures de fichiers alimentent une même opération :
//   1. LIVRAISON — ce qu'on dépose chez le client (peut être complété plusieurs fois)
//   2. VENTE     — ce qu'il déclare avoir vendu (plusieurs fois, au fil des mois)
//   3. RETOUR    — ce qu'il nous rend en fin d'opération
//
// Solde à tout instant :  LIVRAISON − VENTE − RETOUR, par produit + taille.
// À la clôture, le solde doit tomber à 0 ; tout écart est signalé.
//
// Les colonnes sont repérées PAR NOM (les clients envoient des mises en page très
// différentes) ; l'EAN est prioritaire, avec repli sur référence + couleur + taille.
//
// Fonctions PURES : pas de DB, pas de réseau.

export type ConditionalMovementType = "LIVRAISON" | "VENTE" | "RETOUR";

export interface ConditionalFileLine {
  ean: string;
  reference: string;
  color: string;
  size: string;
  quantity: number;
}

type Cell = string | number | boolean | null | undefined;

const norm = (v: Cell): string => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: Cell): string => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");

const toInt = (v: Cell): number => {
  if (typeof v === "number") return Math.round(v);
  const n = parseFloat(norm(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Référence normalisée : tiret → underscore (convention des fichiers du projet). */
export const normReference = (v: string): string => norm(v).toUpperCase().replace(/-/g, "_");

/** Couleur = le CODE, sans le libellé : « 208-Cognac » → « 208 ». */
export const normColor = (v: string): string => {
  const s = norm(v);
  const i = s.indexOf("-");
  return (i === -1 ? s : s.slice(0, i)).trim().toUpperCase();
};

export const normSize = (v: string): string => norm(v).toUpperCase().replace(/\s+/g, "");

/** Clé d'agrégation d'une ligne : produit + couleur + taille. */
export const lineKey = (reference: string, color: string, size: string): string =>
  `${normReference(reference)}__${normColor(color)}__${normSize(size)}`;

const EAN_HEADERS = ["EAN", "Code barre", "Code Barre", "Code-barres", "Code barres", "Gencod", "Code EAN"];
const REF_HEADERS = ["Référence", "Reference", "Référence produit", "Code Produit Fini", "Code Article", "REF", "Ref produit"];
const COLOR_HEADERS = ["Code couleur", "Couleur", "COLOR CODE", "Coloris", "Code Coloris", "COLOR"];
const SIZE_HEADERS = ["Taille", "Size", "TAILLE"];
const QTY_HEADERS = ["Quantité", "Quantite", "Qté", "Qte", "Qty", "Quantité vendue", "Quantité livrée", "Quantité rendue", "Nombre"];

/**
 * Lit un fichier client (xlsx ou csv). L'en-tête n'est pas forcément en 1re ligne :
 * on cherche, dans les 30 premières, celle qui porte une colonne QUANTITÉ **et** un
 * identifiant produit (EAN ou référence).
 *
 * Une ligne est retenue si elle a une quantité > 0 et au moins un identifiant.
 */
export function parseConditionalFile(buffer: ArrayBuffer): ConditionalFileLine[] {
  const wb = XLSX.read(buffer, { type: "array" });

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (grid.length < 2) continue;

    const find = (cells: string[], names: string[]) => {
      for (const n of names) {
        const i = cells.indexOf(key(n));
        if (i >= 0) return i;
      }
      return -1;
    };

    for (let h = 0; h < Math.min(grid.length, 30); h++) {
      const cells = (grid[h] || []).map(key);
      const cQty = find(cells, QTY_HEADERS);
      const cEan = find(cells, EAN_HEADERS);
      const cRef = find(cells, REF_HEADERS);
      if (cQty < 0 || (cEan < 0 && cRef < 0)) continue;

      const cColor = find(cells, COLOR_HEADERS);
      const cSize = find(cells, SIZE_HEADERS);

      const out: ConditionalFileLine[] = [];
      for (let r = h + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const quantity = toInt(row[cQty]);
        if (quantity <= 0) continue;
        const ean = cEan >= 0 ? norm(row[cEan]).replace(/\s/g, "") : "";
        const reference = cRef >= 0 ? norm(row[cRef]) : "";
        if (!ean && !reference) continue;
        // Une ligne « TOTAL » n'est pas un produit.
        if (reference.toUpperCase() === "TOTAL") continue;
        out.push({
          ean,
          reference,
          color: cColor >= 0 ? norm(row[cColor]) : "",
          size: cSize >= 0 ? norm(row[cSize]) : "",
          quantity,
        });
      }
      if (out.length > 0) return out;
    }
  }
  return [];
}

// ─── Solde d'une opération ────────────────────────────────────────────────────

export interface ConditionalStoredLine {
  type: ConditionalMovementType;
  productId: string | null;
  ean: string | null;
  reference: string;
  color: string;
  size: string;
  quantity: number;
}

export interface BalanceRow {
  key: string;
  productId: string | null;
  ean: string | null;
  reference: string;
  color: string;
  size: string;
  delivered: number;
  sold: number;
  returned: number;
  /** livré − vendu − rendu. Négatif = le client a déclaré plus qu'il n'a reçu. */
  remaining: number;
  /** La ligne existe en VENTE/RETOUR sans avoir jamais été LIVRÉE. */
  neverDelivered: boolean;
}

/** Agrège les mouvements en un solde par produit + taille. */
export function computeBalance(lines: ConditionalStoredLine[]): BalanceRow[] {
  const map = new Map<string, BalanceRow>();
  for (const l of lines) {
    const k = lineKey(l.reference, l.color, l.size);
    let row = map.get(k);
    if (!row) {
      row = {
        key: k,
        productId: l.productId,
        ean: l.ean,
        reference: normReference(l.reference),
        color: normColor(l.color),
        size: normSize(l.size),
        delivered: 0,
        sold: 0,
        returned: 0,
        remaining: 0,
        neverDelivered: false,
      };
      map.set(k, row);
    }
    // On complète les identifiants au fil des mouvements (un fichier peut porter
    // l'EAN, un autre seulement la référence).
    if (!row.productId && l.productId) row.productId = l.productId;
    if (!row.ean && l.ean) row.ean = l.ean;

    if (l.type === "LIVRAISON") row.delivered += l.quantity;
    else if (l.type === "VENTE") row.sold += l.quantity;
    else row.returned += l.quantity;
  }

  const rows = [...map.values()];
  for (const r of rows) {
    r.remaining = r.delivered - r.sold - r.returned;
    r.neverDelivered = r.delivered === 0 && (r.sold > 0 || r.returned > 0);
  }
  // Les anomalies d'abord (jamais livré, puis solde négatif), puis le plus gros reste.
  return rows.sort(
    (a, b) =>
      Number(b.neverDelivered) - Number(a.neverDelivered) ||
      Number(a.remaining < 0) - Number(b.remaining < 0) ||
      b.remaining - a.remaining ||
      a.reference.localeCompare(b.reference, "fr")
  );
}

export interface ConditionalSummary {
  delivered: number;
  sold: number;
  returned: number;
  remaining: number;
  /** Lignes déclarées sans avoir été livrées. */
  neverDeliveredLines: number;
  neverDeliveredPieces: number;
  /** Lignes où le client a déclaré plus que livré (solde négatif). */
  overDeclaredLines: number;
  overDeclaredPieces: number;
  /** Lignes qu'il reste à solder (> 0). */
  openLines: number;
}

export function summarize(rows: BalanceRow[]): ConditionalSummary {
  const s: ConditionalSummary = {
    delivered: 0, sold: 0, returned: 0, remaining: 0,
    neverDeliveredLines: 0, neverDeliveredPieces: 0,
    overDeclaredLines: 0, overDeclaredPieces: 0, openLines: 0,
  };
  for (const r of rows) {
    s.delivered += r.delivered;
    s.sold += r.sold;
    s.returned += r.returned;
    s.remaining += r.remaining;
    if (r.neverDelivered) {
      s.neverDeliveredLines++;
      s.neverDeliveredPieces += r.sold + r.returned;
    }
    if (r.remaining < 0) {
      s.overDeclaredLines++;
      s.overDeclaredPieces += -r.remaining;
    }
    if (r.remaining > 0) s.openLines++;
  }
  return s;
}

/** Montant à facturer : les ventes déclarées, au prix de gros du référentiel. */
export function invoiceAmount(
  rows: BalanceRow[],
  costPriceByProductId: Record<string, number | null>
): { pieces: number; amount: number; piecesWithoutPrice: number } {
  let pieces = 0;
  let amount = 0;
  let piecesWithoutPrice = 0;
  for (const r of rows) {
    if (r.sold <= 0) continue;
    pieces += r.sold;
    const price = r.productId ? costPriceByProductId[r.productId] : null;
    if (price == null) piecesWithoutPrice += r.sold;
    else amount += price * r.sold;
  }
  return { pieces, amount: Math.round(amount * 100) / 100, piecesWithoutPrice };
}
