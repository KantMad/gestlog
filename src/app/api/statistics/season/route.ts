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

  // Soldé (pièces annulées) sur la saison → retirées du dénominateur.
  const cancelledAgg = await prisma.clientOrderLine.aggregate({
    where: { clientOrder: { seasonId } },
    _sum: { cancelledTotal: true },
  });
  const cancelledPieces = cancelledAgg._sum.cancelledTotal || 0;

  // Livré = cumul des BL des commandes de la saison (et non l'ancien workflow Delivery).
  const blAgg = await prisma.$queryRawUnsafe<{ delivered: bigint }[]>(
    `SELECT COALESCE(SUM(l.quantity),0)::bigint AS delivered
     FROM "ClientOrder" co
     JOIN "WarehouseDocument" d ON d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'BL'
     JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
     WHERE co."seasonId" = $1`,
    seasonId
  );
  const deliveredPieces = Number(blAgg[0]?.delivered || 0);
  const effectivePieces = Math.max(0, totalPieces - cancelledPieces);
  const deliveryRate =
    effectivePieces > 0 ? Math.round((deliveredPieces / effectivePieces) * 100) : 0;

  return NextResponse.json({
    data: {
      totalOrders: clientOrderCount,
      totalPieces,
      cancelledPieces,
      deliveredPieces,
      receptionRate,
      deliveryRate,
      pendingAllocations: allocationCount,
      activeClients: clientCount,
      supplierOrderCount,
      deliveryCount,
    },
  });
}
