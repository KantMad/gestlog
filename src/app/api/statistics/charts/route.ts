import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";
import { resolveOrderSource } from "@/lib/order-source";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  const referenceFilter = request.nextUrl.searchParams.get("reference") || "";
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    // Source B2B active pour la saison (Texas prioritaire, repli TIO) — on ne lit
    // qu'UNE source par saison pour éviter le double comptage TIO+TEXAS.
    const src = await resolveOrderSource(seasonId);

    // ─── Client Orders ───────────────────────────────────────
    const clientOrders = await prisma.clientOrder.findMany({
      where: { seasonId, source: src },
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
         AND co."source" = $${referenceFilter ? 3 : 2}
       GROUP BY co."clientId"`,
      ...(referenceFilter ? [seasonId, referenceFilter, src] : [seasonId, src])
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
         AND co."source" = $${referenceFilter ? 3 : 2}
       GROUP BY co."clientId"`,
      ...(referenceFilter ? [seasonId, referenceFilter, src] : [seasonId, src])
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
    const allClients = Array.from(clientOrderData.entries())
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
      .sort((a, b) => b.commandé - a.commandé);

    // ⚠️ TOTAUX DE LA SAISON, calculés sur TOUS les clients — à ne pas confondre avec
    // `clientBreakdown`, tronqué au top 15 pour la lisibilité du graphe.
    // L'écran Statistiques sommait les tuiles depuis le top 15 : il n'affichait donc
    // qu'entre 32 % et 53 % des pièces selon la saison (*PE27 : 16 703 sur 51 791*),
    // tout en montrant à côté un montant facturé, lui, calculé sur tous les clients.
    const totals = {
      clients: allClients.length,
      commandé: allClients.reduce((s, c) => s + c.commandé, 0),
      livré: allClients.reduce((s, c) => s + c.livré, 0),
      facturé: allClients.reduce((s, c) => s + c.facturé, 0),
      soldé: allClients.reduce((s, c) => s + c.soldé, 0),
      restant: allClients.reduce((s, c) => s + c.restant, 0),
    };

    // Top 15 pour le GRAPHE uniquement.
    const clientBreakdown = allClients.slice(0, 15);

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

    // ⚠️ Conformité GLOBALE = total reçu / total commandé, PAS la moyenne des
    // pourcentages par fournisseur : cette moyenne donne le même poids à un fournisseur
    // de 5 pièces qu'à un fournisseur de 40 000. *AH26 : 35 % en moyenne simple contre
    // 51 % en pondéré.* Le pondéré est aussi ce qu'affiche le tableau de bord, donc les
    // deux écrans concordent enfin.
    const supplierTotals = {
      commandé: [...supplierData.values()].reduce((s, x) => s + x.ordered, 0),
      reçu: [...supplierData.values()].reduce((s, x) => s + x.received, 0),
    };

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
        FROM "ClientOrder" co WHERE co."seasonId"=$1 AND co."source"=$2
      )
      SELECT
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del >= GREATEST(ord-can,0) AND can=0)::bigint livree,
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del >= GREATEST(ord-can,0) AND can>0)::bigint soldee,
        COUNT(*) FILTER (WHERE NOT (del=0 AND can=0) AND del < GREATEST(ord-can,0))::bigint partielle,
        COUNT(*) FILTER (WHERE del=0 AND can=0)::bigint non_livree
      FROM o`,
      seasonId,
      src
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
        FROM "ClientOrder" co WHERE co."seasonId"=$1 AND co."source"=$2
      )
      SELECT
        COUNT(*) FILTER (WHERE inv >= del AND del > 0)::bigint facturee,
        COUNT(*) FILTER (WHERE inv > 0 AND inv < del)::bigint partielle,
        COUNT(*) FILTER (WHERE del > 0 AND inv = 0)::bigint non_facturee
      FROM o`,
      seasonId,
      src
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
      totals,
      supplierTotals,
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
