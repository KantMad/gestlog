import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

function genId() {
  return `brl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

interface RefundLine {
  refundId: number;
  lineId: number;
  sku?: string | null;
  name?: string | null;
  quantity?: number;
  total?: number;
}
interface OrderRefunds {
  orderWooId: number;
  totalRefunded?: number;
  lines?: RefundLine[];
}

// POST — Lignes de remboursement WooCommerce (depuis /orders/{id}/refunds).
// Body : { orders: [{ orderWooId, totalRefunded, lines:[{refundId,lineId,sku,name,quantity,total}] }] }
// Pour chaque commande : remplace ses lignes de remboursement (gère les
// annulations de remboursement) et met à jour BtocOrder.totalRefunded.
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const orders: OrderRefunds[] = Array.isArray(body) ? body : body.orders || [];

    let ordersProcessed = 0;
    let linesInserted = 0;

    for (const o of orders) {
      const wooId = Number(o.orderWooId);
      if (!Number.isFinite(wooId)) continue;

      // Remplace les lignes de remboursement de la commande (idempotent).
      await prisma.$executeRawUnsafe(
        `DELETE FROM "BtocRefundLine" WHERE "orderWooId" = $1`,
        wooId
      );

      const lines = (o.lines || []).filter((l) => Number.isFinite(Number(l.refundId)) && Number.isFinite(Number(l.lineId)));
      if (lines.length > 0) {
        const flat: unknown[] = [];
        const tuples = lines.map((l) => {
          const vals = [
            genId(),
            wooId,
            Number(l.refundId),
            Number(l.lineId),
            l.sku || null,
            l.name || null,
            Math.abs(Math.trunc(Number(l.quantity) || 0)),
            Math.abs(Number(l.total) || 0),
          ];
          const ph = vals.map((v) => {
            flat.push(v);
            return `$${flat.length}`;
          });
          return `(${ph.join(",")}, NOW())`;
        });
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BtocRefundLine"
             (id, "orderWooId", "refundId", "lineId", sku, name, quantity, total, "createdAt")
           VALUES ${tuples.join(",")}
           ON CONFLICT ("refundId", "lineId") DO NOTHING`,
          ...flat
        );
        linesInserted += lines.length;
      }

      // Montant total remboursé (inclut port/frais) : fourni par le workflow,
      // sinon somme des lignes.
      const totalRefunded =
        o.totalRefunded != null
          ? Math.abs(Number(o.totalRefunded) || 0)
          : lines.reduce((s, l) => s + Math.abs(Number(l.total) || 0), 0);
      await prisma.$executeRawUnsafe(
        `UPDATE "BtocOrder" SET "totalRefunded" = $1, "updatedAt" = NOW() WHERE "wooId" = $2`,
        totalRefunded,
        wooId
      );
      ordersProcessed++;
    }

    return NextResponse.json({
      success: true,
      data: { ordersProcessed, linesInserted },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/refunds");
  }
}
