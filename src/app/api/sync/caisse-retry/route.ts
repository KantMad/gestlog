import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { sendDeliveryToCaisse } from "@/lib/caisse/delivery-sync";

// POST — Réessaie l'envoi caisse des livraisons en échec (caisseSyncStatus=FAILED).
// Idempotent (la caisse dédoublonne par deliveryId). Appelé par un cron.
// Auth : header x-api-key = SYNC_API_KEY.
export async function POST(request: NextRequest) {
  if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const failed = await prisma.delivery.findMany({
      where: { caisseSyncStatus: "FAILED" },
      select: { id: true },
      take: 200,
    });

    let sent = 0, already = 0, stillFailed = 0;
    for (const d of failed) {
      const r = await sendDeliveryToCaisse(d.id);
      if (r.status === "SENT") sent++;
      else if (r.status === "ALREADY") already++;
      else if (r.status === "FAILED") stillFailed++;
    }

    return NextResponse.json({ data: { retried: failed.length, sent, already, stillFailed } });
  } catch (e) {
    return handleApiError(e, "api/deliveries/caisse-retry");
  }
}
