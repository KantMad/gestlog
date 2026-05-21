import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId, isActive: true },
      include: { client: true },
    });

    const clientOrders = await prisma.clientOrder.findMany({
      where: { seasonId },
      include: { lines: true, client: true },
    });

    const clientOrderData = new Map<string, { name: string; ordered: number }>();
    for (const order of clientOrders) {
      const total = order.lines.reduce((s, l) => s + l.totalQuantity, 0);
      const existing = clientOrderData.get(order.clientId);
      if (existing) {
        existing.ordered += total;
      } else {
        clientOrderData.set(order.clientId, {
          name: order.client.name,
          ordered: total,
        });
      }
    }

    const deliveries = await prisma.delivery.findMany({
      where: { allocationSession: { seasonId } },
      include: { lines: true, client: true },
    });

    const clientDelivered = new Map<string, number>();
    for (const d of deliveries) {
      if (d.status === "EXPEDIEE") {
        const total = d.lines.reduce((s, l) => s + l.totalQuantity, 0);
        clientDelivered.set(
          d.clientId,
          (clientDelivered.get(d.clientId) || 0) + total
        );
      }
    }

    const clientBreakdown = Array.from(clientOrderData.entries()).map(
      ([clientId, data]) => ({
        name: data.name,
        commandé: data.ordered,
        livré: clientDelivered.get(clientId) || 0,
        restant: data.ordered - (clientDelivered.get(clientId) || 0),
      })
    );

    const supplierOrders = await prisma.supplierOrder.findMany({
      where: { seasonId },
      include: {
        supplier: true,
        lines: true,
        receptions: { include: { lines: true } },
      },
    });

    const supplierData = new Map<
      string,
      { name: string; ordered: number; received: number }
    >();
    for (const so of supplierOrders) {
      const orderedTotal = so.lines.reduce((s, l) => s + l.totalQuantity, 0);
      let receivedTotal = 0;
      for (const rec of so.receptions) {
        receivedTotal += rec.lines.reduce((s, l) => s + l.totalQuantity, 0);
      }
      const existing = supplierData.get(so.supplierId);
      if (existing) {
        existing.ordered += orderedTotal;
        existing.received += receivedTotal;
      } else {
        supplierData.set(so.supplierId, {
          name: so.supplier.name,
          ordered: orderedTotal,
          received: receivedTotal,
        });
      }
    }

    const supplierConformity = Array.from(supplierData.values()).map((s) => ({
      name: s.name,
      commandé: s.ordered,
      reçu: s.received,
      conformité: s.ordered > 0 ? Math.round((s.received / s.ordered) * 100) : 0,
    }));

    const deliveryStatus = [
      {
        name: "Planifiées",
        value: deliveries.filter((d) => d.status === "PLANIFIEE").length,
      },
      {
        name: "En préparation",
        value: deliveries.filter((d) => d.status === "EN_PREPARATION").length,
      },
      {
        name: "Expédiées",
        value: deliveries.filter((d) => d.status === "EXPEDIEE").length,
      },
    ];

    const deliveryTimeline = deliveries
      .filter((d) => d.status === "EXPEDIEE" && d.shippedAt)
      .sort(
        (a, b) =>
          new Date(a.shippedAt!).getTime() - new Date(b.shippedAt!).getTime()
      )
      .map((d) => ({
        date: new Date(d.shippedAt!).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
        }),
        client: d.client.name,
        pièces: d.lines.reduce((s, l) => s + l.totalQuantity, 0),
      }));

    return NextResponse.json({
      clientBreakdown,
      supplierConformity,
      deliveryStatus,
      deliveryTimeline,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
