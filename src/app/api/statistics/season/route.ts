import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrderSource } from "@/lib/order-source";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  // Source B2B active pour la saison (Texas prioritaire, repli TIO) — on ne lit
  // qu'UNE source par saison pour éviter le double comptage TIO+TEXAS.
  const src = await resolveOrderSource(seasonId);

  const [
    clientOrderCount,
    supplierOrderCount,
    clientCount,
    allocationCount,
    deliveryCount,
  ] = await Promise.all([
    prisma.clientOrder.count({ where: { seasonId, source: src } }),
    prisma.supplierOrder.count({ where: { seasonId } }),
    prisma.clientSeason.count({ where: { seasonId, isActive: true } }),
    prisma.allocationSession.count({
      where: { seasonId, status: "SIMULATION" },
    }),
    // ⚠️ Compte les livraisons DE LA SAISON (via la session de répartition). Sans ce
    // filtre, la tuile affichait le total toutes saisons confondues sur chaque saison.
    prisma.delivery.count({
      where: { status: "EXPEDIEE", allocationSession: { seasonId } },
    }),
  ]);

  // ⚠️ Le filtre `source` est INDISPENSABLE : une saison peut porter les mêmes commandes
  // en TIO (archive) et en TEXAS (vérité). Sans lui, les pièces étaient comptées deux
  // fois. *Cas réel AH26 : 158 636 pièces affichées pour 69 925 réelles (x2,27).*
  const clientOrderLines = await prisma.clientOrderLine.findMany({
    where: { clientOrder: { seasonId, source: src } },
    select: { totalQuantity: true },
  });
  const totalPieces = clientOrderLines.reduce(
    (sum, l) => sum + l.totalQuantity,
    0
  );

  // (les commandes fournisseur n'ont pas de double source : pas de filtre à ajouter)
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
    where: { clientOrder: { seasonId, source: src } },
    _sum: { cancelledTotal: true },
  });
  const cancelledPieces = cancelledAgg._sum.cancelledTotal || 0;

  // Livré = cumul des BL des commandes de la saison (et non l'ancien workflow Delivery).
  const blAgg = await prisma.$queryRawUnsafe<{ delivered: bigint }[]>(
    `SELECT COALESCE(SUM(l.quantity),0)::bigint AS delivered
     FROM "ClientOrder" co
     JOIN "WarehouseDocument" d ON d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'BL'
     JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
     WHERE co."seasonId" = $1 AND co."source" = $2`,
    seasonId,
    src
  );
  const deliveredPieces = Number(blAgg[0]?.delivered || 0);
  const effectivePieces = Math.max(0, totalPieces - cancelledPieces);
  const deliveryRate =
    effectivePieces > 0 ? Math.round((deliveredPieces / effectivePieces) * 100) : 0;

  // Facturé = cumul des FAC des commandes de la saison. Taux = facturé / livré
  // (la facture suit la livraison ; < 100 % = pièces livrées restant à facturer).
  const facAgg = await prisma.$queryRawUnsafe<{ invoiced: bigint; amount: number }[]>(
    `SELECT COALESCE(SUM(l.quantity),0)::bigint AS invoiced,
            COALESCE(SUM(l.amount),0)::float8 AS amount
     FROM "ClientOrder" co
     JOIN "WarehouseDocument" d ON d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'FAC'
     JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
     WHERE co."seasonId" = $1 AND co."source" = $2`,
    seasonId,
    src
  );
  const invoicedPieces = Number(facAgg[0]?.invoiced || 0);
  const invoicedAmount = Number(facAgg[0]?.amount || 0);
  const invoiceRate =
    deliveredPieces > 0 ? Math.round((invoicedPieces / deliveredPieces) * 100) : 0;

  return NextResponse.json({
    data: {
      totalOrders: clientOrderCount,
      totalPieces,
      cancelledPieces,
      deliveredPieces,
      invoicedPieces,
      invoicedAmount,
      receptionRate,
      deliveryRate,
      invoiceRate,
      pendingAllocations: allocationCount,
      activeClients: clientCount,
      supplierOrderCount,
      deliveryCount,
    },
  });
}
