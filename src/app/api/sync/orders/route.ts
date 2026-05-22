import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST — Receive client orders from n8n
// Expects JSON array of orders with their lines
export async function POST(request: NextRequest) {
  try {
    // Simple API key auth
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const orders = Array.isArray(body) ? body : body.orders || [body];

    const errors: string[] = [];
    let imported = 0;

    for (const order of orders) {
      try {
        const {
          orderNumber,
          clientCode,
          clientName,
          clientEmail,
          seasonName,
          status,
          deliveryWindowStart,
          deliveryWindowEnd,
          orderType,
          lines, // array of { reference, color, colorLabel, sizeTypeCode, quantities: {size: qty}, category }
        } = order;

        if (!orderNumber || !clientCode || !seasonName) {
          errors.push(`Commande ${orderNumber || "?"}: donnees manquantes`);
          continue;
        }

        // Find or skip season
        const season = await prisma.season.findFirst({
          where: { name: seasonName },
        });
        if (!season) {
          errors.push(`Commande ${orderNumber}: saison "${seasonName}" non trouvee`);
          continue;
        }

        // Upsert client
        const client = await prisma.client.upsert({
          where: { code: clientCode },
          update: { name: clientName || clientCode, email: clientEmail || undefined },
          create: { code: clientCode, name: clientName || clientCode, email: clientEmail || undefined },
        });

        // Upsert client season
        await prisma.clientSeason.upsert({
          where: { clientId_seasonId: { clientId: client.id, seasonId: season.id } },
          update: {},
          create: { clientId: client.id, seasonId: season.id },
        });

        // Build delivery window string
        const deliveryWindow = deliveryWindowStart && deliveryWindowEnd
          ? `${deliveryWindowStart} - ${deliveryWindowEnd}`
          : deliveryWindowStart || deliveryWindowEnd || null;

        // Map status
        const statusMap: Record<string, string> = {
          "Confirmer": "VALIDEE",
          "Confirmed": "VALIDEE",
          "En cours": "EN_COURS",
          "Pending": "EN_COURS",
          "Solder": "SOLDEE",
          "Annuler": "ANNULEE",
          "Cancelled": "ANNULEE",
        };
        const mappedStatus = statusMap[status] || "EN_COURS";

        // Upsert order
        const clientOrder = await prisma.clientOrder.upsert({
          where: { orderNumber_seasonId: { orderNumber: String(orderNumber), seasonId: season.id } },
          update: {
            status: mappedStatus,
            deliveryWindow,
            orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
          },
          create: {
            orderNumber: String(orderNumber),
            seasonId: season.id,
            clientId: client.id,
            status: mappedStatus,
            deliveryWindow,
            orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
          },
        });

        // Process lines
        if (Array.isArray(lines)) {
          for (const line of lines) {
            const { reference, color, colorLabel, quantities, category, sizeTypeCode } = line;
            if (!reference || !color) continue;

            const sizeScale = quantities ? Object.keys(quantities).join(",") : "";

            const product = await prisma.product.upsert({
              where: { reference_color: { reference: String(reference), color: String(color) } },
              update: {},
              create: {
                reference: String(reference),
                color: String(color),
                colorCode: colorLabel || undefined,
                sizeScale,
              },
            });

            const quantitiesBySize = quantities ? JSON.stringify(quantities) : "{}";
            const totalQuantity = quantities
              ? Object.values(quantities as Record<string, number>).reduce((s, v) => s + (Number(v) || 0), 0)
              : 0;

            await prisma.clientOrderLine.upsert({
              where: {
                clientOrderId_productId: {
                  clientOrderId: clientOrder.id,
                  productId: product.id,
                },
              },
              update: { quantitiesBySize, totalQuantity, category: category || null, sizeTypeCode: sizeTypeCode || null },
              create: {
                clientOrderId: clientOrder.id,
                productId: product.id,
                quantitiesBySize,
                totalQuantity,
                category: category || null,
                sizeTypeCode: sizeTypeCode || null,
              },
            });
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Commande ${order.orderNumber || "?"}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported, errors, total: orders.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync: ${String(e)}` },
      { status: 500 }
    );
  }
}
