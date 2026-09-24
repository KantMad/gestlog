import { sortSizeScale } from "@/lib/size-order";
// Nom d'onglet Excel valide et unique — même règle que le classeur « Lancement de
// commande », pour que deux exports ne nomment pas différemment le même fournisseur.
import { safeSheetName } from "@/lib/lancement-commande";

// Construction de l'export "Quantités commandées" (écran Exports).
//
// Une ligne de commande client porte ses quantités dans un JSON { taille: qté }. On les
// agrège par (référence, coloris) — et, si le détail est demandé, par boutique — avec les
// TAILLES EN COLONNES : c'est la lecture attendue d'un tableau de commandes.
//
// Trois totaux, tous demandés : somme par taille (dernière ligne), somme par coloris
// (colonne Total), somme totale (croisement des deux).

export interface QuantityLine {
  reference: string;
  /** Désignation du produit (Product.label) — le "Libellé 1" des fichiers métier. */
  label: string;
  /**
   * Catégorie produit — toujours celle du RÉFÉRENTIEL (`Product.category`).
   * `ClientOrderLine.category` existe mais n'est renseignée nulle part en base
   * (0 ligne) : s'en servir, même en repli, laisserait la colonne vide.
   */
  category: string;
  colorCode: string;
  colorLabel: string;
  clientCode: string;
  clientName: string;
  /** JSON { taille: quantité } tel que stocké dans ClientOrderLine.quantitiesBySize. */
  quantitiesBySize: string;
  /** Fournisseur du produit ; vide si inconnu (cf. `NO_SUPPLIER`). */
  supplier?: string;
}

export interface QuantitySheet {
  /** Tailles retenues, ordonnées (colonnes du tableau). */
  sizes: string[];
  header: string[];
  rows: (string | number)[][];
  /** Nombre de couples (référence, coloris) — sert au message de confirmation. */
  groupCount: number;
  grandTotal: number;
}

/** Quantités d'une ligne, tolérant un JSON absent ou invalide (donnée importée). */
export function parseQuantities(raw: string | null | undefined): Record<string, number> {
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
    // Les tailles à 0 ne créent pas de colonne : une grille pleine de zéros est illisible.
    if (!s || !Number.isFinite(n) || n === 0) continue;
    out[s] = (out[s] ?? 0) + n;
  }
  return out;
}

const groupKey = (l: QuantityLine) => `${l.reference} ${l.colorCode}`;
const addInto = (target: Record<string, number>, src: Record<string, number>) => {
  for (const [s, q] of Object.entries(src)) target[s] = (target[s] ?? 0) + q;
};
const sum = (q: Record<string, number>) => Object.values(q).reduce((a, b) => a + b, 0);

export function buildQuantitySheet(
  lines: QuantityLine[],
  { withBoutique }: { withBoutique: boolean }
): QuantitySheet {
  // 1. Agrégation. Une même (réf, coloris, boutique) peut apparaître sur plusieurs
  //    commandes : on additionne, on ne remplace pas.
  const groups = new Map<
    string,
    {
      reference: string;
      label: string;
      category: string;
      colorCode: string;
      colorLabel: string;
      total: Record<string, number>;
      byClient: Map<string, { code: string; name: string; qty: Record<string, number> }>;
    }
  >();

  for (const l of lines) {
    const qty = parseQuantities(l.quantitiesBySize);
    if (Object.keys(qty).length === 0) continue;
    const key = groupKey(l);
    let g = groups.get(key);
    if (!g) {
      g = {
        reference: l.reference,
        label: l.label,
        category: l.category,
        colorCode: l.colorCode,
        colorLabel: l.colorLabel,
        total: {},
        byClient: new Map(),
      };
      groups.set(key, g);
    }
    // Libellé et catégorie peuvent manquer sur certaines lignes : on garde le premier connu.
    if (!g.label && l.label) g.label = l.label;
    if (!g.category && l.category) g.category = l.category;
    if (!g.colorLabel && l.colorLabel) g.colorLabel = l.colorLabel;
    addInto(g.total, qty);

    if (withBoutique) {
      const ck = l.clientCode || l.clientName;
      let c = g.byClient.get(ck);
      if (!c) {
        c = { code: l.clientCode, name: l.clientName, qty: {} };
        g.byClient.set(ck, c);
      }
      addInto(c.qty, qty);
    }
  }

  // 2. Colonnes : union des tailles réellement commandées, dans l'ordre des grilles.
  const allSizes = new Set<string>();
  for (const g of groups.values()) for (const s of Object.keys(g.total)) allSizes.add(s);
  const sizes = sortSizeScale([...allSizes]);

  const FIXED = ["Référence", "Libellé 1", "Catégorie", "Coloris", "Libellé coloris"];
  const header = withBoutique
    ? [...FIXED, "Boutique", ...sizes, "Total"]
    : [...FIXED, ...sizes, "Total"];

  const ordered = [...groups.values()].sort(
    (a, b) => a.reference.localeCompare(b.reference) || a.colorCode.localeCompare(b.colorCode)
  );

  const rows: (string | number)[][] = [];
  const sizeTotals: Record<string, number> = {};

  for (const g of ordered) {
    addInto(sizeTotals, g.total);
    if (!withBoutique) {
      rows.push([
        g.reference, g.label, g.category, g.colorCode, g.colorLabel,
        ...sizes.map((s) => g.total[s] ?? ""),
        sum(g.total),
      ]);
      continue;
    }
    // Référence et coloris sont répétés sur CHAQUE ligne (au lieu d'être laissés vides
    // sous un en-tête de groupe) : c'est ce qui rend le fichier filtrable et pivotable
    // dans Excel.
    const clients = [...g.byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of clients) {
      rows.push([
        g.reference, g.label, g.category, g.colorCode, g.colorLabel, c.name,
        ...sizes.map((s) => c.qty[s] ?? ""),
        sum(c.qty),
      ]);
    }
    rows.push([
      g.reference, g.label, g.category, g.colorCode, g.colorLabel,
      `Total ${g.reference} ${g.colorCode}`.trim(),
      ...sizes.map((s) => g.total[s] ?? ""),
      sum(g.total),
    ]);
  }

  const grandTotal = sum(sizeTotals);
  rows.push([
    "TOTAL",
    ...Array(FIXED.length - 1).fill(""),
    ...(withBoutique ? [""] : []),
    ...sizes.map((s) => sizeTotals[s] ?? 0),
    grandTotal,
  ]);

  return { sizes, header, rows, groupCount: groups.size, grandTotal };
}

// ─── Un onglet par fournisseur ───────────────────────────────────────────────
// Même tableau que ci-dessus, éclaté par fournisseur. Chaque onglet recalcule SES
// colonnes de tailles : un jeanier se décline en 29-44, un chemisier en S-4XL ; une
// grille commune rendrait chaque onglet aux trois quarts vide.

/**
 * Onglet des produits dont le fournisseur est inconnu.
 *
 * ⚠️ Toujours produit, jamais écarté. *Au 24/09/2026, 250 références sur les 2 017
 * commandées ont un fournisseur connu* : les faire disparaître en silence donnerait un
 * classeur qui a l'air complet et ne l'est pas. L'onglet est placé en DERNIER — c'est
 * une liste de travail, pas un fournisseur.
 */
export const NO_SUPPLIER = "Sans fournisseur";

export interface SupplierQuantitySheet {
  supplier: string;
  /** Nom d'onglet Excel, tronqué et rendu unique. */
  sheetName: string;
  sheet: QuantitySheet;
}

export interface SupplierWorkbook {
  sheets: SupplierQuantitySheet[];
  /** Fournisseurs réellement présents (hors onglet « Sans fournisseur »). */
  supplierCount: number;
  /** Pièces dont le fournisseur est inconnu. */
  unknownPieces: number;
  grandTotal: number;
}

/**
 * Éclate les lignes en un onglet par fournisseur, du plus gros volume au plus petit.
 *
 * ⚠️ Une ligne n'apparaît que dans UN onglet. Un produit partagé entre deux fournisseurs
 * doit avoir été tranché en amont (l'API retient le premier par ordre alphabétique et le
 * signale) : le recopier des deux côtés doublerait les quantités du classeur.
 */
export function buildSupplierSheets(
  lines: QuantityLine[],
  { withBoutique }: { withBoutique: boolean }
): SupplierWorkbook {
  const parFournisseur = new Map<string, QuantityLine[]>();
  for (const l of lines) {
    const f = (l.supplier || "").trim() || NO_SUPPLIER;
    const bucket = parFournisseur.get(f);
    if (bucket) bucket.push(l);
    else parFournisseur.set(f, [l]);
  }

  const construits = [...parFournisseur.entries()]
    .map(([supplier, ls]) => ({ supplier, sheet: buildQuantitySheet(ls, { withBoutique }) }))
    // Un fournisseur dont toutes les lignes sont à zéro ne mérite pas d'onglet.
    .filter((x) => x.sheet.groupCount > 0)
    .sort((a, b) => {
      // « Sans fournisseur » en dernier, quel que soit son volume.
      if (a.supplier === NO_SUPPLIER) return 1;
      if (b.supplier === NO_SUPPLIER) return -1;
      return (
        b.sheet.grandTotal - a.sheet.grandTotal ||
        a.supplier.localeCompare(b.supplier, "fr")
      );
    });

  const taken = new Set<string>();
  const sheets = construits.map((x) => ({
    supplier: x.supplier,
    sheetName: safeSheetName(x.supplier, taken),
    sheet: x.sheet,
  }));

  return {
    sheets,
    supplierCount: sheets.filter((s) => s.supplier !== NO_SUPPLIER).length,
    unknownPieces:
      sheets.find((s) => s.supplier === NO_SUPPLIER)?.sheet.grandTotal ?? 0,
    grandTotal: sheets.reduce((n, s) => n + s.sheet.grandTotal, 0),
  };
}
