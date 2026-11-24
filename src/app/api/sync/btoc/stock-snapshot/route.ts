import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { describeVariation, isOutOfStock, snapshotAction, type SnapshotVariation } from "@/lib/stock-outs";

export const maxDuration = 60;

// POST — photo quotidienne du stock BtoC, VARIATION par variation (GESTLOG-14).
// Envoyé par n8n (« GestLog — Photo stock BtoC »), par lots, depuis l'API WooCommerce
// /products/{id}/variations. Body : { day?: "AAAA-MM-JJ" (défaut : aujourd'hui, Paris),
// variations: [{ id, parent_id, sku, name, stock_quantity, stock_status, manage_stock, attributes }] }
// Tient à jour les PÉRIODES de rupture (BtocStockOut) : ouverture, prolongation, clôture.
// Idempotent : renvoyer le même lot le même jour ne change rien.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  day: z.string().regex(DAY).optional(),
  variations: z.array(z.object({ id: z.coerce.number().int().positive() }).passthrough()).max(5000),
});

const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Format invalide" }, { status: 400 });
    const day = parsed.data.day ?? parisToday();

    // Une variation envoyée deux fois dans le lot : la dernière l'emporte.
    const byId = new Map<number, SnapshotVariation>();
    for (const v of parsed.data.variations as unknown as SnapshotVariation[]) byId.set(Number(v.id), { ...v, id: Number(v.id) });
    const ids = [...byId.keys()];

    const open = await prisma.$queryRawUnsafe<{ id: string; variationWooId: number; lastSeenDay: string }[]>(
      `SELECT DISTINCT ON ("variationWooId") id, "variationWooId", to_char("lastSeenDay", 'YYYY-MM-DD') AS "lastSeenDay"
         FROM "BtocStockOut"
        WHERE "endDay" IS NULL AND "variationWooId" = ANY($1::int[])
        ORDER BY "variationWooId", "startDay" DESC`,
      ids
    );
    const openBy = new Map(open.map((o) => [o.variationWooId, o]));

    const toOpen: Record<string, unknown>[] = [];
    const toExtend: string[] = [];
    const toClose: string[] = [];
    let outCount = 0;
    for (const v of byId.values()) {
      const out = isOutOfStock(v);
      if (out) outCount++;
      const action = snapshotAction(out, openBy.get(v.id) ?? null, day);
      if (action.kind === "open") {
        const d = describeVariation(v);
        toOpen.push({
          variationWooId: v.id,
          parentWooId: v.parent_id ? Number(v.parent_id) : null,
          sku: v.sku || null,
          ...d,
          productName: String(v.name ?? "").trim() || v.sku || `Variation ${v.id}`,
        });
      } else if (action.kind === "extend") toExtend.push(action.id);
      else if (action.kind === "close") toClose.push(action.id);
    }

    await prisma.$transaction(async (tx) => {
      if (toOpen.length) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "BtocStockOut" (id, "variationWooId", "parentWooId", sku, reference, "colorCode", color, size,
                                       "productName", "startDay", "lastSeenDay", "createdAt", "updatedAt")
           SELECT 'so_' || md5(r."variationWooId"::text || $2 || random()::text), r."variationWooId", r."parentWooId",
                  r.sku, r.reference, r."colorCode", r.color, r.size, r."productName", $2::date, $2::date, NOW(), NOW()
             FROM jsonb_to_recordset($1::jsonb) AS r("variationWooId" int, "parentWooId" int, sku text, reference text,
                  "colorCode" text, color text, size text, "productName" text)`,
          JSON.stringify(toOpen),
          day
        );
      }
      if (toExtend.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "BtocStockOut" SET "lastSeenDay" = $2::date, "updatedAt" = NOW() WHERE id = ANY($1::text[])`,
          toExtend,
          day
        );
      }
      if (toClose.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "BtocStockOut" SET "endDay" = $2::date, "updatedAt" = NOW() WHERE id = ANY($1::text[])`,
          toClose,
          day
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "BtocStockSnapshotRun" (day, "createdAt", "updatedAt") VALUES ($1::date, NOW(), NOW())
         ON CONFLICT (day) DO UPDATE SET "updatedAt" = NOW()`,
        day
      );
    });

    return NextResponse.json({
      day,
      received: ids.length,
      outOfStock: outCount,
      opened: toOpen.length,
      extended: toExtend.length,
      closed: toClose.length,
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/stock-snapshot");
  }
}
