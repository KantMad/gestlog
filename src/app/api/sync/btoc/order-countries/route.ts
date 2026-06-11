import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

// POST — Backfill léger du pays de facturation des commandes BtoC.
// Body : { orders: [{ wooId, country }] } (ou tableau direct).
// Met à jour BtocOrder.billingCountry sans retoucher les lignes (contrairement à
// la sync complète). Sert au backfill ponctuel des commandes invités historiques
// dont le pays n'existe que côté WooCommerce.
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const list: { wooId: number; country: string }[] = Array.isArray(body)
      ? body
      : body.orders || [];

    // Garde les entrées valides, dédoublonne par wooId.
    const byWoo = new Map<number, string>();
    for (const o of list) {
      const wooId = Number(o.wooId);
      const country = String(o.country || "").trim().toUpperCase();
      if (Number.isFinite(wooId) && country) byWoo.set(wooId, country);
    }
    const rows = [...byWoo.entries()];

    const CHUNK = 500;
    let updated = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const flat: unknown[] = [];
      const values = slice.map(([wooId, country]) => {
        flat.push(wooId, country);
        return `($${flat.length - 1}::int, $${flat.length})`;
      });
      const res = await prisma.$executeRawUnsafe(
        `UPDATE "BtocOrder" o SET "billingCountry" = v.country, "updatedAt" = NOW()
         FROM (VALUES ${values.join(",")}) AS v(woo_id, country)
         WHERE o."wooId" = v.woo_id`,
        ...flat
      );
      updated += res;
    }

    return NextResponse.json({
      success: true,
      data: { received: list.length, updated },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/order-countries");
  }
}
