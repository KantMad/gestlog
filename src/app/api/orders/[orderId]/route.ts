import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

// GET — order detail with delivery comparison
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  try {
    const order = await prisma.clientOrder.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        catalog: true,
        lines: { include: { product: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
    }

    // Find all deliveries for this client in this season that relate to these products
    const productIds = order.lines.map((l) => l.productId);
    const deliveries = await prisma.delivery.findMany({
      where: {
        clientId: order.clientId,
        allocationSession: { seasonId: order.seasonId },
      },
      include: {
        lines: {
          where: { productId: { in: productIds } },
          include: { product: true },
        },
      },
    });

    // Build per-product comparison: ordered vs delivered
    const comparison = order.lines.map((line) => {
      const orderedQty = parseSizeQuantities(line.quantitiesBySize);
      const orderedTotal = sumQuantities(orderedQty);

      // Sum all delivered quantities for this product across all deliveries
      const deliveredQty: Record<string, number> = {};
      let deliveredTotal = 0;
      for (const del of deliveries) {
        for (const dl of del.lines) {
          if (dl.productId === line.productId) {
            const qty = parseSizeQuantities(dl.quantitiesBySize);
            for (const [size, count] of Object.entries(qty)) {
              deliveredQty[size] = (deliveredQty[size] || 0) + count;
              deliveredTotal += count;
            }
          }
        }
      }

      // Compute diff (negative = not yet delivered / cancelled)
      const diff: Record<string, number> = {};
      for (const [size, count] of Object.entries(orderedQty)) {
        diff[size] = (deliveredQty[size] || 0) - count;
      }

      return {
        productId: line.productId,
        reference: line.product.reference,
        color: line.product.color,
        sizeScale: line.product.sizeScale,
        category: line.category,
        ordered: orderedQty,
        orderedTotal,
        delivered: deliveredQty,
        deliveredTotal,
        diff,
        remainingTotal: orderedTotal - deliveredTotal,
        status:
          deliveredTotal >= orderedTotal
            ? "COMPLET"
            : deliveredTotal > 0
            ? "PARTIEL"
            : "NON_LIVRE",
      };
    });

    return NextResponse.json({
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        catalogName: order.catalog?.name || null,
        clientName: order.client.name,
        clientCode: order.client.code,
        tioOrderNumber: order.tioOrderNumber,
        paymentStatus: order.paymentStatus,
        deliveryWindow: order.deliveryWindow,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        comparison,
        summary: {
          totalProducts: comparison.length,
          totalOrdered: comparison.reduce((s, c) => s + c.orderedTotal, 0),
          totalDelivered: comparison.reduce((s, c) => s + c.deliveredTotal, 0),
          totalRemaining: comparison.reduce((s, c) => s + c.remainingTotal, 0),
          fullyDelivered: comparison.filter((c) => c.status === "COMPLET").length,
          partiallyDelivered: comparison.filter((c) => c.status === "PARTIEL").length,
          notDelivered: comparison.filter((c) => c.status === "NON_LIVRE").length,
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
