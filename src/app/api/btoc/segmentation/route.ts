import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc, parisDayExpr } from "@/lib/btoc-dates";

export const maxDuration = 60;

// GET — Segmentation de la clientèle BtoC.
//   ?dateFrom&dateTo (bornes Paris)  ?statuses=csv
//
// ⚠️ Le CLIENT est identifié par son **e-mail** (minuscule), pas par `customerId` :
// une commande sur deux est passée **sans compte** (2 253 comptes pour 3 176 e-mails).
// Grouper par compte perdrait tous les invités.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const { gte, lt } = parisRangeToUtc(p.get("dateFrom"), p.get("dateTo"));
    const statuses = (p.get("statuses") || "").split(",").map((s) => s.trim()).filter(Boolean);

    const params: unknown[] = [gte, lt];
    const statusCond =
      statuses.length > 0
        ? `o.status = ANY($${params.push(statuses)})`
        : `o.status NOT IN ('cancelled', 'refunded', 'failed')`;
    const dateCond = `($1::timestamp IS NULL OR o."orderDate" >= $1) AND ($2::timestamp IS NULL OR o."orderDate" < $2)`;
    const day = parisDayExpr('o."orderDate"');

    // Une commande = un client (e-mail) + ses marqueurs de période promotionnelle.
    // Le CA retenu est le montant réellement encaissé : total − remboursé.
    const ORDERS = `
      SELECT LOWER(o."customerEmail") AS email,
             o.id, o.total - COALESCE(o."totalRefunded", 0) AS net,
             o."discountTotal", o."couponCodes",
             EXTRACT(DAY   FROM ${day})::int AS d,
             EXTRACT(MONTH FROM ${day})::int AS m
      FROM "BtocOrder" o
      WHERE o."customerEmail" IS NOT NULL AND o."customerEmail" <> ''
        AND ${dateCond} AND ${statusCond}`;

    // ── Vue d'ensemble + fréquence d'achat ──────────────────────────────────
    const overview = await prisma.$queryRawUnsafe<
      { clients: bigint; orders: bigint; revenue: number; pieces: bigint | null }[]
    >(
      `WITH o AS (${ORDERS})
       SELECT COUNT(DISTINCT email) AS clients, COUNT(*) AS orders,
              COALESCE(SUM(net), 0) AS revenue,
              (SELECT COALESCE(SUM(l.quantity), 0) FROM "BtocOrderLine" l WHERE l."orderId" IN (SELECT id FROM o)) AS pieces
       FROM o`,
      ...params
    );

    const frequency = await prisma.$queryRawUnsafe<
      { bucket: string; clients: bigint; orders: bigint; revenue: number }[]
    >(
      `WITH o AS (${ORDERS}),
       per_client AS (
         SELECT email, COUNT(*) AS n, SUM(net) AS spent FROM o GROUP BY email
       )
       SELECT CASE WHEN n >= 5 THEN '5+' ELSE n::text END AS bucket,
              COUNT(*) AS clients, SUM(n) AS orders, COALESCE(SUM(spent), 0) AS revenue
       FROM per_client GROUP BY 1 ORDER BY 1`,
      ...params
    );

    // ── Achats en période promotionnelle ────────────────────────────────────
    // Deux lectures COMPLÉMENTAIRES :
    //   • par FENÊTRE de dates (la définition métier : Black Friday, soldes, fin de mois) ;
    //   • par REMISE RÉELLE (`discountTotal > 0` ou code promo) — plus fiable, car une
    //     commande peut être remisée hors fenêtre, et une commande en fenêtre peut être
    //     au plein tarif.
    const promo = await prisma.$queryRawUnsafe<
      {
        black_friday_orders: bigint; black_friday_clients: bigint; black_friday_revenue: number;
        soldes_orders: bigint; soldes_clients: bigint; soldes_revenue: number;
        fin_mois_orders: bigint; fin_mois_clients: bigint; fin_mois_revenue: number;
        any_window_orders: bigint; any_window_clients: bigint; any_window_revenue: number;
        discounted_orders: bigint; discounted_clients: bigint; discounted_revenue: number;
      }[]
    >(
      `WITH o AS (${ORDERS}),
       flagged AS (
         SELECT *,
           (m = 11 AND d BETWEEN 20 AND 30) AS is_bf,
           (m = 1 OR (m = 6 AND d >= 20) OR m = 7) AS is_soldes,
           (d >= 25) AS is_fin_mois,
           (COALESCE("discountTotal", 0) > 0 OR "couponCodes" IS NOT NULL) AS is_discounted
         FROM o
       )
       SELECT
         COUNT(*) FILTER (WHERE is_bf) AS black_friday_orders,
         COUNT(DISTINCT email) FILTER (WHERE is_bf) AS black_friday_clients,
         COALESCE(SUM(net) FILTER (WHERE is_bf), 0) AS black_friday_revenue,
         COUNT(*) FILTER (WHERE is_soldes) AS soldes_orders,
         COUNT(DISTINCT email) FILTER (WHERE is_soldes) AS soldes_clients,
         COALESCE(SUM(net) FILTER (WHERE is_soldes), 0) AS soldes_revenue,
         COUNT(*) FILTER (WHERE is_fin_mois) AS fin_mois_orders,
         COUNT(DISTINCT email) FILTER (WHERE is_fin_mois) AS fin_mois_clients,
         COALESCE(SUM(net) FILTER (WHERE is_fin_mois), 0) AS fin_mois_revenue,
         COUNT(*) FILTER (WHERE is_bf OR is_soldes OR is_fin_mois) AS any_window_orders,
         COUNT(DISTINCT email) FILTER (WHERE is_bf OR is_soldes OR is_fin_mois) AS any_window_clients,
         COALESCE(SUM(net) FILTER (WHERE is_bf OR is_soldes OR is_fin_mois), 0) AS any_window_revenue,
         COUNT(*) FILTER (WHERE is_discounted) AS discounted_orders,
         COUNT(DISTINCT email) FILTER (WHERE is_discounted) AS discounted_clients,
         COALESCE(SUM(net) FILTER (WHERE is_discounted), 0) AS discounted_revenue
       FROM flagged`,
      ...params
    );

    // Clients qui n'achètent QUE en promo (toutes leurs commandes remisées).
    const promoOnly = await prisma.$queryRawUnsafe<{ promo_only: bigint; never_promo: bigint }[]>(
      `WITH o AS (${ORDERS}),
       per_client AS (
         SELECT email, COUNT(*) AS n,
                COUNT(*) FILTER (WHERE COALESCE("discountTotal",0) > 0 OR "couponCodes" IS NOT NULL) AS n_promo
         FROM o GROUP BY email
       )
       SELECT COUNT(*) FILTER (WHERE n_promo = n) AS promo_only,
              COUNT(*) FILTER (WHERE n_promo = 0) AS never_promo
       FROM per_client`,
      ...params
    );

    // ── Répartition des paniers ─────────────────────────────────────────────
    const baskets = await prisma.$queryRawUnsafe<{ bucket: string; orders: bigint; revenue: number }[]>(
      `WITH o AS (${ORDERS})
       SELECT CASE
         WHEN net < 50 THEN '1. < 50 €'
         WHEN net < 100 THEN '2. 50–100 €'
         WHEN net < 150 THEN '3. 100–150 €'
         WHEN net < 250 THEN '4. 150–250 €'
         ELSE '5. 250 € et +' END AS bucket,
         COUNT(*) AS orders, COALESCE(SUM(net), 0) AS revenue
       FROM o GROUP BY 1 ORDER BY 1`,
      ...params
    );

    // ── Tailles commandées ──────────────────────────────────────────────────
    // ⚠️ Les tailles arrivent de Woo en MINUSCULES ("l", "xl") → on normalise.
    const sizes = await prisma.$queryRawUnsafe<
      { size: string; pieces: bigint; orders: bigint; clients: bigint }[]
    >(
      `WITH o AS (${ORDERS})
       SELECT UPPER(TRIM(l.size)) AS size, SUM(l.quantity) AS pieces,
              COUNT(DISTINCT l."orderId") AS orders, COUNT(DISTINCT o.email) AS clients
       FROM "BtocOrderLine" l JOIN o ON o.id = l."orderId"
       WHERE l.size IS NOT NULL AND TRIM(l.size) <> ''
       GROUP BY 1 ORDER BY pieces DESC`,
      ...params
    );

    const n = (v: bigint | number | null) => Number(v ?? 0);
    const o0 = overview[0];
    const pr = promo[0];

    return NextResponse.json({
      overview: {
        clients: n(o0?.clients),
        orders: n(o0?.orders),
        revenue: Math.round(n(o0?.revenue) * 100) / 100,
        pieces: n(o0?.pieces),
        ordersPerClient: n(o0?.clients) ? n(o0?.orders) / n(o0?.clients) : 0,
        averageBasket: n(o0?.orders) ? n(o0?.revenue) / n(o0?.orders) : 0,
      },
      frequency: frequency.map((f) => ({
        bucket: f.bucket, clients: n(f.clients), orders: n(f.orders),
        revenue: Math.round(n(f.revenue) * 100) / 100,
      })),
      promo: {
        windows: [
          { key: "black_friday", label: "Black Friday (20–30 nov.)", orders: n(pr?.black_friday_orders), clients: n(pr?.black_friday_clients), revenue: Math.round(n(pr?.black_friday_revenue) * 100) / 100 },
          { key: "soldes", label: "Soldes (janv. · 20 juin–juil.)", orders: n(pr?.soldes_orders), clients: n(pr?.soldes_clients), revenue: Math.round(n(pr?.soldes_revenue) * 100) / 100 },
          { key: "fin_mois", label: "Fin de mois (25 → 31)", orders: n(pr?.fin_mois_orders), clients: n(pr?.fin_mois_clients), revenue: Math.round(n(pr?.fin_mois_revenue) * 100) / 100 },
          { key: "any", label: "Au moins une fenêtre", orders: n(pr?.any_window_orders), clients: n(pr?.any_window_clients), revenue: Math.round(n(pr?.any_window_revenue) * 100) / 100 },
        ],
        discounted: {
          orders: n(pr?.discounted_orders), clients: n(pr?.discounted_clients),
          revenue: Math.round(n(pr?.discounted_revenue) * 100) / 100,
        },
        promoOnlyClients: n(promoOnly[0]?.promo_only),
        neverPromoClients: n(promoOnly[0]?.never_promo),
      },
      baskets: baskets.map((b) => ({
        bucket: b.bucket.replace(/^\d\.\s*/, ""), orders: n(b.orders),
        revenue: Math.round(n(b.revenue) * 100) / 100,
      })),
      sizes: sizes.map((s) => ({
        size: s.size, pieces: n(s.pieces), orders: n(s.orders), clients: n(s.clients),
      })),
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/segmentation");
  }
}
