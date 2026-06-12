import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Détail réconciliation d'une commande : commandé vs livré par
// (référence, couleur, taille). Clé de matching : reference + colorCode + size.
export async function GET(request: NextRequest) {
  try {
    const orderId = request.nextUrl.searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "orderId requis" }, { status: 400 });
    }

    const order = await prisma.$queryRawUnsafe<{ orderNumber: string }[]>(
      `SELECT "orderNumber" FROM "ClientOrder" WHERE id = $1 LIMIT 1`,
      orderId
    );
    if (order.length === 0) {
      return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
    }
    const orderNumber = order[0].orderNumber;

    // Commandé : lignes avec quantitiesBySize JSON → expansion (ref|color|size)
    const orderedLines = await prisma.$queryRawUnsafe<
      { reference: string; colorCode: string | null; color: string | null; quantitiesBySize: string; cancelledBySize: string }[]
    >(
      `SELECT p.reference, p."colorCode", p.color, col."quantitiesBySize", col."cancelledBySize"
       FROM "ClientOrderLine" col JOIN "Product" p ON p.id = col."productId"
       WHERE col."clientOrderId" = $1`,
      orderId
    );

    // Livré : agrégé par (ref, colorCode, size)
    const deliveredLines = await prisma.$queryRawUnsafe<
      { reference: string | null; colorCode: string | null; colorLabel: string | null; size: string | null; q: bigint }[]
    >(
      `SELECT l.reference, l."colorCode", MAX(l."colorLabel") AS "colorLabel", UPPER(l.size) AS size, SUM(l.quantity)::bigint AS q
       FROM "WarehouseDocument" d JOIN "WarehouseDocumentLine" l ON l."documentId" = d.id
       WHERE d."tioOrderNumber" = $1 AND d."docType" = 'BL'
       GROUP BY l.reference, l."colorCode", UPPER(l.size)`,
      orderNumber
    );

    type Row = {
      reference: string;
      color: string;
      colorLabel: string;
      size: string;
      ordered: number;
      cancelled: number;
      delivered: number;
    };
    const map = new Map<string, Row>();
    const key = (ref: string, color: string, size: string) =>
      `${ref}|||${(color || "").toUpperCase()}|||${(size || "").toUpperCase()}`;
    const parse = (s: string): Record<string, number> => {
      try {
        const o = JSON.parse(s || "{}");
        return o && typeof o === "object" ? o : {};
      } catch {
        return {};
      }
    };

    for (const ol of orderedLines) {
      const color = ol.colorCode || ol.color || "";
      const q = parse(ol.quantitiesBySize);
      const cancelled = parse(ol.cancelledBySize);
      for (const [size, qty] of Object.entries(q)) {
        const k = key(ol.reference, color, size);
        if (!map.has(k))
          map.set(k, { reference: ol.reference, color, colorLabel: "", size: size.toUpperCase(), ordered: 0, cancelled: 0, delivered: 0 });
        map.get(k)!.ordered += Number(qty) || 0;
      }
      for (const [size, qty] of Object.entries(cancelled)) {
        const k = key(ol.reference, color, size);
        if (!map.has(k))
          map.set(k, { reference: ol.reference, color, colorLabel: "", size: size.toUpperCase(), ordered: 0, cancelled: 0, delivered: 0 });
        map.get(k)!.cancelled += Number(qty) || 0;
      }
    }
    for (const dl of deliveredLines) {
      const ref = dl.reference || "";
      const color = dl.colorCode || "";
      const size = dl.size || "";
      const k = key(ref, color, size);
      if (!map.has(k))
        map.set(k, { reference: ref, color, colorLabel: dl.colorLabel || "", size, ordered: 0, cancelled: 0, delivered: 0 });
      const row = map.get(k)!;
      row.delivered += Number(dl.q) || 0;
      if (!row.colorLabel && dl.colorLabel) row.colorLabel = dl.colorLabel;
    }

    const lines = Array.from(map.values())
      // reste à livrer = commandé − annulé − livré
      .map((r) => ({ ...r, missing: Math.max(0, r.ordered - r.cancelled - r.delivered) }))
      .sort(
        (a, b) =>
          a.reference.localeCompare(b.reference) ||
          a.color.localeCompare(b.color) ||
          a.size.localeCompare(b.size)
      );

    return NextResponse.json({ orderNumber, lines });
  } catch (e) {
    return handleApiError(e, "api/reassort/lines");
  }
}
