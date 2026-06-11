import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

// GET — Répartition des ventes BtoC par TAILLE, regroupée par SOUS-CATÉGORIE BtoB
// (Product.subCategory, PAS la catégorie BtoC). Pour chaque sous-catégorie, le %
// de chaque taille par rapport au total des ventes de la sous-catégorie.
//
// Matching vente → produit BtoB : préfixe SKU (réf parente) avec repli "corps"
// saison-agnostique (réf sans le 1er caractère = code saison), comme l'export.
// Filtre date optionnel (dateFrom / dateTo).

// Ordre canonique des tailles (numériques croissantes, puis alpha S→5XL).
const ALPHA_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "TU", "U"];
function sizeRank(s: string): [number, number, string] {
  const u = s.toUpperCase();
  if (/^\d+$/.test(u)) return [0, parseInt(u, 10), u];
  const i = ALPHA_ORDER.indexOf(u);
  return [1, i === -1 ? 999 : i, u];
}

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const dateFrom = p.get("dateFrom");
    const dateTo = p.get("dateTo");
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59.999") : null;

    const rows = await prisma.$queryRawUnsafe<
      { subCategory: string; size: string; qty: bigint }[]
    >(
      `WITH sales AS (
        -- Ventes (quantité positive)
        SELECT
          SPLIT_PART(ol.sku, '-', 1) AS ref,
          COALESCE(NULLIF(UPPER(ol.size), ''), UPPER(SPLIT_PART(ol.sku, '-', 3))) AS size,
          ol.quantity AS qty
        FROM "BtocOrderLine" ol
        JOIN "BtocOrder" o ON o.id = ol."orderId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND ol.sku IS NOT NULL AND ol.sku != ''
          AND ($1::timestamp IS NULL OR o."orderDate" >= $1)
          AND ($2::timestamp IS NULL OR o."orderDate" <= $2)
        UNION ALL
        -- Remboursements (quantité négative) — déduits des ventes
        SELECT
          SPLIT_PART(rl.sku, '-', 1) AS ref,
          UPPER(SPLIT_PART(rl.sku, '-', 3)) AS size,
          -rl.quantity AS qty
        FROM "BtocRefundLine" rl
        JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND rl.sku IS NOT NULL AND rl.sku != ''
          AND ($1::timestamp IS NULL OR o."orderDate" >= $1)
          AND ($2::timestamp IS NULL OR o."orderDate" <= $2)
      ),
      matched AS (
        SELECT s.size, s.qty,
          COALESCE(
            (SELECT pr."subCategory" FROM "Product" pr WHERE pr.reference = s.ref AND pr."subCategory" IS NOT NULL AND pr."subCategory" != '' LIMIT 1),
            (SELECT pr."subCategory" FROM "Product" pr WHERE SUBSTRING(pr.reference FROM 2) = SUBSTRING(s.ref FROM 2) AND pr."subCategory" IS NOT NULL AND pr."subCategory" != '' LIMIT 1)
          ) AS "subCategory"
        FROM sales s
      )
      SELECT "subCategory", size, SUM(qty)::bigint AS qty
      FROM matched
      WHERE "subCategory" IS NOT NULL AND size IS NOT NULL AND size != ''
      GROUP BY "subCategory", size`,
      from,
      to
    );

    // Regroupe par sous-catégorie + calcule les %.
    const bySubCat = new Map<string, { size: string; qty: number }[]>();
    for (const r of rows) {
      if (!bySubCat.has(r.subCategory)) bySubCat.set(r.subCategory, []);
      bySubCat.get(r.subCategory)!.push({ size: r.size, qty: Number(r.qty) });
    }

    const subCategories = [...bySubCat.entries()]
      .map(([subCategory, sizes]) => {
        const total = sizes.reduce((s, x) => s + x.qty, 0);
        const ordered = sizes
          .map((x) => ({
            size: x.size,
            qty: x.qty,
            pct: total > 0 ? Math.round((1000 * x.qty) / total) / 10 : 0,
          }))
          .sort((a, b) => {
            const ra = sizeRank(a.size);
            const rb = sizeRank(b.size);
            return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
          });
        return { subCategory, total, sizes: ordered };
      })
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ subCategories });
  } catch (e) {
    return handleApiError(e, "api/btoc/size-distribution");
  }
}
