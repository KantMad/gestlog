import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// POST — Solder des pièces d'une commande : marquer (réf + couleur + taille) comme
// "ne sera jamais livrée" → annulée, retirée du compte "à livrer". La quantité
// annulée est plafonnée au reste à livrer (commandé − livré). Trace conservée
// (cancelledBySize + qui/quand). Pour solder tout le reste, l'appelant envoie
// toutes les pièces restantes.
// Body : { orderId, items: [{ reference, colorCode, size, quantity }] }
//   quantity = quantité annulée pour cette pièce (0 = dé-annuler).
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const body = await request.json();
    const { orderId, items } = body as {
      orderId?: string;
      items?: { reference: string; colorCode: string; size: string; quantity: number }[];
    };
    if (!orderId || !Array.isArray(items)) {
      return NextResponse.json({ error: "orderId et items requis" }, { status: 400 });
    }

    const ord = await prisma.$queryRawUnsafe<{ orderNumber: string }[]>(
      `SELECT "orderNumber" FROM "ClientOrder" WHERE id = $1 LIMIT 1`,
      orderId
    );
    if (!ord.length) {
      return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
    }
    const orderNumber = ord[0].orderNumber;

    let updated = 0;
    for (const it of items) {
      const ref = String(it.reference || "");
      const color = String(it.colorCode || "");
      const size = String(it.size || "").toUpperCase();
      const qty = Math.max(0, Math.trunc(Number(it.quantity) || 0));
      if (!ref || !size) continue;

      // Ligne de commande correspondante (réf + couleur)
      const rows = await prisma.$queryRawUnsafe<
        { id: string; quantitiesBySize: string; cancelledBySize: string }[]
      >(
        `SELECT col.id, col."quantitiesBySize", col."cancelledBySize"
         FROM "ClientOrderLine" col JOIN "Product" p ON p.id = col."productId"
         WHERE col."clientOrderId" = $1 AND p.reference = $2 AND (p."colorCode" = $3 OR p.color = $3)
         LIMIT 1`,
        orderId,
        ref,
        color
      );
      if (!rows.length) continue;
      const line = rows[0];

      const ordered = safeJson(line.quantitiesBySize);
      const orderedKey = Object.keys(ordered).find((k) => k.toUpperCase() === size);
      const orderedSize = Number((orderedKey ? ordered[orderedKey] : 0) || 0);

      // Déjà livré pour cette pièce (cumul des BL)
      const dRows = await prisma.$queryRawUnsafe<{ q: bigint }[]>(
        `SELECT COALESCE(SUM(l.quantity),0)::bigint AS q
         FROM "WarehouseDocument" d JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
         WHERE d."tioOrderNumber" = $1 AND d."docType" = 'BL'
           AND l.reference = $2 AND l."colorCode" = $3 AND UPPER(l.size) = $4`,
        orderNumber,
        ref,
        color,
        size
      );
      const delivered = Number(dRows[0]?.q || 0);
      const cancellable = Math.max(0, orderedSize - delivered);
      const cancelled = Math.min(qty, cancellable);

      const cbs = safeJson(line.cancelledBySize);
      // nettoie d'éventuelles variantes de casse de la taille
      for (const k of Object.keys(cbs)) if (k.toUpperCase() === size) delete cbs[k];
      if (cancelled > 0) cbs[size] = cancelled;
      const cancelledTotal = Object.values(cbs).reduce((s, v) => s + (Number(v) || 0), 0);

      await prisma.$executeRawUnsafe(
        `UPDATE "ClientOrderLine"
         SET "cancelledBySize" = $1, "cancelledTotal" = $2, "cancelledAt" = NOW(), "cancelledBy" = $3
         WHERE id = $4`,
        JSON.stringify(cbs),
        cancelledTotal,
        session?.id || null,
        line.id
      );
      updated++;
    }

    return NextResponse.json({ success: true, data: { updated } });
  } catch (e) {
    return handleApiError(e, "api/reassort/cancel");
  }
}

function safeJson(s: string): Record<string, number> {
  try {
    const o = JSON.parse(s || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
