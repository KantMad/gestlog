import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des n° de commande TIO (IS-xxx) référencés par les BL/FAC
// importés. Sert au workflow n8n de backfill : récupérer dans TIO les
// commandes B2B liées aux documents entrepôt, quel que soit leur catalogue.
// Auth x-api-key (route publique côté middleware via /api/sync/).
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const rows = await prisma.$queryRawUnsafe<{ code: string }[]>(
      `SELECT DISTINCT "tioOrderNumber" AS code
       FROM "WarehouseDocument"
       WHERE "tioOrderNumber" IS NOT NULL AND "tioOrderNumber" != ''
       ORDER BY "tioOrderNumber"`
    );

    return NextResponse.json({ codes: rows.map((r) => r.code), count: rows.length });
  } catch (e) {
    return handleApiError(e, "api/sync/bl-order-numbers");
  }
}
