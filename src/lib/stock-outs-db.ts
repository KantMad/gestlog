// Accès base des ruptures BtoC (écran Analyse → Ruptures de stock, GESTLOG-14).

import { prisma } from "@/lib/prisma";
import { parisDayExpr } from "@/lib/btoc-dates";
import { liveStartDay } from "@/lib/sales-history-db";

export interface StockOutRow {
  variationWooId: number;
  parentWooId: number | null;
  sku: string | null;
  reference: string | null;
  colorCode: string | null;
  color: string | null;
  size: string | null;
  productName: string;
  startDay: string;
  lastSeenDay: string;
  endDay: string | null;
}

/** Périodes de rupture qui touchent [from, to]. */
export async function stockOutPeriods(from: string, to: string): Promise<StockOutRow[]> {
  return prisma.$queryRawUnsafe<StockOutRow[]>(
    `SELECT "variationWooId", "parentWooId", sku, reference, "colorCode", color, size, "productName",
            to_char("startDay", 'YYYY-MM-DD') AS "startDay",
            to_char("lastSeenDay", 'YYYY-MM-DD') AS "lastSeenDay",
            to_char("endDay", 'YYYY-MM-DD') AS "endDay"
       FROM "BtocStockOut"
      WHERE "startDay" <= $2::date AND ("endDay" IS NULL OR "endDay" > $1::date)
      ORDER BY "startDay"`,
    from,
    to
  );
}

/** Premier et dernier jour de photo du stock, et nombre de jours photographiés. */
export async function snapshotSpan(): Promise<{ first: string | null; last: string | null; days: number }> {
  const r = await prisma.$queryRawUnsafe<{ first: string | null; last: string | null; days: bigint }[]>(
    `SELECT to_char(MIN(day), 'YYYY-MM-DD') AS first, to_char(MAX(day), 'YYYY-MM-DD') AS last, COUNT(*) AS days
       FROM "BtocStockSnapshotRun"`
  );
  return { first: r[0]?.first ?? null, last: r[0]?.last ?? null, days: Number(r[0]?.days ?? 0) };
}

/**
 * Ventes BtoC par UGS (en majuscules) sur [from, to] : historique importé avant la synchro
 * live, puis commandes live (hors annulées/remboursées/échouées), remboursements déduits.
 * Mêmes règles que l'Historique des ventes.
 */
export async function salesBySku(from: string, to: string): Promise<Map<string, { qty: number; amount: number }>> {
  const cutoff = await liveStartDay();
  const day = parisDayExpr('o."orderDate"');
  const rows = await prisma.$queryRawUnsafe<{ sku: string; qty: bigint; amount: number }[]>(
    `WITH lines AS (
       SELECT UPPER(h.sku) AS sku, h.quantity AS qty, h."lineTotal" AS amount
         FROM "SalesHistoryLine" h
        WHERE h.channel = 'BTOC' AND h.sku IS NOT NULL
          AND ($1::date IS NULL OR h."orderDay" < $1::date)
          AND h."orderDay" BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT UPPER(ol.sku), ol.quantity, ol.total
         FROM "BtocOrderLine" ol JOIN "BtocOrder" o ON o.id = ol."orderId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed') AND ol.sku IS NOT NULL AND ol.sku != ''
          AND ${day}::date BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT UPPER(rl.sku), -rl.quantity, -rl.total
         FROM "BtocRefundLine" rl JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed') AND rl.sku IS NOT NULL AND rl.sku != ''
          AND ${day}::date BETWEEN $2::date AND $3::date
     )
     SELECT sku, SUM(qty)::bigint AS qty, SUM(amount)::float8 AS amount FROM lines GROUP BY 1`,
    cutoff,
    from,
    to
  );
  return new Map(rows.map((r) => [r.sku, { qty: Number(r.qty), amount: Number(r.amount) }]));
}
