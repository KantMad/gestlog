import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — Suivi des livraisons : commandes B2B (réassort par défaut) avec
// réconciliation commandé vs livré (via les BL/FAC liés par n° TIO).
// Statut calculé à la volée : NON_LIVREE / PARTIELLE / LIVREE.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const scope = p.get("scope") || "reassort"; // "reassort" | "all" | "delivered"
    const clientCode = p.get("clientCode");
    const search = p.get("search");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (scope === "reassort") {
      conditions.push(`se.type = 'REASSORT'`);
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
        delivered: bigint;
        docCount: bigint;
      }[]
    >(
      `SELECT co.id, co."orderNumber", cl.code AS "clientCode", cl.name AS "clientName",
              cat.name AS catalog, se.name AS "seasonName", co."orderDate",
              (SELECT COALESCE(SUM(col."totalQuantity"),0) FROM "ClientOrderLine" col WHERE col."clientOrderId" = co.id) AS ordered,
              (SELECT COALESCE(SUM(l.quantity),0) FROM "WarehouseDocument" d
                 JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
                 WHERE d."tioOrderNumber" = co."orderNumber") AS delivered,
              (SELECT COUNT(DISTINCT d."documentNumber") FROM "WarehouseDocument" d
                 WHERE d."tioOrderNumber" = co."orderNumber") AS "docCount"
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
      const delivered = Number(r.delivered);
      const status =
        delivered === 0 ? "NON_LIVREE" : delivered >= ordered ? "LIVREE" : "PARTIELLE";
      return {
        id: r.id,
        orderNumber: r.orderNumber,
        clientCode: r.clientCode,
        clientName: r.clientName,
        catalog: r.catalog,
        seasonName: r.seasonName,
        orderDate: r.orderDate,
        ordered,
        delivered,
        missing: Math.max(0, ordered - delivered),
        docCount: Number(r.docCount),
        status,
      };
    });

    // scope "delivered" : seulement les commandes avec au moins une livraison
    if (scope === "delivered") {
      documents = documents.filter((d) => d.docCount > 0);
    }

    // filtre statut optionnel
    const statusFilter = p.get("status");
    if (statusFilter) documents = documents.filter((d) => d.status === statusFilter);

    const summary = {
      orders: documents.length,
      ordered: documents.reduce((s, d) => s + d.ordered, 0),
      delivered: documents.reduce((s, d) => s + d.delivered, 0),
      livree: documents.filter((d) => d.status === "LIVREE").length,
      partielle: documents.filter((d) => d.status === "PARTIELLE").length,
      nonLivree: documents.filter((d) => d.status === "NON_LIVREE").length,
    };

    // Clients disponibles (réassort)
    const clients = await prisma.$queryRawUnsafe<{ code: string; name: string }[]>(
      `SELECT DISTINCT cl.code, cl.name FROM "ClientOrder" co
       JOIN "Client" cl ON cl.id = co."clientId"
       JOIN "Season" se ON se.id = co."seasonId"
       WHERE se.type = 'REASSORT' ORDER BY cl.name`
    );

    return NextResponse.json({ documents, summary, clients });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
