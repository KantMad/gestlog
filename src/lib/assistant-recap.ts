// ─── Récap pour l'assistant IA (lecture seule) ───────────────────────────────
//
// Données servies par `GET /api/assistant/recap` à l'assistant IA de Kant (Mac mini du
// bureau), qui les met dans le récap quotidien CentralWay :
//   - les commandes clients B2B **TIO** dont la date de commande tombe le jour demandé
//     (jour calendaire de Paris) ;
//   - le stock entrepôt (`StockEntry`) valorisé par catégorie, au coût ET au prix public.
//
// Fonctions PURES : pas de DB → testables. La route ne fait que les requêtes.

export interface AssistantOrderRow {
  orderNumber: string;
  clientName: string;
  orderDate: Date | null;
  totalAmount: number | null;
  status: string;
  orderType: string;
}

export interface AssistantStockRow {
  category: string | null;
  totalQuantity: number;
  costPrice: number | null;
  salePrice: number | null;
}

export interface AssistantCommande {
  numero: string;
  client: string;
  date: string | null; // ISO
  /** ClientOrder.totalAmount : montant au prix de GROS, pas au prix public. */
  montant: number | null;
  statut: string;
  type: string;
  source: "TIO";
}

export interface AssistantStockCategorie {
  categorie: string;
  pieces: number;
  valeurCout: number;
  valeurPublic: number;
  /** Pièces sans prix de gros : absentes de valeurCout (pas comptées à 0 € en silence). */
  piecesSansPrixCout: number;
  /** Pièces sans prix public : absentes de valeurPublic (14 % du catalogue au 29/09/2026). */
  piecesSansPrixPublic: number;
}

export const SANS_CATEGORIE = "Sans catégorie";

const arrondi = (n: number) => Math.round(n * 100) / 100;
const prixValide = (p: number | null): p is number => p != null && Number.isFinite(p) && p > 0;

export function mapAssistantOrders(rows: AssistantOrderRow[]): AssistantCommande[] {
  return rows.map((r) => ({
    numero: r.orderNumber,
    client: r.clientName,
    date: r.orderDate ? r.orderDate.toISOString() : null,
    montant: r.totalAmount,
    statut: r.status,
    type: r.orderType,
    source: "TIO",
  }));
}

// Une ligne par produit (référence × couleur) avec son stock total. Un prix absent ou à 0
// n'est PAS valorisé : la pièce est comptée à part pour que le chiffre ne mente pas.
export function aggregateAssistantStock(rows: AssistantStockRow[]): AssistantStockCategorie[] {
  const parCategorie = new Map<string, AssistantStockCategorie>();
  for (const r of rows) {
    const qte = Number(r.totalQuantity) || 0;
    if (qte <= 0) continue;
    const nom = r.category?.trim() || SANS_CATEGORIE;
    let c = parCategorie.get(nom);
    if (!c) {
      c = { categorie: nom, pieces: 0, valeurCout: 0, valeurPublic: 0, piecesSansPrixCout: 0, piecesSansPrixPublic: 0 };
      parCategorie.set(nom, c);
    }
    c.pieces += qte;
    if (prixValide(r.costPrice)) c.valeurCout += qte * r.costPrice;
    else c.piecesSansPrixCout += qte;
    if (prixValide(r.salePrice)) c.valeurPublic += qte * r.salePrice;
    else c.piecesSansPrixPublic += qte;
  }
  return [...parCategorie.values()]
    .map((c) => ({ ...c, valeurCout: arrondi(c.valeurCout), valeurPublic: arrondi(c.valeurPublic) }))
    .sort((a, b) => b.valeurCout - a.valeurCout || a.categorie.localeCompare(b.categorie));
}
