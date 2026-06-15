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

    const clientOrderData = new Map<string, { name: string; ordered: number; cancelled: number }>();
    for (const order of clientOrders) {
      const total = order.lines.reduce((s, l) => s + l.totalQuantity, 0);
      const cancelled = order.lines.reduce((s, l) => s + (l.cancelledTotal || 0), 0);
      if (total === 0 && referenceFilter) continue;
      const existing = clientOrderData.get(order.clientId);
      if (existing) {
        existing.ordered += total;
        existing.cancelled += cancelled;
      } else {
        clientOrderData.set(order.clientId, {
          name: order.client.name,
          ordered: total,
          cancelled,
        });
      }
    }

    // ─── Livré réel = cumul des BL (par client) ──────────────
    const blRows = await prisma.$queryRawUnsafe<{ clientId: string; delivered: bigint }[]>(
      `SELECT co."clientId", COALESCE(SUM(l.quantity),0)::bigint AS delivered
       FROM "ClientOrder" co
       JOIN "WarehouseDocument" d ON d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'BL'
       JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
       WHERE co."seasonId" = $1 ${referenceFilter ? "AND l.reference ILIKE '%' || $2 || '%'" : ""}
       GROUP BY co."clientId"`,
      ...(referenceFilter ? [seasonId, referenceFilter] : [seasonId])
    );
    const clientBlDelivered = new Map<string, number>();
    for (const r of blRows) clientBlDelivered.set(r.clientId, Number(r.delivered));

    // ─── Facturé = cumul des FAC (par client) : quantités + montants HT ──
    const facRows = await prisma.$queryRawUnsafe<{ clientId: string; invoiced: bigint; amount: number }[]>(
      `SELECT co."clientId", COALESCE(SUM(l.quantity),0)::bigint AS invoiced,
              COALESCE(SUM(l.amount),0)::float8 AS amount
       FROM "ClientOrder" co
       JOIN "WarehouseDocument" d ON d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'FAC'
       JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
       WHERE co."seasonId" = $1 ${referenceFilter ? "AND l.reference ILIKE '%' || $2 || '%'" : ""}
       GROUP BY co."clientId"`,
      ...(referenceFilter ? [seasonId, referenceFilter] : [seasonId])
    );
    const clientFacInvoiced = new Map<string, number>();
    const clientFacAmount = new Map<string, number>();
    for (const r of facRows) {
      clientFacInvoiced.set(r.clientId, Number(r.invoiced));
      clientFacAmount.set(r.clientId, Number(r.amount));
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

    // Répartition par client : livré = BL, soldé = annulé, restant = commandé − soldé − livré.
    // Trié par volume commandé, limité aux 15 plus gros (lisibilité du graphe).
    const clientBreakdown = Array.from(clientOrderData.entries())
      .map(([clientId, data]) => {
        const livré = clientBlDelivered.get(clientId) || 0;
        const facturé = clientFacInvoiced.get(clientId) || 0;
        const montantFacturé = Math.round(clientFacAmount.get(clientId) || 0);
        return {
          name: data.name,
          commandé: data.ordered,
          livré,
          facturé,
          montantFacturé,
          soldé: data.cancelled,
          restant: Math.max(0, data.ordered - data.cancelled - livré),
        };
      })
      .sort((a, b) => b.commandé - a.commandé)
      .slice(0, 15);

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

    // ─── Statut des commandes (réconciliation BL : commandé vs livré, soldage) ──
    const stRows = await prisma.$queryRawUnsafe<
      { livree: bigint; soldee: bigint; partielle: bigint; non_livree: bigint }[]
    >(
      `WITH o AS (
        SELECT
          (SELECT COALESCE(SUM(col."totalQuantity"),0) FROM "ClientOrderLine" col WHERE col."clientOrderId"=co.id) ord,
          (SELECT COALESCE(SUM(col."cancelledTotal"),0) FROM "ClientOrderLine" col WHERE col."clientOrderId"=co.id) can,
          (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d JOIN "WarehouseDocumentLine" l ON l."documentId"=d.id WHERE d."tioOrderNumber"=co."orderNumber" AND d."docType"='BL') del
        FROM "ClientOrder" co WHERE co."seasonId"=$1
      )
      SELECT
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del >= GREATEST(ord-can,0) AND can=0)::bigint livree,
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del >= GREATEST(ord-can,0) AND can>0)::bigint soldee,
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del < GREATEST(ord-can,0))::bigint partielle,
        COUNT(*) FILTER (WHERE del=0 AND can=0)::bigint non_livree
      FROM o`,
      seasonId
    );
    const st = stRows[0];
    const deliveryStatus = [
      { name: "Livrées", value: Number(st?.livree || 0) },
      { name: "Soldées", value: Number(st?.soldee || 0) },
      { name: "Partielles", value: Number(st?.partielle || 0) },
      { name: "Non livrées", value: Number(st?.non_livree || 0) },
    ];

    // ─── Statut facturation (FAC suit la livraison : livré vs facturé) ──
    const invRows = await prisma.$queryRawUnsafe<
      { facturee: bigint; partielle: bigint; non_facturee: bigint }[]
    >(
      `WITH o AS (
        SELECT
          (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d JOIN "WarehouseDocumentLine" l ON l."documentId"=d.id WHERE d."tioOrderNumber"=co."orderNumber" AND d."docType"='BL') del,
          (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d JOIN "WarehouseDocumentLine" l ON l."documentId"=d.id WHERE d."tioOrderNumber"=co."orderNumber" AND d."docType"='FAC') inv
        FROM "ClientOrder" co WHERE co."seasonId"=$1
      )
      SELECT
        COUNT(*) FILTER (WHERE inv >= del AND del > 0)::bigint facturee,
        COUNT(*) FILTER (WHERE inv > 0 AND inv < del)::bigint partielle,
        COUNT(*) FILTER (WHERE del > 0 AND inv = 0)::bigint non_facturee
      FROM o`,
      seasonId
    );
    const inv = invRows[0];
    const invoiceStatus = [
      { name: "Facturées", value: Number(inv?.facturee || 0) },
      { name: "Partielles", value: Number(inv?.partielle || 0) },
      { name: "À facturer", value: Number(inv?.non_facturee || 0) },
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
      invoiceStatus,
      // Montant HT facturé total de la saison (tous clients, pas seulement le top 15).
      invoicedAmount: Math.round(
        Array.from(clientFacAmount.values()).reduce((s, v) => s + v, 0)
      ),
      deliveryTimeline,
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/charts");
  }
}
