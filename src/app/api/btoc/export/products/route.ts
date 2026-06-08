import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = params.get("search");
    const category = params.get("category");
    const type = params.get("type"); // simple, variable, variation
    const stockStatus = params.get("stockStatus");

    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`);
      queryParams.push(`%${search}%`);
      idx++;
    }
    if (category) {
      conditions.push(`p.category = $${idx}`);
      queryParams.push(category);
      idx++;
    }
    if (type) {
      conditions.push(`p.type = $${idx}`);
      queryParams.push(type);
      idx++;
    }
    if (stockStatus) {
      conditions.push(`p."stockStatus" = $${idx}`);
      queryParams.push(stockStatus);
      idx++;
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const products = await prisma.$queryRawUnsafe<
      {
        id: string;
        wooId: number;
        sku: string | null;
        name: string;
        type: string;
        parentId: number | null;
        status: string;
        price: number | null;
        regularPrice: number | null;
        salePrice: number | null;
        stockQuantity: number | null;
        stockStatus: string | null;
        category: string | null;
        imageUrl: string | null;
      }[]
    >(
      `SELECT id, "wooId", sku, name, type, "parentId", status,
              price, "regularPrice", "salePrice", "stockQuantity", "stockStatus",
              category, "imageUrl"
       FROM "BtocProduct" p
       ${where}
       ORDER BY name ASC`,
      ...queryParams
    );

    // Available filters
    const categories = await prisma.$queryRawUnsafe<{ category: string }[]>(
      `SELECT DISTINCT category FROM "BtocProduct" WHERE category IS NOT NULL AND category != '' ORDER BY category`
    );

    return NextResponse.json({
      products: products.map((p) => ({
        ...p,
        wooId: Number(p.wooId),
        price: p.price ? Number(p.price) : null,
        regularPrice: p.regularPrice ? Number(p.regularPrice) : null,
        salePrice: p.salePrice ? Number(p.salePrice) : null,
        stockQuantity: p.stockQuantity !== null ? Number(p.stockQuantity) : null,
      })),
      total: products.length,
      availableCategories: categories.map((c) => c.category),
    });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
