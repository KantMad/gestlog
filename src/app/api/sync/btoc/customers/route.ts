import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isBrevoConfigured,
  markCustomerAsVip,
  type VipCustomer,
} from "@/lib/brevo";

export const maxDuration = 60;

// Seuil (en €) à partir duquel un client devient VIP. Configurable via .env.
const VIP_THRESHOLD = Number(process.env.BREVO_VIP_THRESHOLD) || 500;

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

    // Lit le totalSpent ACTUEL (avant upsert) pour détecter qui franchit le
    // seuil VIP pendant cette sync — un seul SELECT pour tout le batch.
    const wooIds = customers
      .map((c: { id: unknown }) => Number(c.id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    const previousSpentByWooId = new Map<number, number>();
    if (wooIds.length > 0) {
      const existing = await prisma.btocCustomer.findMany({
        where: { wooId: { in: wooIds } },
        select: { wooId: true, totalSpent: true },
      });
      for (const e of existing) {
        previousSpentByWooId.set(e.wooId, e.totalSpent);
      }
    }
    const newVips: VipCustomer[] = [];

    for (const c of customers) {
      try {
        const wooId = Number(c.id);
        if (!wooId || !c.email) {
          errors.push(`Client ignoré: id ou email manquant`);
          continue;
        }

        const newSpent = parseFloat(c.total_spent) || 0;

        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocCustomer" (id, "wooId", email, "firstName", "lastName", company, phone,
            "billingPostcode", "billingCity", "billingCountry", "shippingCity", "shippingCountry",
            "totalSpent", "ordersCount", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
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
             "totalSpent" = $13,
             "ordersCount" = $14,
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
          c.shipping?.country || null,
          newSpent,
          Number(c.orders_count) || 0
        );
        imported++;

        // Franchissement du seuil VIP : était en dessous (ou nouveau), passe au-dessus.
        const previousSpent = previousSpentByWooId.get(wooId) ?? 0;
        if (previousSpent < VIP_THRESHOLD && newSpent >= VIP_THRESHOLD) {
          newVips.push({
            email: String(c.email),
            firstName: String(c.first_name || ""),
            lastName: String(c.last_name || ""),
            totalSpent: newSpent,
            ordersCount: Number(c.orders_count) || 0,
          });
        }
      } catch (e) {
        errors.push(`Client WC#${c.id}: ${String(e)}`);
      }
    }

    // Notifie Brevo pour les nouveaux VIP (déclenche le scénario "client_vip").
    // Best-effort : un échec Brevo n'invalide jamais la sync.
    let vipNotified = 0;
    if (newVips.length > 0 && isBrevoConfigured()) {
      for (const vip of newVips) {
        try {
          await markCustomerAsVip(vip);
          vipNotified++;
        } catch (e) {
          errors.push(`Brevo VIP ${vip.email}: ${String(e)}`);
        }
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
        vipNotified,
        errors: errors.slice(0, 20),
        total: customers.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync BtoC customers: ${String(e)}` },
      { status: 500 }
    );
  }
}
