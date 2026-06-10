import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── Best Sellers export ────────────────────────────────
// Les références qui se vendent le mieux, classées par quantité vendue.
// Colonnes : Référence, Nom produit, Quantité vendue, CA.
// Exclut les commandes annulées / remboursées / échouées (pas de vraies ventes).
export async function GET(request: NextRequest) {
  try {
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 10;

    const rows = await prisma.$queryRawUnsafe<
      {
        reference: string;
        productName: string;
        quantity: bigint;
        revenue: number;
      }[]
    >(
      `SELECT
        SPLIT_PART(ol.sku, '-', 1) AS reference,
        MAX(COALESCE(bp.name, ol.name)) AS "productName",
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       LEFT JOIN "BtocProduct" bp ON bp.sku = SPLIT_PART(ol.sku, '-', 1)
       WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
         AND ol.sku IS NOT NULL AND ol.sku != ''
       GROUP BY SPLIT_PART(ol.sku, '-', 1)
       ORDER BY quantity DESC
       LIMIT ${limit}`
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
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
