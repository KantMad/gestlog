// ─── Produits pour l'assistant IA (lecture seule) ────────────────────────────
//
// Servi par `GET /api/assistant/produits?debut=&fin=` : par RÉFÉRENCE, les ventes du site sur
// la période (BtocOrderLine moins BtocRefundLine, comme l'export « Best sellers ») et le stock
// entrepôt actuel (StockEntry, toutes couleurs). L'assistant en tire les produits à pousser
// (ceux qui se vendent ET dont il reste beaucoup). Rattachement : la référence est la 1re partie
// du SKU WooCommerce `RÉF-COULEUR-TAILLE` (cf. docs/07) et `Product.reference` côté stock.
//
// Fonction PURE : la route ne fait que les requêtes.

export interface AssistantVenteRow {
  reference: string;
  name: string | null;
  quantity: number | bigint;
  revenue: number;
}

export interface AssistantStockReferenceRow {
  reference: string;
  label: string | null;
  category: string | null;
  totalQuantity: number | bigint;
}

export interface AssistantProduit {
  reference: string;
  nom: string;
  categorie: string | null;
  /** Pièces vendues sur le site pendant la période, remboursements déduits. */
  vendusSite: number;
  /** CA TTC du site sur ces pièces, remboursements déduits. */
  caSite: number;
  /** Stock entrepôt actuel, toutes couleurs et tailles. */
  stock: number;
}

const cle = (r: string) => r.trim().toUpperCase();

export function fusionnerProduits(ventes: AssistantVenteRow[], stocks: AssistantStockReferenceRow[]): AssistantProduit[] {
  const produits = new Map<string, AssistantProduit>();
  for (const s of stocks) {
    if (!s.reference?.trim()) continue;
    produits.set(cle(s.reference), {
      reference: s.reference.trim(),
      nom: s.label?.trim() || s.reference.trim(),
      categorie: s.category?.trim() || null,
      vendusSite: 0,
      caSite: 0,
      stock: Math.max(Number(s.totalQuantity) || 0, 0),
    });
  }
  for (const v of ventes) {
    if (!v.reference?.trim()) continue;
    const p = produits.get(cle(v.reference)) ?? {
      reference: v.reference.trim(), nom: v.name?.trim() || v.reference.trim(), categorie: null, vendusSite: 0, caSite: 0, stock: 0,
    };
    p.vendusSite += Number(v.quantity) || 0;
    p.caSite = Math.round((p.caSite + (Number(v.revenue) || 0)) * 100) / 100;
    produits.set(cle(v.reference), p);
  }
  return [...produits.values()]
    .filter((p) => p.stock > 0 || p.vendusSite > 0)
    .sort((a, b) => b.vendusSite - a.vendusSite || b.stock - a.stock || a.reference.localeCompare(b.reference));
}
