import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisDayExpr } from "@/lib/btoc-dates";
import { ANOMALY_KINDS, reconcile, type Resolution, type SfSide, type WooSide } from "@/lib/marketplace-reconcile";

// GET — contrôle des commandes marketplaces (La Redoute via Shopping Feed) face à WooCommerce
// (GESTLOG-15). Paramètres : dateFrom / dateTo (AAAA-MM-JJ, jour de commande, heure de Paris ;
// défaut : les 30 derniers jours). On rapproche sur une fenêtre élargie de 3 jours de chaque côté
// pour qu'une commande à cheval sur la borne ne passe pas pour absente, puis on garde les lignes
// de la période. Voir lib/marketplace-reconcile.ts.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parisDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const today = parisDay(new Date());
    const to = DAY.test(p.get("dateTo") || "") ? (p.get("dateTo") as string) : today;
    const from = DAY.test(p.get("dateFrom") || "") ? (p.get("dateFrom") as string) : shift(to, -29);
    const [wFrom, wTo] = [shift(from, -3), shift(to, 3)];

    const [sfRows, syncs, span, resolved] = await Promise.all([
      prisma.$queryRawUnsafe<(Omit<SfSide, "createdAt"> & { createdAt: Date })[]>(
        `SELECT "sfId", reference, "storeReference", channel, status, "isTest",
                ("orderCreatedAt" AT TIME ZONE 'UTC') AS "createdAt",
                to_char(${parisDayExpr('"orderCreatedAt"')}, 'YYYY-MM-DD') AS day,
                "totalAmount" AS total, "itemCount" AS qty
           FROM "MarketplaceOrder"
          WHERE (${parisDayExpr('"orderCreatedAt"')})::date BETWEEN $1::date AND $2::date`,
        wFrom,
        wTo
      ),
      prisma.$queryRawUnsafe<{ syncType: string; last: Date }[]>(
        `SELECT "syncType", MAX("syncedAt" AT TIME ZONE 'UTC') AS last FROM "BtocSyncLog"
          WHERE "syncType" IN ('ORDERS', 'MARKETPLACE_ORDERS') GROUP BY 1`
      ),
      // Historique Woo connu de GestLog : avant le début, une commande marketplace ne peut pas
      // être contrôlée ; après la plus récente, elle n'est pas encore synchronisée.
      prisma.$queryRawUnsafe<{ first: Date | null; last: Date | null }[]>(
        `SELECT MIN("orderDate" AT TIME ZONE 'UTC') AS first, MAX("orderDate" AT TIME ZONE 'UTC') AS last FROM "BtocOrder"`
      ),
      prisma.marketplaceResolution.findMany(),
    ]);
    // Commandes Woo de la fenêtre, plus celles créées PLUS TARD pour une commande marketplace de
    // la période (ex. import Shopping Feed réussi après coup) : rapprochées par leur n° marketplace.
    const wooRows = await prisma.$queryRawUnsafe<WooSide[]>(
      `SELECT "wooId", "orderNumber", "marketplaceRef", marketplace, status, total,
              COALESCE("totalRefunded", 0) AS "totalRefunded", "itemCount" AS qty,
              to_char(${parisDayExpr('"orderDate"')}, 'YYYY-MM-DD') AS day
         FROM "BtocOrder"
        WHERE (marketplace IS NOT NULL OR "paymentMethod" = 'shopping-feed')
          AND ((${parisDayExpr('"orderDate"')})::date BETWEEN $1::date AND $2::date OR "marketplaceRef" = ANY($3::text[]))`,
      wFrom,
      wTo,
      sfRows.map((r) => r.reference)
    );
    const resolutions = new Map<string, Resolution>(
      resolved.map((r) => [r.reference, { note: r.note, by: r.resolvedBy, at: r.resolvedAt.toISOString() }])
    );
    const wooFirst = span[0]?.first ? new Date(span[0].first).toISOString() : null;
    const wooLast = span[0]?.last ? new Date(span[0].last).toISOString() : null;

    const lastOf = (t: string) => syncs.find((s) => s.syncType === t)?.last ?? null;
    const lastWoo = lastOf("ORDERS");
    const lastSf = lastOf("MARKETPLACE_ORDERS");
    const rows = reconcile(
      sfRows
        .map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), total: Number(r.total), qty: Number(r.qty) }))
        .filter((r) => !wooFirst || r.createdAt >= wooFirst),
      wooRows.map((r) => ({ ...r, wooId: Number(r.wooId), total: Number(r.total), totalRefunded: Number(r.totalRefunded), qty: Number(r.qty) })),
      wooLast,
      resolutions
    ).filter((r) => r.day >= from && r.day <= to);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const sfAmount = rows.reduce((s, r) => s + (r.sfTotal ?? 0), 0);
    const wooAmount = rows.reduce((s, r) => s + (r.wooTotal ?? 0), 0);

    return NextResponse.json({
      from,
      to,
      lastWooSync: lastWoo ? new Date(lastWoo).toISOString() : null,
      lastSfSync: lastSf ? new Date(lastSf).toISOString() : null,
      wooFirstOrder: wooFirst,
      counts,
      anomalies: rows.filter((r) => ANOMALY_KINDS.includes(r.kind)).length,
      sfOrders: rows.filter((r) => r.sfStatus !== null).length,
      sfAmount: Math.round(sfAmount * 100) / 100,
      wooAmount: Math.round(wooAmount * 100) / 100,
      rows,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/marketplaces");
  }
}
