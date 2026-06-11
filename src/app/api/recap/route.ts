import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

// GET — client recap for a season: ordered vs delivered vs remaining
export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    // Get all clients with their season config
    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId },
      include: { client: true },
      orderBy: { ranking: "asc" },
    });

    // Get all client orders for this season
    const orders = await prisma.clientOrder.findMany({
      where: { seasonId },
      include: {
        lines: { include: { product: true } },
        catalog: { select: { id: true, name: true } },
      },
    });

    // Get all deliveries for this season (via allocation session)
    const deliveries = await prisma.delivery.findMany({
      where: {
        allocationSession: { seasonId },
      },
      include: {
        lines: { include: { product: true } },
      },
    });

    // Build per-client recap
    const recapByClient = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        clientCode: string;
        ranking: number;
        orders: {
          id: string;
          orderNumber: string;
          orderType: string;
          status: string;
          catalogName: string | null;
          totalOrdered: number;
          paymentStatus: string;
          tioOrderNumber: string | null;
        }[];
        totalOrdered: number;
        totalDelivered: number;
        totalRemaining: number;
        deliveryCount: number;
        deliveries: {
          id: string;
          deliveryNumber: number;
          status: string;
          colorCode: string;
          totalQuantity: number;
          shippedAt: string | null;
          createdAt: string;
        }[];
      }
    >();

    // Initialize from clientSeasons
    for (const cs of clientSeasons) {
      recapByClient.set(cs.clientId, {
        clientId: cs.clientId,
        clientName: cs.client.name,
        clientCode: cs.client.code,
        ranking: cs.ranking,
        orders: [],
        totalOrdered: 0,
        totalDelivered: 0,
        totalRemaining: 0,
        deliveryCount: 0,
        deliveries: [],
      });
    }

    // Aggregate orders
    for (const order of orders) {
      let recap = recapByClient.get(order.clientId);
      if (!recap) {
        // Client not in clientSeason but has orders
        recap = {
          clientId: order.clientId,
          clientName: "",
          clientCode: "",
          ranking: 99,
          orders: [],
          totalOrdered: 0,
          totalDelivered: 0,
          totalRemaining: 0,
          deliveryCount: 0,
          deliveries: [],
        };
        recapByClient.set(order.clientId, recap);
      }

      const orderTotal = order.lines.reduce((sum, l) => {
        return sum + sumQuantities(parseSizeQuantities(l.quantitiesBySize));
      }, 0);

      recap.orders.push({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        catalogName: order.catalog?.name || null,
        totalOrdered: orderTotal,
        paymentStatus: order.paymentStatus,
        tioOrderNumber: order.tioOrderNumber,
      });
      recap.totalOrdered += orderTotal;
    }

    // Aggregate deliveries
    for (const del of deliveries) {
      const recap = recapByClient.get(del.clientId);
      if (!recap) continue;

      const delTotal = del.lines.reduce((sum, l) => {
        return sum + sumQuantities(parseSizeQuantities(l.quantitiesBySize));
      }, 0);

      recap.deliveries.push({
        id: del.id,
        deliveryNumber: del.deliveryNumber,
        status: del.status,
        colorCode: del.colorCode,
        totalQuantity: delTotal,
        shippedAt: del.shippedAt?.toISOString() || null,
        createdAt: del.createdAt.toISOString(),
      });

      if (del.status === "EXPEDIEE" || del.status === "VALIDEE_DEPOT") {
        recap.totalDelivered += delTotal;
      }
      recap.deliveryCount++;
    }

    // Compute remaining
    for (const recap of recapByClient.values()) {
      recap.totalRemaining = Math.max(0, recap.totalOrdered - recap.totalDelivered);
    }

    const data = Array.from(recapByClient.values()).sort(
      (a, b) => a.ranking - b.ranking || a.clientCode.localeCompare(b.clientCode)
    );

    // Global stats
    const stats = {
      totalClients: data.length,
      totalOrdered: data.reduce((s, c) => s + c.totalOrdered, 0),
      totalDelivered: data.reduce((s, c) => s + c.totalDelivered, 0),
      totalRemaining: data.reduce((s, c) => s + c.totalRemaining, 0),
      totalDeliveries: data.reduce((s, c) => s + c.deliveryCount, 0),
    };

    return NextResponse.json({ data, stats });
  } catch (e) {
    return handleApiError(e, "api/recap");
  }
}
