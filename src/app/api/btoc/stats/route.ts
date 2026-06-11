import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const category = params.get("category");
    const parentProduct = params.get("parentProduct"); // now expects a SKU / reference
    const customerId = params.get("customerId");

    // ─── Build WHERE clauses for orders ──────────────────────
    const orderConditions: string[] = [];
    const orderParams: unknown[] = [];
    let paramIndex = 1;

    if (dateFrom) {
      orderConditions.push(`o."orderDate" >= $${paramIndex}`);
      orderParams.push(new Date(dateFrom));
      paramIndex++;
    }
    if (dateTo) {
      orderConditions.push(`o."orderDate" <= $${paramIndex}`);
      orderParams.push(new Date(dateTo));
      paramIndex++;
    }
    if (customerId) {
      orderConditions.push(`o."customerId" = $${paramIndex}`);
      orderParams.push(customerId);
      paramIndex++;
    }

    // Category and parentProduct require joins with order lines / products
    const needsLineJoin = !!category || !!parentProduct;
    let lineJoin = "";
    if (needsLineJoin) {
      lineJoin = `JOIN "BtocOrderLine" ol ON ol."orderId" = o.id
                  LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)`;
      if (category) {
        orderConditions.push(`p.category ILIKE '%' || $${paramIndex} || '%'`);
        orderParams.push(category);
        paramIndex++;
      }
      if (parentProduct) {
        orderConditions.push(`p.sku ILIKE $${paramIndex}`);
        orderParams.push(`%${parentProduct}%`);
        paramIndex++;
      }
    }

    const whereClause =
      orderConditions.length > 0
        ? "WHERE " + orderConditions.join(" AND ")
        : "";

    // Filtre "chiffre d'affaires" : on exclut les commandes annulées, remboursées
    // et échouées (cohérent avec les exports). Appliqué aux requêtes de CA
    // UNIQUEMENT — pas au graphe "commandes par statut" qui doit tout afficher.
    const REVENUE_FILTER = `o.status NOT IN ('cancelled', 'refunded', 'failed')`;
    const revenueWhere = whereClause
      ? `${whereClause} AND ${REVENUE_FILTER}`
      : `WHERE ${REVENUE_FILTER}`;

    // ─── Overview ────────────────────────────────────────────
    const overviewRows = await prisma.$queryRawUnsafe<
      {
        totalOrders: bigint;
        totalRevenue: number;
        totalCustomers: bigint;
        avgOrderValue: number;
        totalItems: bigint;
      }[]
    >(
      // On dédoublonne les commandes (le lineJoin éventuel multiplie les lignes)
      // via une sous-requête DISTINCT par id, PUIS on agrège — sinon SUM(DISTINCT
      // o.total) fusionne à tort deux commandes de même montant (CA sous-estimé).
      `SELECT
        COUNT(*) AS "totalOrders",
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS "totalRevenue",
        COUNT(DISTINCT o."customerId") AS "totalCustomers",
        CASE WHEN COUNT(*) > 0
          THEN ROUND((SUM(o.total - o."totalRefunded") / COUNT(*))::numeric, 2)
          ELSE 0 END AS "avgOrderValue",
        COALESCE(SUM(GREATEST(o."itemCount" - o."refQty", 0)), 0) AS "totalItems"
      FROM (
        SELECT DISTINCT o.id, o.total, o."totalRefunded", o."customerId", o."itemCount",
          (SELECT COALESCE(SUM(rl.quantity), 0) FROM "BtocRefundLine" rl WHERE rl."orderWooId" = o."wooId") AS "refQty"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere}
      ) o`,
      ...orderParams
    );

    const overview = {
      totalOrders: Number(overviewRows[0]?.totalOrders ?? 0),
      totalRevenue: Number(overviewRows[0]?.totalRevenue ?? 0),
      totalCustomers: Number(overviewRows[0]?.totalCustomers ?? 0),
      avgOrderValue: Number(overviewRows[0]?.avgOrderValue ?? 0),
      totalItems: Number(overviewRows[0]?.totalItems ?? 0),
    };

    // ─── Revenue by month (last 12 months) ───────────────────
    const revenueByMonth = await prisma.$queryRawUnsafe<
      { month: string; revenue: number; orders: bigint }[]
    >(
      `SELECT
        TO_CHAR(o."orderDate", 'YYYY-MM') AS month,
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders
      FROM "BtocOrder" o
      ${lineJoin}
      ${revenueWhere} AND o."orderDate" >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(o."orderDate", 'YYYY-MM')
      ORDER BY month ASC`,
      ...orderParams
    );

    // ─── Top products by revenue ─────────────────────────────
    // Build conditions for the order-lines query
    const topProductConditions: string[] = [];
    const topProductParams: unknown[] = [];
    let tpIdx = 1;

    if (dateFrom) {
      topProductConditions.push(`o."orderDate" >= $${tpIdx}`);
      topProductParams.push(new Date(dateFrom));
      tpIdx++;
    }
    if (dateTo) {
      topProductConditions.push(`o."orderDate" <= $${tpIdx}`);
      topProductParams.push(new Date(dateTo));
      tpIdx++;
    }
    if (customerId) {
      topProductConditions.push(`o."customerId" = $${tpIdx}`);
      topProductParams.push(customerId);
      tpIdx++;
    }
    if (category) {
      topProductConditions.push(`p.category ILIKE '%' || $${tpIdx} || '%'`);
      topProductParams.push(category);
      tpIdx++;
    }
    if (parentProduct) {
      topProductConditions.push(`p.sku ILIKE $${tpIdx}`);
      topProductParams.push(`%${parentProduct}%`);
      tpIdx++;
    }

    topProductConditions.push(REVENUE_FILTER);
    const tpWhere =
      topProductConditions.length > 0
        ? "WHERE " + topProductConditions.join(" AND ")
        : "";

    // Branche remboursements (déduits) : mêmes filtres date/client + revenue,
    // sans catégorie/produit (les lignes de remboursement ne joignent pas
    // BtocProduct). Params séparés pour ne pas perturber les requêtes qui
    // réutilisent topProductParams (ex. sizeDistribution).
    const tpAllParams = [...topProductParams];
    const tpRefundConds: string[] = [REVENUE_FILTER];
    let tpr = topProductParams.length + 1;
    if (dateFrom) { tpRefundConds.push(`o."orderDate" >= $${tpr++}`); tpAllParams.push(new Date(dateFrom)); }
    if (dateTo) { tpRefundConds.push(`o."orderDate" <= $${tpr++}`); tpAllParams.push(new Date(dateTo)); }
    if (customerId) { tpRefundConds.push(`o."customerId" = $${tpr++}`); tpAllParams.push(customerId); }
    const tpRefundWhere = "WHERE " + tpRefundConds.join(" AND ");

    const topProducts = await prisma.$queryRawUnsafe<
      { name: string; sku: string | null; quantity: bigint; revenue: number }[]
    >(
      `SELECT name, sku, SUM(qty) AS quantity, SUM(revenue) AS revenue
      FROM (
        SELECT ol.name AS name, ol.sku AS sku, ol.quantity AS qty, ol.total AS revenue
        FROM "BtocOrderLine" ol
        JOIN "BtocOrder" o ON o.id = ol."orderId"
        LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
        ${tpWhere}
        UNION ALL
        SELECT rl.name, rl.sku, -rl.quantity, -rl.total
        FROM "BtocRefundLine" rl
        JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        ${tpRefundWhere}
      ) t
      GROUP BY name, sku
      ORDER BY revenue DESC
      LIMIT 15`,
      ...tpAllParams
    );

    // ─── Top catégories (catégories BtoB via matching réf) + Top pays ─────────
    // Regroupement par catégorie BtoB (Product.category, PAS la catégorie BtoC),
    // matching réf par préfixe SKU avec repli "corps" saison-agnostique.
    // Conditions date + client uniquement (les filtres BtoC ne s'appliquent pas).
    const geoConditions: string[] = [];
    const geoParams: unknown[] = [];
    let geoIdx = 1;
    if (dateFrom) {
      geoConditions.push(`o."orderDate" >= $${geoIdx++}`);
      geoParams.push(new Date(dateFrom));
    }
    if (dateTo) {
      geoConditions.push(`o."orderDate" <= $${geoIdx++}`);
      geoParams.push(new Date(dateTo));
    }
    if (customerId) {
      geoConditions.push(`o."customerId" = $${geoIdx++}`);
      geoParams.push(customerId);
    }
    geoConditions.push(REVENUE_FILTER);
    const geoWhere = geoConditions.length > 0 ? "WHERE " + geoConditions.join(" AND ") : "";

    const topCategories = await prisma.$queryRawUnsafe<
      { category: string; quantity: bigint; revenue: number }[]
    >(
      `SELECT COALESCE(cat, 'Non catégorisé') AS category,
              SUM(qty) AS quantity, SUM(revenue) AS revenue
       FROM (
         SELECT ol.quantity AS qty, ol.total AS revenue,
           COALESCE(
             (SELECT pr.category FROM "Product" pr WHERE pr.reference = SPLIT_PART(ol.sku, '-', 1) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1),
             (SELECT pr.category FROM "Product" pr WHERE SUBSTRING(pr.reference FROM 2) = SUBSTRING(SPLIT_PART(ol.sku, '-', 1) FROM 2) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1)
           ) AS cat
         FROM "BtocOrderLine" ol
         JOIN "BtocOrder" o ON o.id = ol."orderId"
         ${geoWhere}
         UNION ALL
         -- Remboursements (quantité + CA négatifs)
         SELECT -rl.quantity AS qty, -rl.total AS revenue,
           COALESCE(
             (SELECT pr.category FROM "Product" pr WHERE pr.reference = SPLIT_PART(rl.sku, '-', 1) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1),
             (SELECT pr.category FROM "Product" pr WHERE SUBSTRING(pr.reference FROM 2) = SUBSTRING(SPLIT_PART(rl.sku, '-', 1) FROM 2) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1)
           ) AS cat
         FROM "BtocRefundLine" rl
         JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
         ${geoWhere}
       ) t
       GROUP BY cat
       ORDER BY revenue DESC`,
      ...geoParams
    );

    // ─── Top pays (BtocOrder.billingCountry) ─────────────────
    const topCountries = await prisma.$queryRawUnsafe<
      { country: string; orders: bigint; revenue: number }[]
    >(
      `SELECT COALESCE(NULLIF(o."billingCountry", ''), 'Inconnu') AS country,
              COUNT(*) AS orders, SUM(o.total - o."totalRefunded") AS revenue
       FROM "BtocOrder" o
       ${geoWhere}
       GROUP BY COALESCE(NULLIF(o."billingCountry", ''), 'Inconnu')
       ORDER BY revenue DESC
       LIMIT 12`,
      ...geoParams
    );

    // ─── Orders by status ────────────────────────────────────
    const ordersByStatus = await prisma.$queryRawUnsafe<
      { status: string; count: bigint }[]
    >(
      `SELECT
        o.status,
        COUNT(DISTINCT o.id) AS count
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause}
      GROUP BY o.status
      ORDER BY count DESC`,
      ...orderParams
    );

    // ─── Top cities by billing city ──────────────────────────
    const topCities = await prisma.$queryRawUnsafe<
      { city: string; orders: bigint; revenue: number }[]
    >(
      `SELECT
        COALESCE(o.city, 'Inconnu') AS city,
        COUNT(*) AS orders,
        SUM(o.total - o."totalRefunded") AS revenue
      FROM (
        SELECT DISTINCT o.id, o."billingCity" AS city, o.total, o."totalRefunded"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere}
      ) o
      GROUP BY o.city
      ORDER BY revenue DESC
      LIMIT 20`,
      ...orderParams
    );

    // ─── Revenue by day (selected period) ────────────────────
    const revenueByDay = await prisma.$queryRawUnsafe<
      { date: string; revenue: number; orders: bigint }[]
    >(
      `SELECT
        TO_CHAR(o."orderDate", 'YYYY-MM-DD') AS date,
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders
      FROM "BtocOrder" o
      ${lineJoin}
      ${revenueWhere}
      GROUP BY TO_CHAR(o."orderDate", 'YYYY-MM-DD')
      ORDER BY date ASC`,
      ...orderParams
    );

    // ─── Size distribution ───────────────────────────────────
    const sizeDistribution = await prisma.$queryRawUnsafe<
      { size: string; quantity: bigint }[]
    >(
      `SELECT
        ol.size,
        SUM(ol.quantity) AS quantity
      FROM "BtocOrderLine" ol
      JOIN "BtocOrder" o ON o.id = ol."orderId"
      LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
      ${tpWhere.length > 0 ? tpWhere + " AND " : "WHERE "}
        ol.size IS NOT NULL AND ol.size != ''
      GROUP BY ol.size
      ORDER BY quantity DESC`,
      ...topProductParams
    );

    // ─── Available categories (for filter dropdown) ──────────
    // Categories can be comma-separated (multiple per product), so unnest them
    const categoryRows = await prisma.$queryRawUnsafe<
      { category: string }[]
    >(
      `SELECT DISTINCT TRIM(unnest(string_to_array(category, ','))) AS category
      FROM "BtocProduct"
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category ASC`
    );
    const availableCategories = categoryRows
      .map((r) => r.category)
      .filter((c) => c.length > 0);

    // ─── Available parent products (for filter dropdown) ─────
    const parentProductRows = await prisma.$queryRawUnsafe<
      { sku: string; name: string; wooId: number }[]
    >(
      `SELECT sku, name, "wooId"
      FROM "BtocProduct"
      WHERE type = 'variable' AND sku IS NOT NULL AND sku != ''
      ORDER BY sku ASC`
    );
    const availableParentProducts = parentProductRows.map((r) => ({
      sku: r.sku,
      name: r.name,
      wooId: Number(r.wooId),
    }));

    // ─── Serialize bigints ───────────────────────────────────
    return NextResponse.json({
      overview,
      revenueByMonth: revenueByMonth.map((r) => ({
        month: r.month,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      topProducts: topProducts.map((r) => ({
        name: r.name,
        sku: r.sku,
        quantity: Number(r.quantity),
        revenue: Number(r.revenue),
      })),
      topCategories: topCategories.map((r) => ({
        category: r.category,
        quantity: Number(r.quantity),
        revenue: Number(r.revenue),
      })),
      topCountries: topCountries.map((r) => ({
        country: r.country,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      ordersByStatus: ordersByStatus.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      topCities: topCities.map((r) => ({
        city: r.city,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      revenueByDay: revenueByDay.map((r) => ({
        date: r.date,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      sizeDistribution: sizeDistribution.map((r) => ({
        size: r.size,
        quantity: Number(r.quantity),
      })),
      availableCategories,
      availableParentProducts,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/stats");
  }
}
