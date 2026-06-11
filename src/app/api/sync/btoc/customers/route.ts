import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// NOTE VIP : l'API WooCommerce REST "Get Customers" renvoie total_spent=0 et
// orders_count=0 (Woo ne calcule pas ces agrégats à la volée). On NE met donc
// PAS à jour totalSpent/ordersCount ici — ce serait écraser les vrais montants
// par des 0. La détection VIP et le recalcul des agrégats vivent dans
// /api/sync/btoc/vip-recompute, qui agrège depuis BtocOrder.

function genId() {
  return `btcc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive WooCommerce customers from n8n (batched)
// Expects: [{ id, email, first_name, last_name, company, phone, billing, shipping }]
// (total_spent / orders_count de Woo sont ignorés : ils valent toujours 0)
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

        // totalSpent / ordersCount : 0 à l'insertion d'un nouveau client, et
        // JAMAIS touchés lors d'un UPDATE — ils sont la propriété de
        // /api/sync/btoc/vip-recompute (cf. note en tête de fichier).
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocCustomer" (id, "wooId", email, "firstName", "lastName", company, phone,
            "billingPostcode", "billingCity", "billingCountry", "shippingCity", "shippingCountry",
            "totalSpent", "ordersCount", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, NOW(), NOW())
           ON CONFLICT ("wooId")
           DO UPDATE SET
             email = $3,
             "firstName" = $4,
             "lastName" = $5,
             company = COALESCE(NULLIF($6, ''), "BtocCustomer".company),
             phone = COALESCE(NULLIF($7, ''), "BtocCustomer".phone),
             "billingPostcode" = COALESCE(NULLIF($8, ''), "BtocCustomer"."billingPostcode"),
             "billingCity" = COALESCE($9, "BtocCustomer"."billingCity"),
             "billingCountry" = COALESCE($10, "BtocCustomer"."billingCountry"),
             "shippingCity" = COALESCE($11, "BtocCustomer"."shippingCity"),
             "shippingCountry" = COALESCE($12, "BtocCustomer"."shippingCountry"),
             "updatedAt" = NOW()`,
          genId(),
          wooId,
          String(c.email),
          String(c.first_name || ""),
          String(c.last_name || ""),
          c.company || null,
          c.phone || c.billing?.phone || null,
          c.billing?.postcode || null,
          c.billing?.city || null,
          c.billing?.country || null,
          c.shipping?.city || null,
          c.shipping?.country || null
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
      data: {
        imported,
        errors: errors.slice(0, 20),
        total: customers.length,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/customers");
  }
}
