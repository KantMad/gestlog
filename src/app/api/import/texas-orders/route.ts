import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { importTexasClientOrders } from "@/lib/import/mcs-mapper";

// POST — Import des commandes clients TEXAS (ERP). Tague source=TEXAS → devient la
// source de vérité de la saison (les écrans B2B basculent dessus, cf. resolveOrderSource).
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const seasonId = formData.get("seasonId") as string | null;
    if (!file || !seasonId) {
      return NextResponse.json({ error: "Fichier et saison requis" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();

    const log = await prisma.importLog.create({
      data: { seasonId, importType: "CLIENT_ORDER_TEXAS", fileName: file.name, rowCount: 0 },
    });

    let result;
    try {
      result = await importTexasClientOrders(buffer, seasonId, log.id);
    } catch (e) {
      await prisma.importLog.delete({ where: { id: log.id } }).catch(() => {});
      throw e;
    }

    await prisma.importLog.update({
      where: { id: log.id },
      data: {
        rowCount: result.imported,
        errorCount: result.errors.length,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    });

    return NextResponse.json({
      data: { imported: result.imported, errors: result.errors, fileName: file.name },
    });
  } catch (e) {
    return handleApiError(e, "api/import/texas-orders");
  }
}
