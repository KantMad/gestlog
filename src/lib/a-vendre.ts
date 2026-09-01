// ─── À vendre : stocks à écouler en priorité ──────────────────────────────────
//
// Croise le STOCK ENTREPÔT (`StockEntry`, synchronisé depuis TIO) avec le référentiel
// produit pour repérer ce qui se vend facilement : une gamme de tailles CONTINUE part
// mieux qu'une gamme trouée.
//
// ⚠️ « Disponible » ici = **stock physique en entrepôt**, à ne pas confondre avec le
// « disponible » de la Répartition (reçu − échantillons − déjà réparti), qui répond à une
// tout autre question (que puis-je encore distribuer aux boutiques ?).
//
// Fonctions PURES : pas de DB, pas de réseau → testables et réutilisables côté écran.

export interface AVendreRow {
  /** Collection de LANCEMENT (PE/AH), jamais une saison sentinelle. null = indéterminable. */
  season?: string | null;
  /** Origine de `season` — « prefixe » et « reference-soeur » sont des saisons DÉDUITES. */
  seasonOrigin?: "commande" | "reference-soeur" | "prefixe" | "inconnue";
  /** Toutes les collections où le produit ressort (commandes + rattachement). */
  seasons?: string[];
  productId: string;
  reference: string;
  color: string;
  colorLabel: string | null;
  label: string | null;
  category: string | null;
  subCategory: string | null;
  /** Grille du produit, dans l'ordre d'habillage. */
  sizeScale: string[];
  /** Stock par taille (tailles à 0 incluses si dans la grille). */
  stock: Record<string, number>;
  total: number;
  /** Nombre de tailles manquantes AU MILIEU de la gamme servie. */
  gaps: number;
  salePrice: number | null;
  costPrice: number | null;
}

/**
 * Compte les « trous » d'une gamme : une taille à 0 **encadrée** par des tailles en stock.
 *
 * Les tailles manquantes aux EXTRÉMITÉS ne comptent pas — une gamme qui s'arrête à 2XL
 * n'est pas trouée, elle est juste plus courte. C'est ce qui distingue un assortiment
 * vendable d'un fond de série inexploitable.
 *
 *   S:15  M:0   L:7  XL:6            → 1 trou   (le M manque au milieu)
 *   S:5   M:13  L:17 XL:14 3XL:0     → 0 trou   (la gamme s'arrête, elle n'est pas trouée)
 *   31:1  32:0  33:0  34:3           → 2 trous
 */
export function countSizeGaps(sizeScale: string[], stock: Record<string, number>): number {
  const served = sizeScale.map((s) => (stock[s] || 0) > 0);
  const first = served.indexOf(true);
  const last = served.lastIndexOf(true);
  if (first === -1) return 0; // aucune taille en stock → pas de gamme, pas de trou
  let gaps = 0;
  for (let i = first + 1; i < last; i++) if (!served[i]) gaps++;
  return gaps;
}

/** Prix après remise (`percent` = 30 → −30 %). `null` si le prix est inconnu. */
export function discounted(price: number | null, percent: number): number | null {
  if (price == null) return null;
  const p = Math.max(0, Math.min(100, percent || 0));
  return Math.round(price * (1 - p / 100) * 100) / 100;
}

export interface AVendreTotals {
  products: number;
  pieces: number;
  /** Montant de l'opération : valeur au **prix de gros**, remise déduite. */
  wholesaleValue: number;
  /** Valeur au prix public, **jamais remisée** — sert de repère de positionnement. */
  retailValue: number;
  /** Pièces sans prix de gros → non valorisées. */
  piecesWithoutPrice: number;
}

/**
 * Totaux d'une liste.
 *
 * ⚠️ La remise s'applique au **PRIX DE GROS** : c'est le prix auquel les boutiques sont
 * facturées, donc celui qu'on brade pour écouler du stock. Le prix public reste au plein
 * tarif — il ne sert que de repère (positionnement, coefficient).
 */
export function computeTotals(rows: AVendreRow[], discountPercent: number): AVendreTotals {
  let pieces = 0;
  let wholesaleValue = 0;
  let retailValue = 0;
  let piecesWithoutPrice = 0;
  for (const r of rows) {
    pieces += r.total;
    const wholesale = discounted(r.costPrice, discountPercent);
    if (wholesale == null) piecesWithoutPrice += r.total;
    else wholesaleValue += wholesale * r.total;
    if (r.salePrice != null) retailValue += r.salePrice * r.total;
  }
  return {
    products: rows.length,
    pieces,
    wholesaleValue: Math.round(wholesaleValue * 100) / 100,
    retailValue: Math.round(retailValue * 100) / 100,
    piecesWithoutPrice,
  };
}

/** Libellé couleur lisible : « 213 Chocolat » (code seul si le nom manque). */
export const colorText = (color: string, colorLabel: string | null) =>
  [color, colorLabel].filter((x) => x && String(x).trim()).join(" ");
