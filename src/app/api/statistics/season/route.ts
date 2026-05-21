import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  const [
    clientOrderCount,
    supplierOrderCount,
    clientCount,
    allocationCount,
    deliveryCount,
  ] = await Promise.all([
    prisma.clientOrder.count({ where: { seasonId } }),
    prisma.supplierOrder.count({ where: { seasonId } }),
    prisma.clientSeason.count({ where: { seasonId, isActive: true } }),
    prisma.allocationSession.count({
      where: { seasonId, status: "SIMULATION" },
    }),
    prisma.delivery.count({ where: { status: "EXPEDIEE" } }),
  ]);

  const clientOrderLines = await prisma.clientOrderLine.findMany({
    where: { clientOrder: { seasonId } },
    select: { totalQuantity: true },
  });
  const totalPieces = clientOrderLines.reduce(
    (sum, l) => sum + l.totalQuantity,
    0
  );

  const supplierOrders = await prisma.supplierOrder.findMany({
    where: { seasonId },
    select: { status: true },
  });
  const completedOrders = supplierOrders.filter(
    (o) => o.status === "COMPLET" || o.status === "SOLDE"
  ).length;
  const receptionRate =
    supplierOrders.length > 0
      ? Math.round((completedOrders / supplierOrders.length) * 100)
      : 0;

  const deliveredLines = await prisma.deliveryLine.findMany({
    where: { delivery: { status: "EXPEDIEE" } },
    select: { totalQuantity: true },
  });
  const deliveredPieces = deliveredLines.reduce(
    (sum, l) => sum + l.totalQuantity,
    0
  );
  const deliveryRate =
    totalPieces > 0 ? Math.round((deliveredPieces / totalPieces) * 100) : 0;

  return NextResponse.json({
    data: {
      totalOrders: clientOrderCount,
      totalPieces,
      receptionRate,
      deliveryRate,
      pendingAllocations: allocationCount,
      activeClients: clientCount,
      supplierOrderCount,
      deliveryCount,
    },
  });
}
