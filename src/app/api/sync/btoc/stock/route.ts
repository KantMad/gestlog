import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// POST — Receive WooCommerce stock updates from n8n (batched)
// Expects: [{ id, stock_quantity, stock_status }]
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const items = Array.isArray(body) ? body : body.stock || [body];

    const errors: string[] = [];
    let updated = 0;

    for (const item of items) {
      try {
        const wooId = Number(item.id);
        if (!wooId) continue;

        const result = await prisma.$executeRawUnsafe(
          `UPDATE "BtocProduct"
           SET "stockQuantity" = $2,
               "stockStatus" = $3,
               "updatedAt" = NOW()
           WHERE "wooId" = $1`,
          wooId,
          item.stock_quantity !== undefined && item.stock_quantity !== null
            ? Number(item.stock_quantity)
            : null,
          item.stock_status || null
        );

        if (result > 0) updated++;
      } catch (e) {
        errors.push(`Stock WC#${item.id}: ${String(e)}`);
      }
    }

    await prisma.btocSyncLog.create({
      data: {
        syncType: "STOCK",
        itemCount: updated,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: { updated, errors: errors.slice(0, 20), total: items.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync BtoC stock: ${String(e)}` },
      { status: 500 }
    );
  }
}
