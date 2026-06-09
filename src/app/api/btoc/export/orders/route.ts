import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Canonical alpha size ordering (uppercased)
const ALPHA_SIZE_ORDER = [
  "XXS", "XS", "S", "S/M", "S-M", "M", "M/L", "L", "L/XL", "L-XL",
  "XL", "XL/2XL", "2XL", "2XL-3XL", "3XL", "3XL/4XL", "4XL", "5XL", "6XL", "TU",
];

/** Order sizes: numeric → numerical sort, alpha → canonical order */
function orderSizes(sizes: string[]): string[] {
  const upper = sizes.map((s) => s.toUpperCase());
  const allNumeric = upper.every((s) => /^\d+$/.test(s));

  if (allNumeric) {
    return [...new Set(upper)].sort((a, b) => parseInt(a) - parseInt(b));
  }

  // Paired numeric like 39-42, 43-46
  const allPairedNumeric = upper.every((s) => /^\d+-\d+$/.test(s));
  if (allPairedNumeric) {
    return [...new Set(upper)].sort(
      (a, b) => parseInt(a.split("-")[0]) - parseInt(b.split("-")[0])
    );
  }

  return [...new Set(upper)].sort((a, b) => {
    const idxA = ALPHA_SIZE_ORDER.indexOf(a);
    const idxB = ALPHA_SIZE_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

// Returns order lines grouped by parent product reference + color,
// with ALL sizes from BtoB sizeScale as columns (quantities for missing sizes = 0)
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
      conditions.push(
        `(COALESCE(parent.name, p.name, ol.name) ILIKE $${idx})`
      );
      queryParams.push(`%${productName}%`);
      idx++;
    }
    if (color) {
      conditions.push(`ol.color = $${idx}`);
      queryParams.push(color);
      idx++;
    }
    if (size) {
      conditions.push(`UPPER(ol.size) = UPPER($${idx})`);
      queryParams.push(size);
      idx++;
    }
    if (customerName) {
      conditions.push(`o."customerName" ILIKE $${idx}`);
      queryParams.push(`%${customerName}%`);
      idx++;
    }

    const where =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // ─── Step 1: Build a BtoB reference → best sizeScale map ──
    // For each reference, pick the sizeScale with the most sizes
    const btobScales = await prisma.$queryRawUnsafe<
      { reference: string; sizeScale: string }[]
    >(
      `SELECT DISTINCT ON (reference) reference, "sizeScale"
       FROM "Product"
       WHERE "sizeScale" IS NOT NULL AND "sizeScale" != ''
       ORDER BY reference, LENGTH("sizeScale") DESC`
    );

    const sizeScaleMap = new Map<string, string[]>();
    for (const row of btobScales) {
      const sizes = row.sizeScale
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (sizes.length > 0) {
        sizeScaleMap.set(row.reference, orderSizes(sizes));
      }
    }

    // ─── Step 2: Get BtoC order lines with parent info ────────
    const rows = await prisma.$queryRawUnsafe<
      {
        reference: string;
        parentSku: string | null;
        lineSku: string | null;
        color: string | null;
        category: string | null;
        size: string | null;
        quantity: bigint;
        revenue: number;
        orderCount: bigint;
      }[]
    >(
      `SELECT
        COALESCE(p.name, ol.name) AS reference,
        COALESCE(p.sku, SPLIT_PART(ol.sku, '-', 1)) AS "parentSku",
        ol.sku AS "lineSku",
        ol.color,
        p.category,
        ol.size,
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue,
        COUNT(DISTINCT o.id) AS "orderCount"
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
       ${where}
       GROUP BY
         COALESCE(p.name, ol.name),
         COALESCE(p.sku, SPLIT_PART(ol.sku, '-', 1)),
         ol.sku,
         ol.color,
         p.category,
         ol.size
       ORDER BY reference, ol.color, ol.size`,
      ...queryParams
    );

    // ─── Step 3: Pivot by reference+color, fill ALL sizes ─────
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
        orderedSizes: string[]; // full size scale for this product
      }
    >();

    for (const row of rows) {
      const key = `${row.reference}|||${row.color || ""}`;

      if (!pivotMap.has(key)) {
        // Determine the full size scale for this product
        const btobRef = row.parentSku || row.lineSku || "";
        const btobSizes = sizeScaleMap.get(btobRef);

        pivotMap.set(key, {
          reference: row.reference,
          sku: row.parentSku || row.lineSku,
          color: row.color,
          category: row.category,
          sizeQuantities: {},
          totalQuantity: 0,
          totalRevenue: 0,
          orderedSizes: btobSizes || [], // will be enriched below
        });
      }

      const entry = pivotMap.get(key)!;
      if (row.size) {
        const upperSize = row.size.toUpperCase();
        entry.sizeQuantities[upperSize] =
          (entry.sizeQuantities[upperSize] || 0) + Number(row.quantity);

        // If this size isn't in the BtoB scale, add it
        if (!entry.orderedSizes.includes(upperSize)) {
          entry.orderedSizes.push(upperSize);
        }
      }
      entry.totalQuantity += Number(row.quantity);
      entry.totalRevenue += Number(row.revenue);
    }

    // ─── Step 4: Re-order sizes and fill missing with 0 ────────
    const pivotedRows = Array.from(pivotMap.values()).map((entry) => {
      // Re-order sizes properly
      entry.orderedSizes = orderSizes(entry.orderedSizes);

      // Fill missing sizes with 0
      for (const s of entry.orderedSizes) {
        if (!(s in entry.sizeQuantities)) {
          entry.sizeQuantities[s] = 0;
        }
      }

      return entry;
    });

    // Collect ALL unique sizes across all rows, ordered
    const allSizesSet = new Set<string>();
    for (const row of pivotedRows) {
      for (const s of row.orderedSizes) {
        allSizesSet.add(s);
      }
    }
    const allSizes = orderSizes(Array.from(allSizesSet));

    // Available filter values
    const availableColors = await prisma.$queryRawUnsafe<
      { color: string }[]
    >(
      `SELECT DISTINCT color FROM "BtocOrderLine" WHERE color IS NOT NULL AND color != '' ORDER BY color`
    );
    const availableSizes = await prisma.$queryRawUnsafe<
      { size: string }[]
    >(
      `SELECT DISTINCT UPPER(size) AS size FROM "BtocOrderLine" WHERE size IS NOT NULL AND size != '' ORDER BY size`
    );

    return NextResponse.json({
      rows: pivotedRows.map((r) => ({
        reference: r.reference,
        sku: r.sku,
        color: r.color,
        category: r.category,
        sizeQuantities: r.sizeQuantities,
        orderedSizes: r.orderedSizes,
        totalQuantity: r.totalQuantity,
        totalRevenue: Math.round(r.totalRevenue * 100) / 100,
      })),
      allSizes,
      total: pivotedRows.length,
      availableColors: availableColors.map((c) => c.color),
      availableSizes: orderSizes(availableSizes.map((s) => s.size)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
