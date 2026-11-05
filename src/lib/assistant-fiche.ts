// ─── Fiche produit pour l'assistant IA (lecture seule) ───────────────────────
//
// Servie par `GET /api/assistant/produit?reference=` : pour UNE référence, le stock entrepôt
// par couleur et par taille (StockEntry.quantitiesBySize, dans l'ordre de Product.sizeScale),
// les prix, et les ventes du site des derniers jours par couleur et taille (BtocOrderLine).
// Référence inconnue : jusqu'à 10 références proches (référence ou désignation), pour que
// l'assistant demande laquelle.
//
// Fonctions PURES : la route ne fait que les requêtes.

import { parseSizeQuantities } from "./utils";

export interface FicheStockRow {
  reference: string;
  color: string;
  colorCode: string | null;
  colorLabel: string | null;
  label: string | null;
  category: string | null;
  subCategory: string | null;
  sizeScale: string;
  salePrice: number | null;
  costPrice: number | null;
  /** JSON { taille: quantité } de chaque StockEntry du produit (vide : pas d'entrée). */
  quantitiesBySize: string[];
}

export interface FicheVenteRow {
  color: string | null;
  size: string | null;
  quantity: number | bigint;
}

export interface FicheCouleur {
  couleur: string;
  libelle: string | null;
  code: string | null;
  /** Stock par taille, dans l'ordre de la grille ; tailles hors grille à la fin. */
  tailles: { taille: string; stock: number }[];
  total: number;
}

export interface FicheProduit {
  reference: string;
  nom: string;
  categorie: string | null;
  sousCategorie: string | null;
  prixPublic: number | null;
  prixGros: number | null;
  couleurs: FicheCouleur[];
  stockTotal: number;
  ventesSite: { couleur: string | null; taille: string | null; quantite: number }[];
}

export function construireFiche(stocks: FicheStockRow[], ventes: FicheVenteRow[]): FicheProduit | null {
  if (!stocks.length) return null;
  const premier = stocks[0];
  const couleurs = stocks.map((s): FicheCouleur => {
    const parTaille = new Map<string, number>();
    for (const json of s.quantitiesBySize) {
      for (const [t, q] of Object.entries(parseSizeQuantities(json))) parTaille.set(t, (parTaille.get(t) ?? 0) + (Number(q) || 0));
    }
    const grille = s.sizeScale.split(",").map((t) => t.trim()).filter(Boolean);
    const ordre = [...grille, ...[...parTaille.keys()].filter((t) => !grille.includes(t))];
    const tailles = ordre.map((taille) => ({ taille, stock: Math.max(parTaille.get(taille) ?? 0, 0) }));
    return {
      couleur: s.color,
      libelle: s.colorLabel?.trim() || null,
      code: s.colorCode,
      tailles,
      total: tailles.reduce((t, x) => t + x.stock, 0),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    reference: premier.reference,
    nom: stocks.find((s) => s.label?.trim())?.label?.trim() || premier.reference,
    categorie: premier.category,
    sousCategorie: premier.subCategory,
    prixPublic: stocks.find((s) => s.salePrice)?.salePrice ?? null,
    prixGros: stocks.find((s) => s.costPrice)?.costPrice ?? null,
    couleurs,
    stockTotal: couleurs.reduce((t, c) => t + c.total, 0),
    ventesSite: ventes
      .map((v) => ({ couleur: v.color, taille: v.size, quantite: Number(v.quantity) || 0 }))
      .filter((v) => v.quantite > 0)
      .sort((a, b) => b.quantite - a.quantite),
  };
}
