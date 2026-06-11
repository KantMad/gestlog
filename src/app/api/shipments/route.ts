import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des livraisons (BL / FAC importés) avec filtres + résumé.
// Filtres : docType, clientCode, orderSeason (saison de la commande TIO liée),
// dateFrom, dateTo, search.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const docType = p.get("docType"); // "BL" | "FAC" | null
    const clientCode = p.get("clientCode");
    const orderSeason = p.get("orderSeason"); // saison de la commande liée
    const search = p.get("search");
    const dateFrom = p.get("dateFrom");
    const dateTo = p.get("dateTo");

    const conditions: string[] = [`d.source = 'warehouse_ftp'`];
    const params: unknown[] = [];
    let i = 1;

    if (docType === "BL" || docType === "FAC") {
      conditions.push(`d."docType" = $${i++}`);
      params.push(docType);
    }
    if (clientCode) {
      conditions.push(`d."clientCode" = $${i++}`);
      params.push(clientCode);
    }
    if (orderSeason) {
      conditions.push(
        `EXISTS (SELECT 1 FROM "ClientOrder" co JOIN "Season" se ON se.id = co."seasonId"
                 WHERE co."orderNumber" = d."tioOrderNumber" AND se.name = $${i})`
      );
      params.push(orderSeason);
      i++;
    }
    if (dateFrom) {
      conditions.push(`d."documentDate" >= $${i++}`);
      params.push(new Date(dateFrom));
    }
    if (dateTo) {
      conditions.push(`d."documentDate" <= $${i++}`);
      params.push(new Date(dateTo + "T23:59:59.999"));
    }
    if (search) {
      conditions.push(
        `(d."documentNumber" ILIKE $${i} OR d."clientName" ILIKE $${i} OR d."clientCode" ILIKE $${i}
          OR d."tioOrderNumber" ILIKE $${i}
          OR EXISTS (SELECT 1 FROM "WarehouseDocumentLine" l
                     WHERE l."documentId" = d.id
                       AND (l.reference ILIKE $${i} OR l.ean ILIKE $${i})))`
      );
      params.push(`%${search}%`);
      i++;
    }

    const where = "WHERE " + conditions.join(" AND ");

    const documents = await prisma.$queryRawUnsafe<
      {
        id: string;
        docType: string;
        documentNumber: string;
        tioOrderNumber: string | null;
        orderSeason: string | null;
        season: string | null;
        clientCode: string | null;
        clientName: string | null;
        documentDate: Date | null;
        totalQuantity: number;
        lineCount: bigint;
        clientKnown: boolean;
      }[]
    >(
      `SELECT d.id, d."docType", d."documentNumber", d."tioOrderNumber", d.season, d."clientCode",
              d."clientName", d."documentDate", d."totalQuantity",
              (SELECT se.name FROM "ClientOrder" co JOIN "Season" se ON se.id = co."seasonId"
                 WHERE co."orderNumber" = d."tioOrderNumber" LIMIT 1) AS "orderSeason",
              (SELECT COUNT(*) FROM "WarehouseDocumentLine" l WHERE l."documentId" = d.id) AS "lineCount",
              EXISTS (SELECT 1 FROM "Client" c WHERE c.code = d."clientCode") AS "clientKnown"
       FROM "WarehouseDocument" d
       ${where}
       ORDER BY d."documentDate" DESC NULLS LAST, d."documentNumber" DESC
       LIMIT 500`,
      ...params
    );

    const summary = await prisma.$queryRawUnsafe<
      { docs: bigint; qty: bigint; clients: bigint }[]
    >(
      `SELECT COUNT(*) AS docs, COALESCE(SUM(d."totalQuantity"),0) AS qty,
              COUNT(DISTINCT d."clientCode") AS clients
       FROM "WarehouseDocument" d ${where}`,
      ...params
    );

    const clients = await prisma.$queryRawUnsafe<
      { clientCode: string; clientName: string | null }[]
    >(
      `SELECT d."clientCode", MAX(d."clientName") AS "clientName"
       FROM "WarehouseDocument" d
       WHERE d."clientCode" IS NOT NULL
       GROUP BY d."clientCode" ORDER BY MAX(d."clientName")`
    );
    // Saisons (de commande) disponibles parmi les livraisons
    const seasons = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT DISTINCT se.name FROM "WarehouseDocument" d
         JOIN "ClientOrder" co ON co."orderNumber" = d."tioOrderNumber"
         JOIN "Season" se ON se.id = co."seasonId"
       WHERE d.source = 'warehouse_ftp' ORDER BY se.name`
    );

    return NextResponse.json({
      documents: documents.map((d) => ({
        ...d,
        lineCount: Number(d.lineCount),
        documentDate: d.documentDate,
      })),
      summary: {
        docs: Number(summary[0].docs),
        qty: Number(summary[0].qty),
        clients: Number(summary[0].clients),
      },
      clients,
      seasons: seasons.map((s) => s.name),
    });
  } catch (e) {
    return handleApiError(e, "api/shipments");
  }
}
