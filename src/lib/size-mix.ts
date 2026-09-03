import { sortSizeScale } from "@/lib/size-order";

// Répartition des quantités COMMANDÉES par taille, en pourcentage (statistiques B2B).
//
// ⚠️ Le découpage PAR CATÉGORIE n'est pas un confort d'affichage, c'est la seule lecture
// honnête : les familles produit n'ont pas la même grille. Sur AH26, 35 tailles distinctes
// cohabitent — un classement global affiche « L : 20 % » alors que L n'existe pas pour un
// jean (qui se décline en 30-40) ni pour un accessoire (TU). Le total toutes catégories
// est conservé, mais comme repère de volume, pas comme grille de tailles.

export interface SizeMixLine {
  category: string | null;
  /** JSON { taille: quantité } (ClientOrderLine.quantitiesBySize). */
  quantitiesBySize: string;
}

export interface SizeMixEntry {
  size: string;
  quantity: number;
  /** Part de la taille DANS SA CATÉGORIE, en % (une décimale). */
  percent: number;
}

export interface SizeMixGroup {
  category: string;
  pieces: number;
  sizes: SizeMixEntry[];
}

/** Libellé du groupe qui cumule toutes les catégories. */
export const ALL_CATEGORIES = "Toutes catégories";

/** Libellé de repli pour les produits sans catégorie au référentiel. */
export const NO_CATEGORY = "Sans catégorie";

function parse(raw: string): Record<string, number> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [size, qty] of Object.entries(parsed as Record<string, unknown>)) {
    const s = String(size).trim().toUpperCase();
    const n = Number(qty);
    if (!s || !Number.isFinite(n) || n <= 0) continue;
    out[s] = (out[s] ?? 0) + n;
  }
  return out;
}

/**
 * Construit la répartition par taille : le cumul toutes catégories d'abord, puis une
 * entrée par catégorie, de la plus grosse à la plus petite.
 * Les tailles sont ordonnées selon la grille (`sortSizeScale`), pas par volume : on lit
 * une courbe de tailles, pas un classement.
 */
export function buildSizeMix(lines: SizeMixLine[]): SizeMixGroup[] {
  const byCategory = new Map<string, Record<string, number>>();
  const total: Record<string, number> = {};

  for (const line of lines) {
    const sizes = parse(line.quantitiesBySize);
    if (Object.keys(sizes).length === 0) continue;
    const cat = (line.category || "").trim() || NO_CATEGORY;
    const bucket = byCategory.get(cat) ?? {};
    for (const [size, qty] of Object.entries(sizes)) {
      bucket[size] = (bucket[size] ?? 0) + qty;
      total[size] = (total[size] ?? 0) + qty;
    }
    byCategory.set(cat, bucket);
  }

  const toGroup = (category: string, counts: Record<string, number>): SizeMixGroup => {
    const pieces = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      category,
      pieces,
      sizes: sortSizeScale(Object.keys(counts)).map((size) => ({
        size,
        quantity: counts[size],
        // Arrondi à une décimale : à deux, la somme des parts affiche du bruit.
        percent: pieces > 0 ? Math.round((counts[size] / pieces) * 1000) / 10 : 0,
      })),
    };
  };

  const groups = [...byCategory.entries()]
    .map(([cat, counts]) => toGroup(cat, counts))
    .sort((a, b) => b.pieces - a.pieces || a.category.localeCompare(b.category, "fr"));

  if (groups.length === 0) return [];
  return [toGroup(ALL_CATEGORIES, total), ...groups];
}
