import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Returns order lines grouped by parent product reference + color,
// with quantities broken down by size (for pivot/column display)
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const productName = params.get("productName");
    const color = params.get("color");
    const size = params.get("size");
    const customerName = params.get("customerName");

    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`o."orderDate" >= $${idx}`);
      queryParams.push(new Date(dateFrom));
      idx++;
    }
    if (dateTo) {
      conditions.push(`o."orderDate" <= $${idx}`);
      queryParams.push(new Date(dateTo));
      idx++;
    }
    if (productName) {
      conditions.push(`(COALESCE(parent.name, p.name, ol.name) ILIKE $${idx})`);
      queryParams.push(`%${productName}%`);
      idx++;
    }
    if (color) {
      conditions.push(`ol.color = $${idx}`);
      queryParams.push(color);
      idx++;
    }
    if (size) {
      conditions.push(`ol.size = $${idx}`);
      queryParams.push(size);
      idx++;
    }
    if (customerName) {
      conditions.push(`o."customerName" ILIKE $${idx}`);
      queryParams.push(`%${customerName}%`);
      idx++;
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // Get all unique sizes for column headers
    const sizeRows = await prisma.$queryRawUnsafe<{ size: string }[]>(
      `SELECT DISTINCT ol.size
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       LEFT JOIN "BtocProduct" p ON p.id = ol."productId"
       LEFT JOIN "BtocProduct" parent ON parent."wooId" = p."parentId" AND parent.type = 'variable'
       ${where}
       AND ol.size IS NOT NULL AND ol.size != ''
       ORDER BY ol.size`,
      ...queryParams
    );
    const sizes = sizeRows.map((r) => r.size);

    // Get order lines grouped by parent reference + color + size
    const rows = await prisma.$queryRawUnsafe<
      {
        reference: string;
        sku: string | null;
        color: string | null;
        category: string | null;
        size: string | null;
        quantity: bigint;
        revenue: number;
        orderCount: bigint;
      }[]
    >(
      `SELECT
        COALESCE(parent.name, p.name, ol.name) AS reference,
        COALESCE(p.sku, ol.sku) AS sku,
        ol.color,
        COALESCE(parent.category, p.category) AS category,
        ol.size,
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue,
        COUNT(DISTINCT o.id) AS "orderCount"
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       LEFT JOIN "BtocProduct" p ON p.id = ol."productId"
       LEFT JOIN "BtocProduct" parent ON parent."wooId" = p."parentId" AND parent.type = 'variable'
       ${where}
       GROUP BY COALESCE(parent.name, p.name, ol.name), COALESCE(p.sku, ol.sku), ol.color, COALESCE(parent.category, p.category), ol.size
       ORDER BY reference, ol.color, ol.size`,
      ...queryParams
    );

    // Pivot: group rows by reference+color, sizes become columns
    const pivotMap = new Map<
      string,
      {
        reference: string;
        sku: string | null;
        color: string | null;
        category: string | null;
        sizeQuantities: Record<string, number>;
        totalQuantity: number;
        totalRevenue: number;
        orderCount: number;
      }
    >();

    for (const row of rows) {
      const key = `${row.reference}|||${row.color || ""}`;
      if (!pivotMap.has(key)) {
        pivotMap.set(key, {
          reference: row.reference,
          sku: row.sku,
          color: row.color,
          category: row.category,
          sizeQuantities: {},
          totalQuantity: 0,
          totalRevenue: 0,
          orderCount: 0,
        });
      }
      const entry = pivotMap.get(key)!;
      if (row.size) {
        entry.sizeQuantities[row.size] =
          (entry.sizeQuantities[row.size] || 0) + Number(row.quantity);
      }
      entry.totalQuantity += Number(row.quantity);
      entry.totalRevenue += Number(row.revenue);
      entry.orderCount = Math.max(entry.orderCount, Number(row.orderCount));
    }

    const pivotedRows = Array.from(pivotMap.values());

    // Available filter values
    const availableColors = await prisma.$queryRawUnsafe<{ color: string }[]>(
      `SELECT DISTINCT color FROM "BtocOrderLine" WHERE color IS NOT NULL AND color != '' ORDER BY color`
    );
    const availableSizes = await prisma.$queryRawUnsafe<{ size: string }[]>(
      `SELECT DISTINCT size FROM "BtocOrderLine" WHERE size IS NOT NULL AND size != '' ORDER BY size`
    );

    return NextResponse.json({
      rows: pivotedRows,
      sizes,
      total: pivotedRows.length,
      availableColors: availableColors.map((c) => c.color),
      availableSizes: availableSizes.map((s) => s.size),
    });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
