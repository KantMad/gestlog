// Historique des ventes par ligne — logique PURE (testée) partagée par l'import,
// l'API et l'écran Analyse → Historique des ventes (BtoC et B2B).
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

// ─── Regroupement par modèle ────────────────────────────────────────────
//
// La référence MCS vaut `SAISON + LIGNE + TYPE_CODE` : NMPULL_W001 (saison N, ligne M,
// type PULL, code W001), JMPULL_W001, MFPULL_W001 (ligne F)… Le même code modèle revient
// d'une saison à l'autre, parfois sous un autre nom (« Pull 1/2 zip col camionneur en
// laine », « Pull lambswool 1/2 zip »). Trois façons de regrouper :
//   - code : TYPE_CODE (PULL_W001) — toutes saisons ET toutes lignes réunies ;
//   - ref  : référence sans la lettre de saison (MPULL_W001 ≠ FPULL_W001) ;
//   - name : nom du produit tel que vendu.
// ⚠️ La ligne F réutilise parfois un code pour un autre produit (FPULL_W004 = pull
// camionneur, MPULL_W004 = col rond) : en mode « code » ils sont réunis. Chaque groupe
// affiche ses références et ses noms pour que ça se voie.

export type GroupMode = "code" | "ref" | "name";

export const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  code: "Code modèle (PULL_W001)",
  ref: "Référence hors saison (MPULL_W001)",
  name: "Nom du produit",
};

/** Clé de regroupement d'une vente. Sans référence exploitable : le nom du produit. */
export function modelKeyOf(reference: string | null, productName: string, mode: GroupMode): string {
  const ref = (reference ?? "").trim().toUpperCase();
  if (mode !== "name" && ref) {
    if (mode === "code") {
      const m = ref.match(/([A-Z0-9]{3,4})_([A-Z0-9]+)$/);
      if (m) return `${m[1]}_${m[2]}`;
    } else if (/^[A-Z][A-Z0-9]+_[A-Z0-9]+$/.test(ref)) {
      return ref.slice(1);
    }
  }
  return productName;
}

/** Vente agrégée telle que lue en base (une par année × référence × nom × couleur × taille). */
export interface RawSalesRow {
  /** Clé de TRI de la période (BtoC : l'année ; B2B : voir `b2bPeriod`). */
  year: number;
  /** Libellé affiché de la période (« 2024 », « AH26 », « Réassort 2025 »). */
  period: string;
  reference: string | null;
  productName: string;
  color: string;
  size: string;
  qty: number;
  amount: number;
}

/** Ligne agrégée renvoyée par l'API, rattachée à son groupe (modèle). */
export interface SalesAggRow extends RawSalesRow {
  model: string; // clé de regroupement
  label: string; // nom affiché du groupe = nom le plus vendu
  category: string; // catégorie du groupe
}

/**
 * Rattache chaque vente à son modèle. Nom affiché = nom le plus vendu du groupe ;
 * catégorie = catégorie (déduite du nom) qui pèse le plus en pièces, « Autres » ne
 * gagnant que s'il n'y a rien d'autre (les noms anglais du site EN ne sont pas reconnus).
 */
export function groupSalesRows(
  raw: RawSalesRow[],
  mode: GroupMode,
  categoryOf: (name: string) => string,
  unclassified = "Autres"
): SalesAggRow[] {
  const keys = raw.map((r) => modelKeyOf(r.reference, r.productName, mode));
  const names = new Map<string, Map<string, number>>();
  const cats = new Map<string, Map<string, number>>();
  raw.forEach((r, i) => {
    const k = keys[i];
    const n = names.get(k) ?? new Map<string, number>();
    n.set(r.productName, (n.get(r.productName) ?? 0) + r.qty);
    names.set(k, n);
    const c = cats.get(k) ?? new Map<string, number>();
    const cat = categoryOf(r.productName);
    c.set(cat, (c.get(cat) ?? 0) + r.qty);
    cats.set(k, c);
  });
  const top = (m: Map<string, number>, skip?: string) =>
    [...m.entries()].filter(([k]) => k !== skip).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const label = new Map<string, string>();
  const category = new Map<string, string>();
  for (const [k, n] of names) label.set(k, top(n)!);
  for (const [k, c] of cats) category.set(k, top(c, unclassified) ?? unclassified);
  return raw.map((r, i) => ({ ...r, model: keys[i], label: label.get(keys[i])!, category: category.get(keys[i])! }));
}

// ─── Grilles modèle × couleur × taille ──────────────────────────────────

export interface ColorGrid {
  color: string;
  total: number;
  byYear: { year: number; period: string; sizes: Record<string, number>; total: number }[];
  sizes: Record<string, number>; // toutes années
}

export interface ProductGrid {
  model: string;
  label: string;
  category: string;
  names: string[]; // noms vendus sous ce modèle, du plus vendu au moins vendu
  references: string[]; // références complètes rencontrées
  total: number;
  amount: number;
  sizes: string[]; // tailles vendues de ce modèle, triées
  byYear: Record<number, number>;
  colors: ColorGrid[];
  allColors: ColorGrid; // ligne « toutes couleurs »
}

function colorGrid(color: string, rs: SalesAggRow[]): ColorGrid {
  const years = new Map<number, { period: string; sizes: Record<string, number>; total: number }>();
  const sizes: Record<string, number> = {};
  let total = 0;
  for (const r of rs) {
    const y = years.get(r.year) ?? { period: r.period, sizes: {}, total: 0 };
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
}

/** Une grille par modèle (couleurs × années × tailles), modèles triés par volume. */
export function buildProductGrids(rows: SalesAggRow[]): ProductGrid[] {
  const models = new Map<string, SalesAggRow[]>();
  for (const r of rows) models.set(r.model, [...(models.get(r.model) ?? []), r]);
  return [...models.entries()]
    .map(([model, rs]) => {
      const byColor = new Map<string, SalesAggRow[]>();
      for (const r of rs) byColor.set(r.color, [...(byColor.get(r.color) ?? []), r]);
      const byYear: Record<number, number> = {};
      const nameQty = new Map<string, number>();
      for (const r of rs) {
        byYear[r.year] = (byYear[r.year] ?? 0) + r.qty;
        nameQty.set(r.productName, (nameQty.get(r.productName) ?? 0) + r.qty);
      }
      const allColors = colorGrid("Toutes couleurs", rs);
      return {
        model,
        label: rs[0].label,
        category: rs[0].category,
        names: [...nameQty.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
        references: [...new Set(rs.map((r) => r.reference).filter((x): x is string => !!x))].sort(),
        total: allColors.total,
        amount: round2(rs.reduce((s, r) => s + r.amount, 0)),
        sizes: [...new Set(rs.map((r) => r.size))].sort(compareSizes),
        byYear,
        colors: [...byColor.entries()].map(([c, x]) => colorGrid(c, x)).sort((a, b) => b.total - a.total),
        allColors,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "fr"));
}

/** Clé de tri → libellé de période. */
export function periodLabels(rows: { year: number; period: string }[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of rows) if (!m.has(r.year)) m.set(r.year, r.period);
  return m;
}

/**
 * Période d'une commande B2B. Les saisons de collection se lisent telles quelles (PE avant
 * AH dans une même année) ; les commandes hors collection (saisons « Réassort » et
 * « Hors-saison », année 0) sont rangées par ANNÉE DE COMMANDE, entre l'AH de l'année et
 * le PE suivant. Clé = année × 10 + rang (PE 1, AH 2, Réassort 5, Hors-saison 6).
 */
export function b2bPeriod(
  season: { name: string; year: number; type: string },
  orderYear: number | null
): { year: number; period: string } {
  if (season.year > 0 && (season.type === "PE" || season.type === "AH")) {
    return { year: season.year * 10 + (season.type === "PE" ? 1 : 2), period: season.name };
  }
  const rank = season.type === "REASSORT" ? 5 : 6;
  if (!orderYear) return { year: 99990 + rank, period: `${season.name} (sans date)` };
  return { year: orderYear * 10 + rank, period: `${season.name} ${orderYear}` };
}

// ─── Statistiques de tailles ────────────────────────────────────────────

/** Part de chaque taille (en %), à une décimale. Total nul → 0 partout. */
export function sizeShares(sizes: Record<string, number>): Record<string, number> {
  const total = Object.values(sizes).reduce((s, n) => s + n, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sizes)) out[k] = total > 0 ? Math.round((1000 * v) / total) / 10 : 0;
  return out;
}

/** Taille la plus vendue (null si aucune vente ; « ? » ignorée s'il y a mieux). */
export function topSize(sizes: Record<string, number>): string | null {
  const e = Object.entries(sizes).filter(([, n]) => n > 0);
  const known = e.filter(([s]) => s !== UNKNOWN_SIZE);
  const pool = known.length ? known : e;
  return pool.sort((a, b) => b[1] - a[1] || compareSizes(a[0], b[0]))[0]?.[0] ?? null;
}

export interface SizeSummary {
  sizes: string[];
  years: { year: number; period: string; sizes: Record<string, number>; shares: Record<string, number>; total: number; top: string | null }[];
  all: { sizes: Record<string, number>; shares: Record<string, number>; total: number; top: string | null };
}

/** Répartition des tailles de toute la sélection, par année et toutes années. */
export function sizeSummary(rows: SalesAggRow[]): SizeSummary {
  const g = colorGrid("all", rows as SalesAggRow[]);
  return {
    sizes: Object.keys(g.sizes).sort(compareSizes),
    years: g.byYear.map((y) => ({ ...y, shares: sizeShares(y.sizes), top: topSize(y.sizes) })),
    all: { sizes: g.sizes, shares: sizeShares(g.sizes), total: g.total, top: topSize(g.sizes) },
  };
}

// ─── Parts des ventes ───────────────────────────────────────────────────

const share = (part: number, total: number) => (total > 0 ? Math.round((1000 * part) / total) / 10 : 0);

export interface ModelShare {
  model: string;
  label: string;
  category: string;
  qty: number;
  amount: number;
  /** % des pièces de toute la sélection (toutes périodes). */
  shareQty: number;
  /** % du CA de toute la sélection. */
  shareAmount: number;
  /** % des pièces de SA catégorie (utile quand plusieurs catégories sont choisies). */
  shareInCategory: number;
  /** Par période : pièces et % des pièces de la sélection sur cette période. */
  byPeriod: Record<number, { qty: number; share: number }>;
}

/**
 * Poids de chaque modèle dans la sélection : « le pull demi-zip = 31 % des pulls ».
 * Par période, la part se calcule sur le total de la sélection DE CETTE PÉRIODE (le poids
 * d'un modèle en 2024 se lit contre les pulls vendus en 2024, pas contre les 3 ans).
 */
export function modelShares(grids: ProductGrid[]): ModelShare[] {
  const totalQty = grids.reduce((s, g) => s + g.total, 0);
  const totalAmount = grids.reduce((s, g) => s + g.amount, 0);
  const periodTotals: Record<number, number> = {};
  const categoryTotals: Record<string, number> = {};
  for (const g of grids) {
    categoryTotals[g.category] = (categoryTotals[g.category] ?? 0) + g.total;
    for (const [y, q] of Object.entries(g.byYear)) periodTotals[Number(y)] = (periodTotals[Number(y)] ?? 0) + q;
  }
  return grids.map((g) => ({
    model: g.model,
    label: g.label,
    category: g.category,
    qty: g.total,
    amount: g.amount,
    shareQty: share(g.total, totalQty),
    shareAmount: share(g.amount, totalAmount),
    shareInCategory: share(g.total, categoryTotals[g.category] ?? 0),
    byPeriod: Object.fromEntries(
      Object.entries(g.byYear).map(([y, q]) => [Number(y), { qty: q, share: share(q, periodTotals[Number(y)] ?? 0) }])
    ),
  }));
}

/** Part d'une couleur dans son modèle (pièces de la couleur / pièces du modèle), à une décimale. */
export function colorShareInModel(colorQty: number, modelQty: number): number {
  return share(colorQty, modelQty);
}

// ─── Export Excel ───────────────────────────────────────────────────────

const pct = (n: number | undefined) => (n ? `${String(n).replace(".", ",")} %` : "");

/** Classeur : grilles par modèle et couleur (pièces + %), synthèses modèle / couleur / taille, données. */
export function buildSalesHistoryWorkbook(rows: SalesAggRow[], title: string): XLSX.WorkBook {
  const grids = buildProductGrids(rows);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const labels = periodLabels(rows);
  const wb = XLSX.utils.book_new();

  // 1. Grilles : un bloc par modèle, une ligne par couleur et par année ; tailles en pièces
  //    puis en % de la ligne.
  const aoa: (string | number)[][] = [[title], []];
  for (const g of grids) {
    aoa.push([`${g.label} — ${g.model} (${g.category}) — ${g.total} pièces`]);
    aoa.push([`Références : ${g.references.join(", ") || "—"} · Noms : ${g.names.join(" / ")}`]);
    aoa.push(["Couleur", "Période", ...g.sizes, "Total", "% du modèle", ...g.sizes.map((s) => `% ${s}`), "Taille n°1"]);
    const modelByPeriod = new Map(g.allColors.byYear.map((y) => [y.period, y.total]));
    for (const c of [...g.colors, g.allColors]) {
      const lines = [
        ...c.byYear.map((y) => ({ label: y.period, sizes: y.sizes, total: y.total, of: modelByPeriod.get(y.period) ?? 0 })),
        ...(c.byYear.length > 1 ? [{ label: "Total", sizes: c.sizes, total: c.total, of: g.total }] : []),
      ];
      for (const l of lines) {
        const sh = sizeShares(l.sizes);
        aoa.push([
          c.color,
          l.label,
          ...g.sizes.map((s) => l.sizes[s] || ""),
          l.total,
          pct(colorShareInModel(l.total, l.of)),
          ...g.sizes.map((s) => pct(sh[s])),
          topSize(l.sizes) ?? "",
        ]);
      }
    }
    aoa.push([], []);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 7 }, ...Array(30).fill({ wch: 7 })];
  XLSX.utils.book_append_sheet(wb, ws, "Grilles modèle×couleur");

  const add = (data: Record<string, unknown>[], name: string) => {
    if (!data.length) return;
    const s = XLSX.utils.json_to_sheet(data);
    s["!autofilter"] = { ref: s["!ref"]! };
    XLSX.utils.book_append_sheet(wb, s, name);
  };

  // 2. Tailles de toute la sélection, par année.
  const sum = sizeSummary(rows);
  add(
    [...sum.years.map((y) => ({ label: y.period, ...y })), { label: "Toutes périodes", year: 0, ...sum.all }].map(
      (y): Record<string, string | number> => ({
        Période: y.label,
        ...Object.fromEntries(sum.sizes.map((s) => [s, y.sizes[s] ?? 0])),
        Total: y.total,
        ...Object.fromEntries(sum.sizes.map((s) => [`% ${s}`, y.shares[s] ?? 0])),
        "Taille n°1": y.top ?? "",
      })
    ),
    "Tailles par période"
  );

  // 3. Par modèle : pièces et part des ventes par période, puis répartition des tailles.
  const shares = new Map(modelShares(grids).map((m) => [m.model, m]));
  add(
    grids.map((g): Record<string, string | number> => {
      const sh = sizeShares(g.allColors.sizes);
      const m = shares.get(g.model)!;
      return {
        Modèle: g.model,
        Nom: g.label,
        Catégorie: g.category,
        ...Object.fromEntries(years.map((y) => [labels.get(y)!, g.byYear[y] ?? 0])),
        "Total pièces": g.total,
        "% des pièces": m.shareQty,
        ...Object.fromEntries(years.map((y) => [`% ${labels.get(y)}`, m.byPeriod[y]?.share ?? 0])),
        "CA (€)": Math.round(g.amount),
        "% du CA": m.shareAmount,
        "% de sa catégorie": m.shareInCategory,
        "Taille n°1": topSize(g.allColors.sizes) ?? "",
        ...Object.fromEntries(sum.sizes.map((s) => [`% ${s}`, sh[s] ?? 0])),
        Références: g.references.join(", "),
      };
    }),
    "Par modèle"
  );

  // 4. Par couleur (part = % des pièces de la sélection).
  const selectionQty = rows.reduce((s, r) => s + r.qty, 0);
  const byColor = new Map<string, { y: Record<number, number>; q: number; a: number; sizes: Record<string, number> }>();
  for (const r of rows) {
    const e = byColor.get(r.color) ?? { y: {}, q: 0, a: 0, sizes: {} };
    e.y[r.year] = (e.y[r.year] ?? 0) + r.qty;
    e.q += r.qty;
    e.a += r.amount;
    e.sizes[r.size] = (e.sizes[r.size] ?? 0) + r.qty;
    byColor.set(r.color, e);
  }
  add(
    [...byColor.entries()]
      .sort((a, b) => b[1].q - a[1].q)
      .map(([c, e]): Record<string, string | number> => {
        const sh = sizeShares(e.sizes);
        return {
          Couleur: c,
          ...Object.fromEntries(years.map((y) => [labels.get(y)!, e.y[y] ?? 0])),
          "Total pièces": e.q,
          "% des pièces": share(e.q, selectionQty),
          "CA (€)": Math.round(e.a),
          "Taille n°1": topSize(e.sizes) ?? "",
          ...Object.fromEntries(sum.sizes.map((s) => [`% ${s}`, sh[s] ?? 0])),
        };
      }),
    "Par couleur"
  );

  // 5. Données agrégées.
  add(
    rows.map((r) => ({
      Période: r.period,
      Catégorie: r.category,
      Modèle: r.model,
      "Nom du groupe": r.label,
      "Nom vendu": r.productName,
      Référence: r.reference ?? "",
      Couleur: r.color,
      Taille: r.size,
      Pièces: r.qty,
      "CA (€)": round2(r.amount),
    })),
    "Données"
  );
  return wb;
}
