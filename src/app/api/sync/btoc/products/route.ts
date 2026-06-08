import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

function genId() {
  return `btcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive WooCommerce products from n8n (batched)
// Expects: [{ id, sku, name, type, parent_id, status, price, regular_price, sale_price,
//             stock_quantity, stock_status, categories, images }]
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const products = Array.isArray(body) ? body : body.products || [body];

    const errors: string[] = [];
    let imported = 0;

    for (const p of products) {
      try {
        const wooId = Number(p.id);
        if (!wooId) {
          errors.push(`Produit ignoré: id manquant`);
          continue;
        }

        // Extract main category
        let category: string | null = null;
        if (Array.isArray(p.categories) && p.categories.length > 0) {
          category = p.categories[0].name || null;
        }

        // Extract first image
        let imageUrl: string | null = null;
        if (Array.isArray(p.images) && p.images.length > 0) {
          imageUrl = p.images[0].src || null;
        }

        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocProduct" (id, "wooId", sku, name, type, "parentId", status,
            price, "regularPrice", "salePrice", "stockQuantity", "stockStatus",
            category, "imageUrl", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
           ON CONFLICT ("wooId")
           DO UPDATE SET
             sku = COALESCE(NULLIF($3, ''), "BtocProduct".sku),
             name = $4,
             type = $5,
             "parentId" = $6,
             status = $7,
             price = $8,
             "regularPrice" = $9,
             "salePrice" = $10,
             "stockQuantity" = $11,
             "stockStatus" = $12,
             category = COALESCE($13, "BtocProduct".category),
             "imageUrl" = COALESCE($14, "BtocProduct"."imageUrl"),
             "updatedAt" = NOW()`,
          genId(),
          wooId,
          p.sku || null,
          String(p.name || ""),
          p.type || "simple",
          p.parent_id ? Number(p.parent_id) : null,
          p.status || "publish",
          p.price ? parseFloat(p.price) : null,
          p.regular_price ? parseFloat(p.regular_price) : null,
          p.sale_price ? parseFloat(p.sale_price) : null,
          p.stock_quantity !== undefined && p.stock_quantity !== null ? Number(p.stock_quantity) : null,
          p.stock_status || null,
          category,
          imageUrl
        );
        imported++;
      } catch (e) {
        errors.push(`Produit WC#${p.id}: ${String(e)}`);
      }
    }

    await prisma.btocSyncLog.create({
      data: {
        syncType: "PRODUCTS",
        itemCount: imported,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: { imported, errors: errors.slice(0, 20), total: products.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync BtoC products: ${String(e)}` },
      { status: 500 }
    );
  }
}
