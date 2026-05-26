import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Allow up to 60s for sync operations
export const maxDuration = 60;

function genId() {
  return `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive stock data from n8n (batched)
// Expects: [{ reference, color, externalId?, stocks: { "S": 10, "M": 20, ... } }]
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const entries = Array.isArray(body) ? body : body.stocks || [body];

    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    for (const entry of entries) {
      try {
        const { reference, color, externalId, stocks } = entry;

        if (!stocks || typeof stocks !== "object" || Object.keys(stocks).length === 0) {
          skipped++;
          continue;
        }

        // Find the product — try externalId first, then reference+color
        let productId: string | null = null;

        if (externalId) {
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "Product" WHERE "externalId" = $1 LIMIT 1`,
            String(externalId)
          );
          if (rows.length > 0) productId = rows[0].id;
        }

        if (!productId && reference && color) {
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "Product" WHERE reference = $1 AND color = $2 LIMIT 1`,
            String(reference),
            String(color)
          );
          if (rows.length > 0) productId = rows[0].id;
        }

        if (!productId) {
          errors.push(`Stock ${reference || externalId || "?"}: produit introuvable`);
          continue;
        }

        // Compute total
        const totalQuantity = Object.values(stocks as Record<string, number>).reduce(
          (sum: number, v) => sum + (Number(v) || 0),
          0
        );

        const quantitiesBySize = JSON.stringify(stocks);

        // Delete old stock entries for this product (replace strategy)
        await prisma.$executeRawUnsafe(
          `DELETE FROM "StockEntry" WHERE "productId" = $1`,
          productId
        );

        // Insert fresh stock entry
        await prisma.$executeRawUnsafe(
          `INSERT INTO "StockEntry" (id, "productId", "quantitiesBySize", "totalQuantity", "importDate", "createdAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          genId(),
          productId,
          quantitiesBySize,
          totalQuantity
        );

        imported++;
      } catch (e) {
        errors.push(`Stock ${entry.reference || "?"}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported, skipped, errors, total: entries.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync stock: ${String(e)}` },
      { status: 500 }
    );
  }
}
