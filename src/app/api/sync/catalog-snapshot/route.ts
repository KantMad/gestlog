import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSeasonFromCatalog } from "@/lib/utils";
import { diffCatalogSnapshot, parseColorIds, type ExistingItem } from "@/lib/collections";

export const maxDuration = 60;

// POST — état COMPLET d'un catalogue de vente TIO un jour donné (GESTLOG-13).
// Envoyé par n8n (« GestLog — Relevé catalogues TIO »), UN catalogue par appel :
// { day?: "AAAA-MM-JJ" (défaut : aujourd'hui, Paris),
//   catalog: { id, name, status, deleted, created },
//   products: [{ productId, sku, colors: "100\n81" | number[], deleted }] }
// Met à jour TioCatalog et TioCatalogItem (ajouts / retraits datés). Idempotent le même jour.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  day: z.string().regex(DAY).optional(),
  catalog: z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    status: z.string().nullish(),
    deleted: z.union([z.boolean(), z.number(), z.string()]).nullish(),
    created: z.string().nullish(),
  }),
  products: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        sku: z.string().nullish(),
        colors: z.unknown(),
        deleted: z.union([z.boolean(), z.number(), z.string()]).nullish(),
      })
    )
    .max(5000),
});

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Format invalide" }, { status: 400 });
    const { catalog } = parsed.data;
    const day = parsed.data.day ?? parisToday();
    const products = parsed.data.products.map((p) => ({
      productId: p.productId,
      sku: p.sku ?? null,
      colors: parseColorIds(p.colors),
      deleted: truthy(p.deleted),
    }));

    const known = await prisma.$queryRawUnsafe<{ first: string }[]>(
      `SELECT to_char("firstSnapshotDay", 'YYYY-MM-DD') AS first FROM "TioCatalog" WHERE "tioCatalogId" = $1`,
      catalog.id
    );
    const isFirst = !known.length || known[0].first === day;

    const existing = await prisma.$queryRawUnsafe<ExistingItem[]>(
      `SELECT id, "productId", "colorId", to_char("removedDay", 'YYYY-MM-DD') AS "removedDay", "removedBeforeTracking"
         FROM "TioCatalogItem" WHERE "tioCatalogId" = $1`,
      catalog.id
    );
    // Relevé du 1er jour rejoué : on ne recrée rien, on ne date rien.
    const actions = diffCatalogSnapshot(isFirst && existing.length ? [] : existing, products, day, isFirst).filter(
      (a) => !(isFirst && existing.length && a.kind === "create" && existing.some((e) => e.productId === a.productId && e.colorId === a.colorId))
    );

    const creates = actions.filter((a) => a.kind === "create");
    const seen = actions.filter((a) => a.kind === "seen" || a.kind === "readded");
    const readded = actions.filter((a) => a.kind === "readded").map((a) => a.id);
    const removed = actions.filter((a) => a.kind === "removed").map((a) => a.id);
    const season = parseSeasonFromCatalog(catalog.name)?.canonicalName ?? null;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "TioCatalog" ("tioCatalogId", name, status, deleted, "tioCreatedAt", "seasonName",
                                   "firstSnapshotDay", "lastSnapshotDay", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::timestamp, $6, $7::date, $7::date, NOW(), NOW())
         ON CONFLICT ("tioCatalogId") DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status,
           deleted = EXCLUDED.deleted, "tioCreatedAt" = EXCLUDED."tioCreatedAt", "seasonName" = EXCLUDED."seasonName",
           "lastSnapshotDay" = GREATEST("TioCatalog"."lastSnapshotDay", EXCLUDED."lastSnapshotDay"), "updatedAt" = NOW()`,
        catalog.id,
        catalog.name.trim(),
        catalog.status ?? null,
        truthy(catalog.deleted),
        catalog.created && !Number.isNaN(Date.parse(catalog.created)) ? catalog.created : null,
        season,
        day
      );
      if (creates.length) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "TioCatalogItem" (id, "tioCatalogId", "productId", "colorId", "externalId", reference,
                                         "firstSeenDay", "lastSeenDay", "removedDay", "presentAtStart",
                                         "removedBeforeTracking", "createdAt", "updatedAt")
           SELECT 'tci_' || md5($2::int::text || '_' || r."productId" || '_' || r."colorId"), $2::int, r."productId", r."colorId",
                  r."productId" || '_' || r."colorId", r.reference, $3::date,
                  CASE WHEN r.present THEN $3::date END, r."removedDay"::date, r."presentAtStart",
                  r."removedBeforeTracking", NOW(), NOW()
             FROM jsonb_to_recordset($1::jsonb) AS r("productId" int, "colorId" int, reference text, present boolean,
                  "presentAtStart" boolean, "removedBeforeTracking" boolean, "removedDay" text)
           ON CONFLICT ("tioCatalogId", "productId", "colorId") DO NOTHING`,
          JSON.stringify(creates),
          catalog.id,
          day
        );
      }
      if (seen.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "TioCatalogItem" i SET "lastSeenDay" = $2::date, reference = COALESCE(r.reference, i.reference), "updatedAt" = NOW()
             FROM jsonb_to_recordset($1::jsonb) AS r(id text, reference text) WHERE i.id = r.id`,
          JSON.stringify(seen.map((a) => ({ id: (a as { id: string }).id, reference: (a as { reference: string | null }).reference }))),
          day
        );
      }
      if (readded.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "TioCatalogItem" SET "removedDay" = NULL, "removedBeforeTracking" = false, "updatedAt" = NOW() WHERE id = ANY($1::text[])`,
          readded
        );
      }
      if (removed.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "TioCatalogItem" SET "removedDay" = $2::date, "updatedAt" = NOW() WHERE id = ANY($1::text[])`,
          removed,
          day
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "CatalogSnapshotRun" (day, "createdAt", "updatedAt") VALUES ($1::date, NOW(), NOW())
         ON CONFLICT (day) DO UPDATE SET "updatedAt" = NOW()`,
        day
      );
    });

    return NextResponse.json({
      day,
      catalog: catalog.id,
      season,
      firstSnapshot: isFirst,
      created: creates.length,
      seen: seen.length,
      readded: readded.length,
      removed: removed.length,
    });
  } catch (e) {
    return handleApiError(e, "api/sync/catalog-snapshot");
  }
}
