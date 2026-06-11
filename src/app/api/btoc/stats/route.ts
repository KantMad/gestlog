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
      `SELECT
        COUNT(DISTINCT o.id) AS "totalOrders",
        COALESCE(SUM(DISTINCT o.total), 0) AS "totalRevenue",
        COUNT(DISTINCT o."customerId") AS "totalCustomers",
        CASE WHEN COUNT(DISTINCT o.id) > 0
          THEN ROUND((SUM(DISTINCT o.total) / COUNT(DISTINCT o.id))::numeric, 2)
          ELSE 0 END AS "avgOrderValue",
        COALESCE(SUM(DISTINCT o."itemCount"), 0) AS "totalItems"
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause}`,
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
        COALESCE(SUM(o.total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause.length > 0 ? whereClause + " AND " : "WHERE "}
        o."orderDate" >= NOW() - INTERVAL '12 months'
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

    const tpWhere =
      topProductConditions.length > 0
        ? "WHERE " + topProductConditions.join(" AND ")
        : "";

    const topProducts = await prisma.$queryRawUnsafe<
      { name: string; sku: string | null; quantity: bigint; revenue: number }[]
    >(
      `SELECT
        ol.name,
        ol.sku,
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue
      FROM "BtocOrderLine" ol
      JOIN "BtocOrder" o ON o.id = ol."orderId"
      LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
      ${tpWhere}
      GROUP BY ol.name, ol.sku
      ORDER BY revenue DESC
      LIMIT 15`,
      ...topProductParams
    );

    // ─── Top categories ──────────────────────────────────────
    const topCategories = await prisma.$queryRawUnsafe<
      { category: string; quantity: bigint; revenue: number }[]
    >(
      `SELECT
        COALESCE(p.category, 'Non catégorisé') AS category,
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue
      FROM "BtocOrderLine" ol
      JOIN "BtocOrder" o ON o.id = ol."orderId"
      LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
      ${tpWhere}
      GROUP BY p.category
      ORDER BY revenue DESC`,
      ...topProductParams
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
        COALESCE(o."billingCity", 'Inconnu') AS city,
        COUNT(DISTINCT o.id) AS orders,
        SUM(DISTINCT o.total) AS revenue
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause}
      GROUP BY o."billingCity"
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
        COALESCE(SUM(o.total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS orders
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause}
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
