import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { orderStatus, remaining, invoiceStatus } from "@/lib/reconciliation";
import { resolveOrderSourceBySeasonName } from "@/lib/order-source";

// GET — Commandes client (TIO) avec réconciliation commandé vs livré
// (via les BL/FAC liés par n° TIO). Statut à la volée : NON_LIVREE /
// PARTIELLE / LIVREE. Filtre principal : saison.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const season = p.get("season"); // nom de saison (ex: "Réassort", "AH26"). Vide = toutes.
    const clientCode = p.get("clientCode");
    const search = p.get("search");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (season) {
      conditions.push(`se.name = $${i++}`);
      params.push(season);
    }
    if (clientCode) {
      conditions.push(`cl.code = $${i++}`);
      params.push(clientCode);
    }
    if (search) {
      conditions.push(`(co."orderNumber" ILIKE $${i} OR cl.name ILIKE $${i} OR cl.code ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    // Source B2B active PAR SAISON (Texas prioritaire, repli TIO) — on ne liste
    // qu'UNE source par saison pour éviter le double comptage TIO+TEXAS. Comme la
    // requête peut couvrir plusieurs saisons (filtre saison optionnel), on filtre
    // chaque saison par sa source résolue (clause OR par nom de saison).
    const seasonRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT DISTINCT se.name FROM "Season" se
       WHERE EXISTS (SELECT 1 FROM "ClientOrder" co WHERE co."seasonId" = se.id)`
    );
    const srcBySeason = await resolveOrderSourceBySeasonName(seasonRows.map((r) => r.name));
    const srcConds: string[] = [];
    for (const [name, src] of srcBySeason) {
      srcConds.push(`(se.name = $${i} AND co."source" = $${i + 1})`);
      params.push(name, src);
      i += 2;
    }
    if (srcConds.length) conditions.push(`(${srcConds.join(" OR ")})`);

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const rows = await prisma.$queryRawUnsafe<
      {
        id: string;
        orderNumber: string;
        clientCode: string;
        clientName: string;
        catalog: string | null;
        seasonName: string;
        orderDate: Date | null;
        ordered: bigint;
        cancelled: bigint;
        delivered: bigint;
        invoiced: bigint;
        docCount: bigint;
        facCount: bigint;
      }[]
    >(
      `SELECT co.id, co."orderNumber", cl.code AS "clientCode", cl.name AS "clientName",
              cat.name AS catalog, se.name AS "seasonName", co."orderDate",
              (SELECT COALESCE(SUM(col."totalQuantity"),0) FROM "ClientOrderLine" col WHERE col."clientOrderId" = co.id) AS ordered,
              (SELECT COALESCE(SUM(col."cancelledTotal"),0) FROM "ClientOrderLine" col WHERE col."clientOrderId" = co.id) AS cancelled,
              (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d
                 JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
                 WHERE d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'BL') AS delivered,
              (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d
                 JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
                 WHERE d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'FAC') AS invoiced,
              (SELECT COUNT(DISTINCT d."documentNumber") FROM "WarehouseDocument" d
                 WHERE d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'BL') AS "docCount",
              (SELECT COUNT(DISTINCT d."documentNumber") FROM "WarehouseDocument" d
                 WHERE d."tioOrderNumber" = co."orderNumber" AND d."docType" = 'FAC') AS "facCount"
       FROM "ClientOrder" co
       JOIN "Client" cl ON cl.id = co."clientId"
       JOIN "Season" se ON se.id = co."seasonId"
       LEFT JOIN "Catalog" cat ON cat.id = co."catalogId"
       ${where}
       ORDER BY co."orderDate" DESC NULLS LAST, co."orderNumber" DESC
       LIMIT 1000`,
      ...params
    );

    let documents = rows.map((r) => {
      const ordered = Number(r.ordered);
      const cancelled = Number(r.cancelled);
      const delivered = Number(r.delivered);
      const invoiced = Number(r.invoiced);
      const status = orderStatus(ordered, cancelled, delivered);
      return {
        id: r.id,
        orderNumber: r.orderNumber,
        clientCode: r.clientCode,
        clientName: r.clientName,
        catalog: r.catalog,
        seasonName: r.seasonName,
        orderDate: r.orderDate,
        ordered,
        cancelled,
        delivered,
        invoiced,
        missing: remaining(ordered, cancelled, delivered),
        docCount: Number(r.docCount),
        facCount: Number(r.facCount),
        status,
        invStatus: invoiceStatus(delivered, invoiced),
      };
    });

    // filtre statut optionnel
    const statusFilter = p.get("status");
    if (statusFilter) documents = documents.filter((d) => d.status === statusFilter);
    const invFilter = p.get("invStatus");
    if (invFilter) documents = documents.filter((d) => d.invStatus === invFilter);

    const summary = {
      orders: documents.length,
      ordered: documents.reduce((s, d) => s + d.ordered, 0),
      cancelled: documents.reduce((s, d) => s + d.cancelled, 0),
      delivered: documents.reduce((s, d) => s + d.delivered, 0),
      invoiced: documents.reduce((s, d) => s + d.invoiced, 0),
      livree: documents.filter((d) => d.status === "LIVREE").length,
      soldee: documents.filter((d) => d.status === "SOLDEE").length,
      partielle: documents.filter((d) => d.status === "PARTIELLE").length,
      nonLivree: documents.filter((d) => d.status === "NON_LIVREE").length,
      // facturation : on ne compte que les commandes ayant quelque chose de livré
      facturee: documents.filter((d) => d.invStatus === "FACTUREE").length,
      facPartielle: documents.filter((d) => d.invStatus === "PARTIELLE").length,
      nonFacturee: documents.filter((d) => d.invStatus === "NON_FACTUREE").length,
    };

    // Clients disponibles (toutes commandes)
    const clients = await prisma.$queryRawUnsafe<{ code: string; name: string }[]>(
      `SELECT DISTINCT cl.code, cl.name FROM "ClientOrder" co
       JOIN "Client" cl ON cl.id = co."clientId" ORDER BY cl.name`
    );
    // Saisons disponibles (avec commandes) — Réassort en tête
    const seasons = await prisma.$queryRawUnsafe<{ name: string; type: string }[]>(
      `SELECT se.name, se.type FROM "Season" se
       WHERE EXISTS (SELECT 1 FROM "ClientOrder" co WHERE co."seasonId" = se.id)
       ORDER BY (se.type = 'REASSORT') DESC, se.name DESC`
    );

    return NextResponse.json({ documents, summary, clients, seasons: seasons.map((s) => s.name) });
  } catch (e) {
    return handleApiError(e, "api/reassort");
  }
}
