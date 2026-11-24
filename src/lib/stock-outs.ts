// Ruptures de stock BtoC (GESTLOG-14) — logique PURE, testée (stock-outs.test.ts).
// La base (BtocStockOut) garde des PÉRIODES de rupture par variation (couleur × taille),
// tenues à jour par la photo quotidienne du stock WooCommerce envoyée par n8n.

import { parseSku } from "@/lib/sales-history";

/** Variation telle qu'envoyée par n8n (sous-ensemble de l'API WooCommerce /variations). */
export interface SnapshotVariation {
  id: number;
  parent_id?: number | null;
  sku?: string | null;
  name?: string | null; // nom du produit parent
  stock_quantity?: number | null;
  stock_status?: string | null; // instock | outofstock | onbackorder
  manage_stock?: boolean | string | null;
  attributes?: { name?: string | null; option?: string | null }[] | null;
}

/**
 * Une variation est en rupture quand WooCommerce la dit `outofstock`, ou quand son stock
 * géré est ≤ 0 sans commande en réassort autorisée (`onbackorder` = encore vendable).
 */
export function isOutOfStock(v: Pick<SnapshotVariation, "stock_status" | "stock_quantity" | "manage_stock">): boolean {
  const status = String(v.stock_status ?? "").toLowerCase();
  if (status === "outofstock") return true;
  if (status === "onbackorder") return false;
  const managed = v.manage_stock === true || v.manage_stock === "true" || v.manage_stock === "parent";
  return managed && v.stock_quantity != null && Number(v.stock_quantity) <= 0;
}

const SIZE_ATTR = /taille|size/i;
const COLOR_ATTR = /couleur|colou?r|coloris/i;

/** Référence, couleur et taille d'une variation : l'UGS d'abord (RÉF-COULEUR-TAILLE), puis ses attributs. */
export function describeVariation(v: SnapshotVariation): {
  reference: string | null;
  colorCode: string | null;
  color: string | null;
  size: string | null;
} {
  const fromSku = parseSku(v.sku);
  const attrs = Array.isArray(v.attributes) ? v.attributes : [];
  const attrSize = attrs.find((a) => SIZE_ATTR.test(a?.name ?? ""))?.option ?? null;
  const attrColor = attrs.find((a) => COLOR_ATTR.test(a?.name ?? ""))?.option ?? null;
  return {
    reference: fromSku.reference,
    colorCode: fromSku.colorCode,
    color: attrColor ? String(attrColor).trim() : null,
    size: fromSku.size ?? (attrSize ? String(attrSize).trim().toUpperCase() : null),
  };
}

export interface OpenPeriod {
  id: string;
  lastSeenDay: string; // AAAA-MM-JJ
}

export type SnapshotAction =
  | { kind: "open" } // nouvelle rupture : startDay = lastSeenDay = jour
  | { kind: "extend"; id: string } // rupture qui continue : lastSeenDay = jour
  | { kind: "close"; id: string } // retour en stock : endDay = jour
  | { kind: "none" };

/** Que faire d'une variation observée `out` (ou non) un jour donné, sachant sa période ouverte éventuelle. */
export function snapshotAction(out: boolean, open: OpenPeriod | null, day: string): SnapshotAction {
  if (out) {
    if (!open) return { kind: "open" };
    return open.lastSeenDay >= day ? { kind: "none" } : { kind: "extend", id: open.id };
  }
  if (open && open.lastSeenDay < day) return { kind: "close", id: open.id };
  return { kind: "none" };
}

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);
/** Nombre de jours de `a` (inclus) à `b` (exclu). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

export interface StockOutPeriod {
  startDay: string;
  lastSeenDay: string;
  endDay: string | null;
}

/**
 * Jours de rupture d'une période comptés dans [from, to] (inclus).
 * Fin effective : `endDay` si la variation est revenue en stock ; sinon, si elle était encore
 * en rupture à la dernière photo (`lastSeenDay` ≥ dernière photo), jusqu'à `to` ; sinon
 * (variation disparue du site, photos manquées) on s'arrête au lendemain de `lastSeenDay`.
 */
export function outDaysInRange(p: StockOutPeriod, from: string, to: string, lastSnapshotDay: string): number {
  const endExcl = p.endDay ?? (p.lastSeenDay >= lastSnapshotDay ? addDays(to, 1) : addDays(p.lastSeenDay, 1));
  const a = p.startDay > from ? p.startDay : from;
  const toExcl = addDays(to, 1);
  const b = endExcl < toExcl ? endExcl : toExcl;
  return Math.max(0, daysBetween(a, b));
}

/**
 * Ventes manquées estimées = rythme de vente EN STOCK × jours de rupture.
 * rythme = pièces vendues sur la fenêtre de référence ÷ jours en stock sur cette fenêtre
 * (jours de la fenêtre − jours de rupture observés). Si la variation n'a jamais été en
 * stock sur la fenêtre, on ne peut rien estimer → 0.
 */
export function estimateMissed(args: {
  soldInWindow: number;
  windowDays: number;
  outDaysInWindow: number;
  outDaysInRange: number;
}): { dailyRate: number; missed: number } {
  const inStockDays = args.windowDays - args.outDaysInWindow;
  if (inStockDays <= 0 || args.soldInWindow <= 0) return { dailyRate: 0, missed: 0 };
  const dailyRate = args.soldInWindow / inStockDays;
  return { dailyRate, missed: Math.round(dailyRate * args.outDaysInRange * 10) / 10 };
}

// ─── Rapport ────────────────────────────────────────────────────────────

export interface ReportPeriod extends StockOutPeriod {
  variationWooId: number;
  sku: string | null;
  reference: string | null;
  colorCode: string | null;
  color: string | null;
  size: string | null;
  productName: string;
}

export interface StockOutReportRow {
  sku: string | null;
  reference: string | null;
  productName: string;
  color: string;
  size: string;
  periods: number; // ruptures distinctes dans la période demandée
  outDays: number; // jours de rupture dans la période demandée
  ongoing: boolean; // encore en rupture à la dernière photo
  since: string | null; // début de la rupture en cours
  soldInWindow: number; // pièces vendues sur la fenêtre de référence
  dailyRate: number; // pièces / jour en stock
  missed: number; // pièces manquées estimées
  missedAmount: number; // € manqués estimés (prix moyen de vente de l'UGS)
}

/**
 * Une ligne par variation (UGS) : jours de rupture sur [from, to] et ventes manquées
 * estimées, avec un rythme de vente mesuré sur [windowFrom, to] (jours en stock seulement).
 */
export function buildStockOutReport(
  periods: ReportPeriod[],
  sales: Map<string, { qty: number; amount: number }>,
  opts: { from: string; to: string; windowFrom: string; lastSnapshotDay: string }
): StockOutReportRow[] {
  const byVar = new Map<number, ReportPeriod[]>();
  for (const p of periods) {
    const list = byVar.get(p.variationWooId) ?? [];
    list.push(p);
    byVar.set(p.variationWooId, list);
  }
  const windowDays = daysBetween(opts.windowFrom, addDays(opts.to, 1));
  const rows: StockOutReportRow[] = [];
  for (const list of byVar.values()) {
    let outDays = 0;
    let outWindow = 0;
    let count = 0;
    let since: string | null = null;
    for (const p of list) {
      const inRange = outDaysInRange(p, opts.from, opts.to, opts.lastSnapshotDay);
      if (inRange > 0) count++;
      outDays += inRange;
      outWindow += outDaysInRange(p, opts.windowFrom, opts.to, opts.lastSnapshotDay);
      if (!p.endDay && p.lastSeenDay >= opts.lastSnapshotDay) since = p.startDay;
    }
    if (outDays <= 0) continue;
    const ref = list[list.length - 1];
    const s = ref.sku ? sales.get(ref.sku.toUpperCase()) : undefined;
    const sold = Math.max(0, s?.qty ?? 0);
    const { dailyRate, missed } = estimateMissed({ soldInWindow: sold, windowDays, outDaysInWindow: outWindow, outDaysInRange: outDays });
    const unitPrice = s && s.qty > 0 ? s.amount / s.qty : 0;
    rows.push({
      sku: ref.sku,
      reference: ref.reference,
      productName: ref.productName,
      color: ref.color || ref.colorCode || "?",
      size: ref.size || "?",
      periods: count,
      outDays,
      ongoing: since !== null,
      since,
      soldInWindow: sold,
      dailyRate: Math.round(dailyRate * 100) / 100,
      missed,
      missedAmount: Math.round(missed * unitPrice),
    });
  }
  return rows.sort((a, b) => b.missedAmount - a.missedAmount || b.missed - a.missed || b.outDays - a.outDays);
}
