import { sortSizeScale } from "@/lib/size-order";

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
  colorCode: string;
  colorLabel: string;
  clientCode: string;
  clientName: string;
  /** JSON { taille: quantité } tel que stocké dans ClientOrderLine.quantitiesBySize. */
  quantitiesBySize: string;
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
        colorCode: l.colorCode,
        colorLabel: l.colorLabel,
        total: {},
        byClient: new Map(),
      };
      groups.set(key, g);
    }
    // Le libellé de coloris peut manquer sur certaines lignes : on garde le premier connu.
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

  const header = withBoutique
    ? ["Référence", "Coloris", "Libellé coloris", "Boutique", ...sizes, "Total"]
    : ["Référence", "Coloris", "Libellé coloris", ...sizes, "Total"];

  const ordered = [...groups.values()].sort(
    (a, b) => a.reference.localeCompare(b.reference) || a.colorCode.localeCompare(b.colorCode)
  );

  const rows: (string | number)[][] = [];
  const sizeTotals: Record<string, number> = {};

  for (const g of ordered) {
    addInto(sizeTotals, g.total);
    if (!withBoutique) {
      rows.push([
        g.reference, g.colorCode, g.colorLabel,
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
        g.reference, g.colorCode, g.colorLabel, c.name,
        ...sizes.map((s) => c.qty[s] ?? ""),
        sum(c.qty),
      ]);
    }
    rows.push([
      g.reference, g.colorCode, g.colorLabel,
      `Total ${g.reference} ${g.colorCode}`.trim(),
      ...sizes.map((s) => g.total[s] ?? ""),
      sum(g.total),
    ]);
  }

  const grandTotal = sum(sizeTotals);
  rows.push([
    "TOTAL", "", "",
    ...(withBoutique ? [""] : []),
    ...sizes.map((s) => sizeTotals[s] ?? 0),
    grandTotal,
  ]);

  return { sizes, header, rows, groupCount: groups.size, grandTotal };
}
