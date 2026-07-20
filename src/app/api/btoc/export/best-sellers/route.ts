import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";

// ─── Best Sellers export ────────────────────────────────
// Les références qui se vendent le mieux, classées par quantité vendue.
// Colonnes : Référence, Nom produit, Quantité vendue, CA.
//
// Deux sources fusionnées :
//   • BtocOrderLine (boutique live, statuts annulés/remboursés/échoués exclus)
//   • HistOrderLine (historique importé) — seules les lignes avec une référence
//     sont rattachables (les produits sans SKU de l'export legacy sont ignorés).
// Matching produit via BtocProduct (nom). Filtre date optionnel sur la commande.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limitParam = Number(params.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 10;

    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    // Bornes en fuseau Paris (jour de fin inclus), cf. lib/btoc-dates.
    const { gte: from, lt: to } = parisRangeToUtc(dateFrom, dateTo);

    const rows = await prisma.$queryRawUnsafe<
      {
        reference: string;
        productName: string;
        quantity: bigint;
        revenue: number;
      }[]
    >(
      `WITH lines AS (
        -- Boutique live
        SELECT
          SPLIT_PART(ol.sku, '-', 1)        AS reference,
          COALESCE(bp.name, ol.name)        AS name,
          ol.quantity                       AS qty,
          ol.total                          AS revenue,
          o."orderDate"                     AS order_date
        FROM "BtocOrderLine" ol
        JOIN "BtocOrder" o ON o.id = ol."orderId"
        LEFT JOIN "BtocProduct" bp ON bp.sku = SPLIT_PART(ol.sku, '-', 1)
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND ol.sku IS NOT NULL AND ol.sku != ''
        UNION ALL
        -- Historique importé
        SELECT
          hl.reference,
          COALESCE(bp.name, hl."productName"),
          hl.quantity,
          hl."lineTotal",
          h."orderDate"
        FROM "HistOrderLine" hl
        JOIN "HistOrder" h ON h.id = hl."histOrderId"
        LEFT JOIN "BtocProduct" bp ON bp.sku = hl.reference
        WHERE hl.reference IS NOT NULL AND hl.reference != ''
        UNION ALL
        -- Remboursements (quantité + CA négatifs) — déduits des ventes live
        SELECT
          SPLIT_PART(rl.sku, '-', 1),
          COALESCE(bp.name, rl.name),
          -rl.quantity,
          -rl.total,
          o."orderDate"
        FROM "BtocRefundLine" rl
        JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        LEFT JOIN "BtocProduct" bp ON bp.sku = SPLIT_PART(rl.sku, '-', 1)
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND rl.sku IS NOT NULL AND rl.sku != ''
      )
      SELECT
        reference,
        MAX(name)    AS "productName",
        SUM(qty)     AS quantity,
        SUM(revenue) AS revenue
      FROM lines
      WHERE ($1::timestamp IS NULL OR order_date >= $1)
        AND ($2::timestamp IS NULL OR order_date < $2)
      GROUP BY reference
      ORDER BY quantity DESC
      LIMIT ${limit}`,
      from,
      to
    );

    return NextResponse.json({
      products: rows.map((r) => ({
        reference: r.reference,
        productName: r.productName,
        quantity: Number(r.quantity),
        revenue: Math.round(Number(r.revenue) * 100) / 100,
      })),
      total: rows.length,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/export/best-sellers");
  }
}
