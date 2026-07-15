import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des imports récents (supprimables) d'une saison, du plus récent au plus
// ancien. `liveCount` = nombre d'entités encore taguées par cet import (0 = déjà
// remplacé par un ré-import, ou import antérieur au suivi). Sert à l'écran d'import.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    const where = seasonId ? { seasonId } : {};
    const logs = await prisma.importLog.findMany({
      where,
      orderBy: { importedAt: "desc" },
      take: 40,
    });
    const ids = logs.map((l) => l.id);

    // Comptage « vivant » des entités taguées, par type, en une requête chacune.
    const [recs, sos, cos, stks] = await Promise.all([
      prisma.supplierReception.groupBy({ by: ["importLogId"], where: { importLogId: { in: ids } }, _count: true }),
      prisma.supplierOrder.groupBy({ by: ["importLogId"], where: { importLogId: { in: ids } }, _count: true }),
      prisma.clientOrder.groupBy({ by: ["importLogId"], where: { importLogId: { in: ids } }, _count: true }),
      prisma.stockEntry.groupBy({ by: ["importLogId"], where: { importLogId: { in: ids } }, _count: true }),
    ]);
    const mapOf = (rows: { importLogId: string | null; _count: number }[]) =>
      new Map(rows.map((r) => [r.importLogId, r._count]));
    const byType: Record<string, Map<string | null, number>> = {
      RECEPTION: mapOf(recs),
      SUPPLIER_ORDER: mapOf(sos),
      CLIENT_ORDER: mapOf(cos),
      STOCK: mapOf(stks),
    };

    const data = logs.map((l) => ({
      id: l.id,
      importType: l.importType,
      fileName: l.fileName,
      rowCount: l.rowCount,
      errorCount: l.errorCount,
      importedAt: l.importedAt,
      liveCount: byType[l.importType]?.get(l.id) ?? 0,
      deletable: ["RECEPTION", "SUPPLIER_ORDER", "CLIENT_ORDER", "STOCK"].includes(l.importType),
    }));

    return NextResponse.json({ data });
  } catch (e) {
    return handleApiError(e, "api/import/logs");
  }
}
