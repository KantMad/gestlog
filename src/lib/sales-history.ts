// Historique des ventes par ligne — logique PURE (testée) partagée par l'import,
// l'API et l'écran BtoC → Historique ventes.
//
// Source : exports « Commandes » de WooCommerce (xlsx), une ligne par article, avec au
// minimum les colonnes « Numéro de commande », « Date de commande », « Nom du produit »,
// « UGS », « Quantité », « Prix du produit ».
// L'UGS MCS vaut `RÉF-COULEUR-TAILLE` (ex. `NMPULL_W001-740-XL`) : c'est lui qui donne la
// couleur et la taille (le nom du produit ne les porte pas).

import * as XLSX from "xlsx";

/** Ligne prête à stocker (une par article et par commande). */
export interface SalesHistoryInput {
  orderNumber: string;
  lineKey: string;
  orderDay: string; // AAAA-MM-JJ
  productName: string;
  sku: string | null;
  reference: string | null;
  colorCode: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Découpe un UGS `RÉF-COULEUR-TAILLE`. Couleur = 2 ou 3 chiffres, sinon inconnue. */
export function parseSku(sku: string | null | undefined): {
  reference: string | null;
  colorCode: string | null;
  size: string | null;
} {
  const s = String(sku ?? "").trim();
  if (!s) return { reference: null, colorCode: null, size: null };
  const parts = s.split("-");
  const reference = parts[0] || null;
  if (parts.length < 3 || !/^\d{2,3}$/.test(parts[1])) return { reference, colorCode: null, size: null };
  const size = parts.slice(2).join("-").trim().toUpperCase() || null;
  return { reference, colorCode: parts[1], size };
}

/** Nombre au format FR ou EN (« 12,5 », « 12.5 », « 1 234,50 »). */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Date d'export → `AAAA-MM-JJ`. Accepte `2024-08-30 17:35`, `30/08/2024`, une Date ou un n° de série Excel. */
export function parseExportDay(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

const COLS = {
  order: ["numéro de commande", "numero de commande", "order number", "id de commande"],
  date: ["date de commande", "order date"],
  name: ["nom du produit", "product name", "item name"],
  sku: ["ugs", "sku"],
  qty: ["quantité", "quantite", "quantity"],
  price: ["prix du produit", "item cost", "prix"],
};

function findCol(headers: string[], names: string[]): string | null {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return headers[i];
  }
  return null;
}

/** Colonnes indispensables d'un export Commandes (null si la feuille n'en est pas un). */
export function detectColumns(headers: string[]) {
  const c = {
    order: findCol(headers, COLS.order),
    date: findCol(headers, COLS.date),
    name: findCol(headers, COLS.name),
    sku: findCol(headers, COLS.sku),
    qty: findCol(headers, COLS.qty),
    price: findCol(headers, COLS.price),
  };
  if (!c.order || !c.date || !c.name || !c.qty) return null;
  return c as { order: string; date: string; name: string; sku: string | null; qty: string; price: string | null };
}

/**
 * Lignes brutes d'une feuille → lignes à stocker.
 * Un même article répété dans une commande (même UGS) est CUMULÉ : la clé de stockage
 * est (commande, UGS), il ne doit donc y avoir qu'une ligne par clé.
 */
export function parseExportRows(rows: Record<string, unknown>[]): {
  lines: SalesHistoryInput[];
  skipped: number;
  error?: string;
} {
  if (rows.length === 0) return { lines: [], skipped: 0, error: "Feuille vide" };
  const cols = detectColumns(Object.keys(rows[0]));
  if (!cols) {
    return {
      lines: [],
      skipped: rows.length,
      error: "Colonnes introuvables : il faut « Numéro de commande », « Date de commande », « Nom du produit » et « Quantité ».",
    };
  }
  const byKey = new Map<string, SalesHistoryInput>();
  let skipped = 0;
  for (const r of rows) {
    const orderNumber = String(r[cols.order] ?? "").trim();
    const orderDay = parseExportDay(r[cols.date]);
    const productName = String(r[cols.name] ?? "").trim();
    const quantity = Math.round(parseNumber(r[cols.qty]));
    if (!orderNumber || !orderDay || !productName || quantity === 0) {
      skipped++;
      continue;
    }
    const sku = cols.sku ? String(r[cols.sku] ?? "").trim() || null : null;
    const unitPrice = cols.price ? parseNumber(r[cols.price]) : 0;
    const lineKey = sku ?? productName;
    const key = `${orderNumber}§${lineKey}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.quantity += quantity;
      prev.lineTotal = round2(prev.lineTotal + unitPrice * quantity);
      continue;
    }
    byKey.set(key, {
      orderNumber,
      lineKey,
      orderDay,
      productName,
      sku,
      ...parseSku(sku),
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    });
  }
  return { lines: [...byKey.values()], skipped };
}

/** Classeur xlsx → lignes, en lisant la première feuille qui ressemble à un export Commandes. */
export function parseExportWorkbook(wb: XLSX.WorkBook): ReturnType<typeof parseExportRows> & { sheet?: string } {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "", raw: true });
    if (rows.length && detectColumns(Object.keys(rows[0]))) return { ...parseExportRows(rows), sheet: name };
  }
  return { lines: [], skipped: 0, error: "Aucune feuille d'export « Commandes » WooCommerce trouvée dans ce fichier." };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Tailles ────────────────────────────────────────────────────────────

const ALPHA_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL", "6XL", "TU", "U"];

/** Tri des tailles : numériques croissantes, puis XXS → 6XL, puis le reste ; « ? » (inconnue) en dernier. */
export function compareSizes(a: string, b: string): number {
  const rank = (s: string): [number, number, string] => {
    if (s === UNKNOWN_SIZE) return [3, 0, s];
    if (/^\d+$/.test(s)) return [0, parseInt(s, 10), s];
    const i = ALPHA_ORDER.indexOf(s);
    return i >= 0 ? [1, i, s] : [2, 0, s];
  };
  const ra = rank(a);
  const rb = rank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
}

export const UNKNOWN_SIZE = "?";
export const UNKNOWN_COLOR = "Non précisée";

// ─── Grilles produit × couleur × taille ─────────────────────────────────

/** Ligne agrégée renvoyée par l'API (une par année × produit × couleur × taille). */
export interface SalesAggRow {
  year: number;
  productName: string;
  category: string;
  color: string;
  size: string;
  qty: number;
  amount: number;
}

export interface ColorGrid {
  color: string;
  total: number;
  byYear: { year: number; sizes: Record<string, number>; total: number }[];
  sizes: Record<string, number>; // toutes années
}

export interface ProductGrid {
  productName: string;
  category: string;
  total: number;
  amount: number;
  sizes: string[]; // tailles vendues de ce produit, triées
  byYear: Record<number, number>;
  colors: ColorGrid[];
  allColors: ColorGrid; // ligne « toutes couleurs »
}

/** Regroupe les lignes agrégées en une grille par produit (couleurs × années × tailles), produits triés par volume. */
export function buildProductGrids(rows: SalesAggRow[]): ProductGrid[] {
  const products = new Map<string, { category: string; rows: SalesAggRow[] }>();
  for (const r of rows) {
    const p = products.get(r.productName) ?? { category: r.category, rows: [] };
    p.rows.push(r);
    products.set(r.productName, p);
  }
  const grid = (color: string, rs: SalesAggRow[]): ColorGrid => {
    const years = new Map<number, { sizes: Record<string, number>; total: number }>();
    const sizes: Record<string, number> = {};
    let total = 0;
    for (const r of rs) {
      const y = years.get(r.year) ?? { sizes: {}, total: 0 };
      y.sizes[r.size] = (y.sizes[r.size] ?? 0) + r.qty;
      y.total += r.qty;
      years.set(r.year, y);
      sizes[r.size] = (sizes[r.size] ?? 0) + r.qty;
      total += r.qty;
    }
    return {
      color,
      total,
      sizes,
      byYear: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v })),
    };
  };
  return [...products.entries()]
    .map(([productName, p]) => {
      const byColor = new Map<string, SalesAggRow[]>();
      for (const r of p.rows) byColor.set(r.color, [...(byColor.get(r.color) ?? []), r]);
      const byYear: Record<number, number> = {};
      for (const r of p.rows) byYear[r.year] = (byYear[r.year] ?? 0) + r.qty;
      const colors = [...byColor.entries()].map(([c, rs]) => grid(c, rs)).sort((a, b) => b.total - a.total);
      const allColors = grid("Toutes couleurs", p.rows);
      return {
        productName,
        category: p.category,
        total: allColors.total,
        amount: round2(p.rows.reduce((s, r) => s + r.amount, 0)),
        sizes: [...new Set(p.rows.map((r) => r.size))].sort(compareSizes),
        byYear,
        colors,
        allColors,
      };
    })
    .sort((a, b) => b.total - a.total || a.productName.localeCompare(b.productName, "fr"));
}

/** Part de chaque taille (en %) d'une grille, arrondie à l'unité. */
export function sizeShares(sizes: Record<string, number>): Record<string, number> {
  const total = Object.values(sizes).reduce((s, n) => s + n, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sizes)) out[k] = total > 0 ? Math.round((100 * v) / total) : 0;
  return out;
}

// ─── Export Excel ───────────────────────────────────────────────────────

/** Classeur : grilles par produit et par couleur, synthèses produit / couleur / taille, et lignes agrégées. */
export function buildSalesHistoryWorkbook(rows: SalesAggRow[], title: string): XLSX.WorkBook {
  const grids = buildProductGrids(rows);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const wb = XLSX.utils.book_new();

  // 1. Grilles : un bloc par produit, une ligne par couleur et par année, tailles en colonnes.
  const aoa: (string | number)[][] = [[title], []];
  for (const g of grids) {
    aoa.push([`${g.productName} (${g.category}) — ${g.total} pièces`]);
    aoa.push(["Couleur", "Année", ...g.sizes, "Total"]);
    for (const c of [...g.colors, g.allColors]) {
      for (const y of c.byYear) aoa.push([c.color, y.year, ...g.sizes.map((s) => y.sizes[s] || ""), y.total]);
      if (c.byYear.length > 1) aoa.push([c.color, "Total", ...g.sizes.map((s) => c.sizes[s] || ""), c.total]);
    }
    aoa.push([], []);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 7 }, ...Array(14).fill({ wch: 7 })];
  XLSX.utils.book_append_sheet(wb, ws, "Grilles produit×couleur");

  // 2. Synthèses.
  const sum = (key: (r: SalesAggRow) => string, label: string) => {
    const m = new Map<string, { y: Record<number, number>; q: number; a: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k) ?? { y: {}, q: 0, a: 0 };
      e.y[r.year] = (e.y[r.year] ?? 0) + r.qty;
      e.q += r.qty;
      e.a += r.amount;
      m.set(k, e);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].q - a[1].q)
      .map(([k, e]): Record<string, string | number> => ({
        [label]: k,
        ...Object.fromEntries(years.map((y) => [String(y), e.y[y] ?? 0])),
        "Total pièces": e.q,
        "CA (€)": Math.round(e.a),
      }));
  };
  const add = (data: Record<string, unknown>[], name: string) => {
    if (!data.length) return;
    const s = XLSX.utils.json_to_sheet(data);
    s["!autofilter"] = { ref: s["!ref"]! };
    XLSX.utils.book_append_sheet(wb, s, name);
  };
  add(sum((r) => r.productName, "Produit"), "Par produit");
  add(sum((r) => r.color, "Couleur"), "Par couleur");
  add(
    sum((r) => r.size, "Taille").sort((a, b) => compareSizes(String(a.Taille), String(b.Taille))),
    "Par taille"
  );
  add(
    rows.map((r) => ({
      Année: r.year,
      Catégorie: r.category,
      Produit: r.productName,
      Couleur: r.color,
      Taille: r.size,
      Pièces: r.qty,
      "CA (€)": round2(r.amount),
    })),
    "Données"
  );
  return wb;
}
