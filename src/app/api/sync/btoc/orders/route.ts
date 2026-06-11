import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

function genId() {
  return `btco_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive WooCommerce orders from n8n (batched)
// Expects: [{ id, number, status, customer_id, billing, shipping, total, subtotal, total_tax,
//             shipping_total, discount_total, payment_method, payment_method_title,
//             currency, line_items, coupon_lines, customer_note, date_created, date_completed }]
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const orders = Array.isArray(body) ? body : body.orders || [body];

    const errors: string[] = [];
    let imported = 0;

    for (const o of orders) {
      try {
        const wooId = Number(o.id);
        if (!wooId) {
          errors.push(`Commande ignorée: id manquant`);
          continue;
        }

        // Resolve customer by wooId
        let customerId: string | null = null;
        if (o.customer_id && Number(o.customer_id) > 0) {
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "BtocCustomer" WHERE "wooId" = $1 LIMIT 1`,
            Number(o.customer_id)
          );
          if (rows.length > 0) customerId = rows[0].id;
        }

        const customerName = [o.billing?.first_name, o.billing?.last_name]
          .filter(Boolean)
          .join(" ") || null;

        const itemCount = Array.isArray(o.line_items)
          ? o.line_items.reduce((s: number, li: { quantity?: number }) => s + (Number(li.quantity) || 0), 0)
          : 0;

        const couponCodes = Array.isArray(o.coupon_lines) && o.coupon_lines.length > 0
          ? JSON.stringify(o.coupon_lines.map((c: { code?: string }) => c.code))
          : null;

        // Upsert order
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocOrder" (id, "wooId", "orderNumber", status, "customerId",
            "customerEmail", "customerName", "billingCity", "shippingCity",
            total, subtotal, "totalTax", "shippingTotal", "discountTotal",
            "paymentMethod", "paymentTitle", currency, "itemCount",
            "couponCodes", "customerNote", "orderDate", "completedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
           ON CONFLICT ("wooId")
           DO UPDATE SET
             status = $4,
             "customerId" = COALESCE($5, "BtocOrder"."customerId"),
             "customerEmail" = COALESCE($6, "BtocOrder"."customerEmail"),
             "customerName" = COALESCE($7, "BtocOrder"."customerName"),
             total = $10,
             subtotal = $11,
             "totalTax" = $12,
             "shippingTotal" = $13,
             "discountTotal" = $14,
             "paymentMethod" = COALESCE($15, "BtocOrder"."paymentMethod"),
             "paymentTitle" = COALESCE($16, "BtocOrder"."paymentTitle"),
             "itemCount" = $18,
             "couponCodes" = COALESCE($19, "BtocOrder"."couponCodes"),
             "completedAt" = $22,
             "updatedAt" = NOW()`,
          genId(),
          wooId,
          String(o.number || o.id),
          String(o.status || "pending"),
          customerId,
          o.billing?.email || null,
          customerName,
          o.billing?.city || null,
          o.shipping?.city || null,
          parseFloat(o.total) || 0,
          o.subtotal ? parseFloat(o.subtotal) : null,
          o.total_tax ? parseFloat(o.total_tax) : null,
          o.shipping_total ? parseFloat(o.shipping_total) : null,
          o.discount_total ? parseFloat(o.discount_total) : null,
          o.payment_method || null,
          o.payment_method_title || null,
          o.currency || "EUR",
          itemCount,
          couponCodes,
          o.customer_note || null,
          o.date_created ? new Date(o.date_created) : new Date(),
          o.date_completed ? new Date(o.date_completed) : null
        );

        // Upsert order lines
        if (Array.isArray(o.line_items)) {
          // Get the order's internal ID
          const orderRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "BtocOrder" WHERE "wooId" = $1 LIMIT 1`,
            wooId
          );
          if (orderRows.length > 0) {
            const orderId = orderRows[0].id;

            // Delete existing lines and re-insert (replace strategy)
            await prisma.$executeRawUnsafe(
              `DELETE FROM "BtocOrderLine" WHERE "orderId" = $1`,
              orderId
            );

            for (const li of o.line_items) {
              try {
                // Resolve product: try wooId first, then SKU prefix fallback
                let productId: string | null = null;
                const prodWooId = li.variation_id || li.product_id;
                if (prodWooId) {
                  const prodRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
                    `SELECT id FROM "BtocProduct" WHERE "wooId" = $1 LIMIT 1`,
                    Number(prodWooId)
                  );
                  if (prodRows.length > 0) productId = prodRows[0].id;
                }
                // Fallback: match parent product via SKU prefix (OMACCE_C012-740-TU → OMACCE_C012)
                if (!productId && li.sku) {
                  const skuPrefix = String(li.sku).split("-")[0];
                  if (skuPrefix) {
                    const skuRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
                      `SELECT id FROM "BtocProduct" WHERE sku = $1 AND type = 'variable' LIMIT 1`,
                      skuPrefix
                    );
                    if (skuRows.length > 0) productId = skuRows[0].id;
                  }
                }

                // Extract size/color from meta_data
                let size: string | null = null;
                let color: string | null = null;
                if (Array.isArray(li.meta_data)) {
                  for (const m of li.meta_data) {
                    const key = String(m.key || "").toLowerCase();
                    if (key.includes("taille") || key.includes("size") || key === "pa_taille") {
                      size = String(m.value);
                    }
                    if (key.includes("couleur") || key.includes("color") || key === "pa_couleur") {
                      color = String(m.value);
                    }
                  }
                }

                await prisma.$executeRawUnsafe(
                  `INSERT INTO "BtocOrderLine" (id, "orderId", "productId", "wooProductId",
                    name, sku, quantity, price, total, size, color, "createdAt")
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
                  genId(),
                  orderId,
                  productId,
                  Number(prodWooId) || Number(li.product_id) || 0,
                  String(li.name || ""),
                  li.sku || null,
                  Number(li.quantity) || 0,
                  parseFloat(li.price) || 0,
                  parseFloat(li.total) || 0,
                  size,
                  color
                );
              } catch {
                // Line error — non-blocking
              }
            }
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Commande WC#${o.id}: ${String(e)}`);
      }
    }

    await prisma.btocSyncLog.create({
      data: {
        syncType: "ORDERS",
        itemCount: imported,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: { imported, errors: errors.slice(0, 20), total: orders.length },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/orders");
  }
}
