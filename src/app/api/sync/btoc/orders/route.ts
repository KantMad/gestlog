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

        // n8n pousse parfois des line_items EN DOUBLE (même variation répétée jusqu'à 23×)
        // dans un même payload → GestLog les stockait tels quels et gonflait les quantités
        // vendues. WooCommerce n'a qu'UNE ligne par variation → on dédoublonne par
        // (variation_id/product_id + sku), en gardant la 1re. Validé : après dédup, la somme
        // des quantités = itemCount WooCommerce sur 4055/4056 commandes. `itemCount` ET les
        // lignes utilisent la MÊME liste dédupliquée → cohérence garantie.
        const seenLine = new Set<string>();
        const lineItems: Array<{
          variation_id?: number;
          product_id?: number;
          sku?: string;
          name?: string;
          quantity?: number;
          price?: string;
          total?: string;
          meta_data?: { key?: string; value?: unknown }[];
        }> = Array.isArray(o.line_items)
          ? o.line_items.filter((li: { variation_id?: number; product_id?: number; sku?: string }) => {
              const key = `${li.variation_id || li.product_id || 0}|${li.sku || ""}`;
              if (seenLine.has(key)) return false;
              seenLine.add(key);
              return true;
            })
          : [];

        const itemCount = lineItems.reduce(
          (s: number, li: { quantity?: number }) => s + (Number(li.quantity) || 0),
          0
        );

        const couponCodes = Array.isArray(o.coupon_lines) && o.coupon_lines.length > 0
          ? JSON.stringify(o.coupon_lines.map((c: { code?: string }) => c.code))
          : null;

        // Upsert order
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocOrder" (id, "wooId", "orderNumber", status, "customerId",
            "customerEmail", "customerName", "billingCity", "shippingCity",
            total, subtotal, "totalTax", "shippingTotal", "discountTotal",
            "paymentMethod", "paymentTitle", currency, "itemCount",
            "couponCodes", "customerNote", "orderDate", "completedAt", "billingCountry", "totalRefunded", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW())
           ON CONFLICT ("wooId")
           DO UPDATE SET
             status = $4,
             "billingCountry" = COALESCE($23, "BtocOrder"."billingCountry"),
             "totalRefunded" = $24,
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
          o.date_completed ? new Date(o.date_completed) : null,
          (o.billing?.country || "").toUpperCase() || null,
          Array.isArray(o.refunds)
            ? o.refunds.reduce(
                (s: number, r: { total?: string }) => s + Math.abs(parseFloat(r.total || "0") || 0),
                0
              )
            : 0
        );

        // Upsert order lines (pré-chargement produits + bulk insert) — sur la liste DÉDUP.
        if (lineItems.length > 0) {
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

            // Pré-charge les produits (par wooId ET par préfixe SKU) en 2 requêtes
            // au lieu de 2 SELECT par ligne.
            const wooIds = [
              ...new Set(
                lineItems
                  .map((li: { variation_id?: number; product_id?: number }) =>
                    Number(li.variation_id || li.product_id)
                  )
                  .filter((n: number) => Number.isFinite(n) && n > 0)
              ),
            ];
            const skuPrefixes = [
              ...new Set(
                lineItems
                  .map((li: { sku?: string }) =>
                    li.sku ? String(li.sku).split("-")[0] : null
                  )
                  .filter(Boolean)
              ),
            ];
            const byWoo = new Map<number, string>();
            if (wooIds.length > 0) {
              const rows = await prisma.$queryRawUnsafe<{ id: string; wooId: number }[]>(
                `SELECT id, "wooId" FROM "BtocProduct" WHERE "wooId" = ANY($1)`,
                wooIds
              );
              for (const r of rows) byWoo.set(Number(r.wooId), r.id);
            }
            const bySku = new Map<string, string>();
            if (skuPrefixes.length > 0) {
              const rows = await prisma.$queryRawUnsafe<{ id: string; sku: string }[]>(
                `SELECT id, sku FROM "BtocProduct" WHERE sku = ANY($1) AND type = 'variable'`,
                skuPrefixes
              );
              for (const r of rows) bySku.set(r.sku, r.id);
            }

            const valueRows = lineItems.map(
              (li: {
                variation_id?: number;
                product_id?: number;
                sku?: string;
                name?: string;
                quantity?: number;
                price?: string;
                total?: string;
                meta_data?: { key?: string; value?: unknown }[];
              }) => {
                const prodWooId = li.variation_id || li.product_id;
                let productId: string | null =
                  (prodWooId && byWoo.get(Number(prodWooId))) || null;
                if (!productId && li.sku) {
                  productId = bySku.get(String(li.sku).split("-")[0]) || null;
                }
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
                return [
                  genId(),
                  orderId,
                  productId,
                  Number(prodWooId) || Number(li.product_id) || 0,
                  String(li.name || ""),
                  li.sku || null,
                  Number(li.quantity) || 0,
                  parseFloat(li.price ?? "") || 0,
                  parseFloat(li.total ?? "") || 0,
                  size,
                  color,
                ];
              }
            );

            const COLS = `(id, "orderId", "productId", "wooProductId", name, sku, quantity, price, total, size, color, "createdAt")`;
            const CHUNK = 200;
            for (let i = 0; i < valueRows.length; i += CHUNK) {
              const slice = valueRows.slice(i, i + CHUNK);
              const flat: unknown[] = [];
              const tuples = slice.map((vals: unknown[]) => {
                const ph = vals.map((v) => {
                  flat.push(v);
                  return `$${flat.length}`;
                });
                return `(${ph.join(",")}, NOW())`;
              });
              await prisma.$executeRawUnsafe(
                // ON CONFLICT DO NOTHING : filet de sécurité avec la contrainte unique
                // (orderId, wooProductId, sku) — un doublon éventuel est ignoré au lieu de
                // faire échouer la synchro. Gère aussi les doublons AU SEIN d'un même INSERT.
                `INSERT INTO "BtocOrderLine" ${COLS} VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
                ...flat
              );
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
