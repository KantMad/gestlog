import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

function genId() {
  return `btcc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive WooCommerce customers from n8n (batched)
// Expects: [{ id, email, first_name, last_name, company, phone, billing, shipping, total_spent, orders_count }]
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const customers = Array.isArray(body) ? body : body.customers || [body];

    const errors: string[] = [];
    let imported = 0;

    for (const c of customers) {
      try {
        const wooId = Number(c.id);
        if (!wooId || !c.email) {
          errors.push(`Client ignoré: id ou email manquant`);
          continue;
        }

        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocCustomer" (id, "wooId", email, "firstName", "lastName", company, phone,
            "billingCity", "billingCountry", "shippingCity", "shippingCountry",
            "totalSpent", "ordersCount", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
           ON CONFLICT ("wooId")
           DO UPDATE SET
             email = $3,
             "firstName" = $4,
             "lastName" = $5,
             company = COALESCE(NULLIF($6, ''), "BtocCustomer".company),
             phone = COALESCE(NULLIF($7, ''), "BtocCustomer".phone),
             "billingCity" = COALESCE($8, "BtocCustomer"."billingCity"),
             "billingCountry" = COALESCE($9, "BtocCustomer"."billingCountry"),
             "shippingCity" = COALESCE($10, "BtocCustomer"."shippingCity"),
             "shippingCountry" = COALESCE($11, "BtocCustomer"."shippingCountry"),
             "totalSpent" = $12,
             "ordersCount" = $13,
             "updatedAt" = NOW()`,
          genId(),
          wooId,
          String(c.email),
          String(c.first_name || ""),
          String(c.last_name || ""),
          c.company || null,
          c.phone || c.billing?.phone || null,
          c.billing?.city || null,
          c.billing?.country || null,
          c.shipping?.city || null,
          c.shipping?.country || null,
          parseFloat(c.total_spent) || 0,
          Number(c.orders_count) || 0
        );
        imported++;
      } catch (e) {
        errors.push(`Client WC#${c.id}: ${String(e)}`);
      }
    }

    // Log sync
    await prisma.btocSyncLog.create({
      data: {
        syncType: "CUSTOMERS",
        itemCount: imported,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: { imported, errors: errors.slice(0, 20), total: customers.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync BtoC customers: ${String(e)}` },
      { status: 500 }
    );
  }
}
