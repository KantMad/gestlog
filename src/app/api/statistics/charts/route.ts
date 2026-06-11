import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  const referenceFilter = request.nextUrl.searchParams.get("reference") || "";
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    // ─── Client Orders ───────────────────────────────────────
    const clientOrders = await prisma.clientOrder.findMany({
      where: { seasonId },
      include: {
        lines: {
          include: { product: true },
          ...(referenceFilter
            ? { where: { product: { reference: { contains: referenceFilter, mode: "insensitive" } } } }
            : {}),
        },
        client: true,
      },
    });

    const clientOrderData = new Map<string, { name: string; ordered: number }>();
    for (const order of clientOrders) {
      const total = order.lines.reduce((s, l) => s + l.totalQuantity, 0);
      if (total === 0 && referenceFilter) continue;
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

    // ─── Deliveries ──────────────────────────────────────────
    const deliveries = await prisma.delivery.findMany({
      where: { allocationSession: { seasonId } },
      include: {
        lines: {
          include: { product: true },
          ...(referenceFilter
            ? { where: { product: { reference: { contains: referenceFilter, mode: "insensitive" } } } }
            : {}),
        },
        client: true,
      },
    });

    const clientDelivered = new Map<string, number>();
    // Detailed: all deliveries per client (all statuses)
    const clientDeliveryDetail = new Map<
      string,
      { name: string; planifiées: number; enPreparation: number; expédiées: number }
    >();
    for (const d of deliveries) {
      const total = d.lines.reduce((s, l) => s + l.totalQuantity, 0);
      if (total === 0 && referenceFilter) continue;

      // For main breakdown (only shipped)
      if (d.status === "EXPEDIEE") {
        clientDelivered.set(
          d.clientId,
          (clientDelivered.get(d.clientId) || 0) + total
        );
      }

      // For detailed delivery stats per client
      const detail = clientDeliveryDetail.get(d.clientId) || {
        name: d.client.name,
        planifiées: 0,
        enPreparation: 0,
        expédiées: 0,
      };
      if (d.status === "PLANIFIEE") detail.planifiées += total;
      else if (d.status === "EN_PREPARATION") detail.enPreparation += total;
      else if (d.status === "EXPEDIEE") detail.expédiées += total;
      clientDeliveryDetail.set(d.clientId, detail);
    }

    const clientBreakdown = Array.from(clientOrderData.entries()).map(
      ([clientId, data]) => ({
        name: data.name,
        commandé: data.ordered,
        livré: clientDelivered.get(clientId) || 0,
        restant: data.ordered - (clientDelivered.get(clientId) || 0),
      })
    );

    // Client delivery detail (all statuses)
    const clientDeliveries = Array.from(clientDeliveryDetail.values());

    // ─── Supplier Orders + Receptions ────────────────────────
    const supplierOrders = await prisma.supplierOrder.findMany({
      where: { seasonId },
      include: {
        supplier: true,
        lines: {
          include: { product: true },
          ...(referenceFilter
            ? { where: { product: { reference: { contains: referenceFilter, mode: "insensitive" } } } }
            : {}),
        },
        receptions: {
          include: {
            lines: {
              include: { product: true },
              ...(referenceFilter
                ? { where: { product: { reference: { contains: referenceFilter, mode: "insensitive" } } } }
                : {}),
            },
          },
        },
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
      if (orderedTotal === 0 && receivedTotal === 0 && referenceFilter) continue;

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

    // Supplier receptions detail
    const supplierReceptions = Array.from(supplierData.values()).map((s) => ({
      name: s.name,
      commandé: s.ordered,
      reçu: s.received,
      manquant: Math.max(0, s.ordered - s.received),
    }));

    // ─── Delivery status ─────────────────────────────────────
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

    // ─── Timeline ────────────────────────────────────────────
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
      clientDeliveries,
      supplierConformity,
      supplierReceptions,
      deliveryStatus,
      deliveryTimeline,
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/charts");
  }
}
