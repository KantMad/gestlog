import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — Liste des documents entrepôt (BL / FAC) avec filtres + résumé.
// Filtres : docType, clientCode, dateFrom, dateTo, season, search.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const docType = p.get("docType"); // "BL" | "FAC" | null
    const clientCode = p.get("clientCode");
    const season = p.get("season");
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
    if (season) {
      conditions.push(`d.season = $${i++}`);
      params.push(season);
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
        season: string | null;
        clientCode: string | null;
        clientName: string | null;
        documentDate: Date | null;
        totalQuantity: number;
        lineCount: bigint;
        clientKnown: boolean;
      }[]
    >(
      `SELECT d.id, d."docType", d."documentNumber", d.season, d."clientCode",
              d."clientName", d."documentDate", d."totalQuantity",
              (SELECT COUNT(*) FROM "WarehouseDocumentLine" l WHERE l."documentId" = d.id) AS "lineCount",
              EXISTS (SELECT 1 FROM "Client" c WHERE c.code = d."clientCode") AS "clientKnown"
       FROM "WarehouseDocument" d
       ${where}
       ORDER BY d."documentDate" DESC NULLS LAST, d."documentNumber" DESC
       LIMIT 500`,
      ...params
    );

    // Résumé sur l'ensemble du filtre (pas seulement la page)
    const summary = await prisma.$queryRawUnsafe<
      { docs: bigint; qty: bigint; clients: bigint }[]
    >(
      `SELECT COUNT(*) AS docs, COALESCE(SUM(d."totalQuantity"),0) AS qty,
              COUNT(DISTINCT d."clientCode") AS clients
       FROM "WarehouseDocument" d ${where}`,
      ...params
    );

    // Options de filtre (indépendantes des filtres courants)
    const clients = await prisma.$queryRawUnsafe<
      { clientCode: string; clientName: string | null }[]
    >(
      `SELECT d."clientCode", MAX(d."clientName") AS "clientName"
       FROM "WarehouseDocument" d
       WHERE d."clientCode" IS NOT NULL
       GROUP BY d."clientCode" ORDER BY MAX(d."clientName")`
    );
    const seasons = await prisma.$queryRawUnsafe<{ season: string }[]>(
      `SELECT DISTINCT season FROM "WarehouseDocument"
       WHERE season IS NOT NULL AND season != '' ORDER BY season DESC`
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
      seasons: seasons.map((s) => s.season),
    });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
