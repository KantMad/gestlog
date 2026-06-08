import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = params.get("search");
    const productName = params.get("productName");
    const size = params.get("size");
    const minOrders = params.get("minOrders");
    const minSpent = params.get("minSpent");
    const city = params.get("city");
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(params.get("limit") || "50", 10)));
    const offset = (page - 1) * limit;

    // ─── Build WHERE clauses ─────────────────────────────────
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(
        `(c."firstName" ILIKE $${paramIndex}
          OR c."lastName" ILIKE $${paramIndex}
          OR c.email ILIKE $${paramIndex}
          OR c.company ILIKE $${paramIndex}
          OR c."billingCity" ILIKE $${paramIndex})`
      );
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (minOrders) {
      conditions.push(`c."ordersCount" >= $${paramIndex}`);
      queryParams.push(parseInt(minOrders, 10));
      paramIndex++;
    }

    if (minSpent) {
      conditions.push(`c."totalSpent" >= $${paramIndex}`);
      queryParams.push(parseFloat(minSpent));
      paramIndex++;
    }

    if (city) {
      conditions.push(`c."billingCity" ILIKE $${paramIndex}`);
      queryParams.push(`%${city}%`);
      paramIndex++;
    }

    // Product name and size require a subquery against order lines
    if (productName) {
      conditions.push(
        `c.id IN (
          SELECT DISTINCT o."customerId"
          FROM "BtocOrder" o
          JOIN "BtocOrderLine" ol ON ol."orderId" = o.id
          WHERE ol.name ILIKE $${paramIndex} AND o."customerId" IS NOT NULL
        )`
      );
      queryParams.push(`%${productName}%`);
      paramIndex++;
    }

    if (size) {
      conditions.push(
        `c.id IN (
          SELECT DISTINCT o."customerId"
          FROM "BtocOrder" o
          JOIN "BtocOrderLine" ol ON ol."orderId" = o.id
          WHERE ol.size = $${paramIndex} AND o."customerId" IS NOT NULL
        )`
      );
      queryParams.push(size);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // ─── Count total matching customers ──────────────────────
    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) AS total FROM "BtocCustomer" c ${whereClause}`,
      ...queryParams
    );
    const total = Number(countRows[0]?.total ?? 0);

    // ─── Fetch customers with last order date ────────────────
    const customerRows = await prisma.$queryRawUnsafe<
      {
        id: string;
        wooId: number;
        email: string;
        firstName: string;
        lastName: string;
        company: string | null;
        phone: string | null;
        billingCity: string | null;
        billingCountry: string | null;
        totalSpent: number;
        ordersCount: number;
        lastOrderDate: Date | null;
      }[]
    >(
      `SELECT
        c.id,
        c."wooId",
        c.email,
        c."firstName",
        c."lastName",
        c.company,
        c.phone,
        c."billingCity",
        c."billingCountry",
        c."totalSpent",
        c."ordersCount",
        (SELECT MAX(o."orderDate") FROM "BtocOrder" o WHERE o."customerId" = c.id) AS "lastOrderDate"
      FROM "BtocCustomer" c
      ${whereClause}
      ORDER BY c."totalSpent" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      ...queryParams,
      limit,
      offset
    );

    // ─── Fetch ordered products for each customer ────────────
    const customerIds = customerRows.map((c) => c.id);
    let orderedProductsMap: Map<string, string[]> = new Map();

    if (customerIds.length > 0) {
      // Build a placeholders list for the IN clause
      const placeholders = customerIds.map((_, i) => `$${i + 1}`).join(", ");
      const productRows = await prisma.$queryRawUnsafe<
        { customerId: string; productNames: string }[]
      >(
        `SELECT
          o."customerId",
          STRING_AGG(DISTINCT ol.name, ', ' ORDER BY ol.name) AS "productNames"
        FROM "BtocOrder" o
        JOIN "BtocOrderLine" ol ON ol."orderId" = o.id
        WHERE o."customerId" IN (${placeholders})
        GROUP BY o."customerId"`,
        ...customerIds
      );
      for (const row of productRows) {
        orderedProductsMap.set(
          row.customerId,
          row.productNames ? row.productNames.split(", ") : []
        );
      }
    }

    const customers = customerRows.map((c) => ({
      id: c.id,
      wooId: Number(c.wooId),
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      phone: c.phone,
      billingCity: c.billingCity,
      billingCountry: c.billingCountry,
      totalSpent: Number(c.totalSpent),
      ordersCount: Number(c.ordersCount),
      lastOrderDate: c.lastOrderDate,
      orderedProducts: orderedProductsMap.get(c.id) || [],
    }));

    // ─── Available sizes (for filter dropdown) ───────────────
    const sizeRows = await prisma.$queryRawUnsafe<{ size: string }[]>(
      `SELECT DISTINCT size
      FROM "BtocOrderLine"
      WHERE size IS NOT NULL AND size != ''
      ORDER BY size ASC`
    );
    const availableSizes = sizeRows.map((r) => r.size);

    // ─── Available cities (for filter dropdown) ──────────────
    const cityRows = await prisma.$queryRawUnsafe<{ city: string }[]>(
      `SELECT DISTINCT "billingCity" AS city
      FROM "BtocCustomer"
      WHERE "billingCity" IS NOT NULL AND "billingCity" != ''
      ORDER BY "billingCity" ASC`
    );
    const availableCities = cityRows.map((r) => r.city);

    return NextResponse.json({
      customers,
      total,
      page,
      limit,
      availableSizes,
      availableCities,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
