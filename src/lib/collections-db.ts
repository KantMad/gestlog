// Accès base du suivi des collections (écran Analyse → Suivi des collections, GESTLOG-13).

import { prisma } from "@/lib/prisma";
import type { CollectionItemRow } from "@/lib/collections";

export interface CatalogInfo {
  tioCatalogId: number;
  name: string;
  status: string | null;
  deleted: boolean;
  seasonName: string | null;
  firstSnapshotDay: string;
  items: number;
}

export async function tioCatalogs(): Promise<CatalogInfo[]> {
  const rows = await prisma.$queryRawUnsafe<(Omit<CatalogInfo, "items"> & { items: bigint })[]>(
    `SELECT c."tioCatalogId", c.name, c.status, c.deleted, c."seasonName",
            to_char(c."firstSnapshotDay", 'YYYY-MM-DD') AS "firstSnapshotDay",
            (SELECT COUNT(*) FROM "TioCatalogItem" i WHERE i."tioCatalogId" = c."tioCatalogId") AS items
       FROM "TioCatalog" c
      ORDER BY c."seasonName" DESC NULLS LAST, c.name`
  );
  return rows.map((r) => ({ ...r, items: Number(r.items) }));
}

/** Produits × coloris des catalogues donnés, avec leur famille (catégorie GestLog via Product.externalId). */
export async function collectionItems(
  catalogIds: number[],
  family: "category" | "subCategory"
): Promise<(CollectionItemRow & { label: string | null; color: string | null })[]> {
  if (!catalogIds.length) return [];
  const famCol = family === "subCategory" ? `COALESCE(p."subCategory", p.category)` : `p.category`;
  const rows = await prisma.$queryRawUnsafe<
    {
      tioCatalogId: number;
      productId: number;
      externalId: string;
      reference: string | null;
      category: string | null;
      label: string | null;
      color: string | null;
      removed: boolean;
      removedDay: string | null;
      addedDuringTracking: boolean;
    }[]
  >(
    `SELECT i."tioCatalogId", i."productId", i."externalId", COALESCE(p.reference, i.reference) AS reference,
            ${famCol} AS category, p.label, COALESCE(NULLIF(p."colorLabel", ''), p.color) AS color,
            (i."removedDay" IS NOT NULL OR i."removedBeforeTracking") AS removed,
            to_char(i."removedDay", 'YYYY-MM-DD') AS "removedDay",
            (NOT i."presentAtStart" AND i."firstSeenDay" > c."firstSnapshotDay" AND i."lastSeenDay" IS NOT NULL) AS "addedDuringTracking"
       FROM "TioCatalogItem" i
       JOIN "TioCatalog" c ON c."tioCatalogId" = i."tioCatalogId"
       LEFT JOIN "Product" p ON p."externalId" = i."externalId"
      WHERE i."tioCatalogId" = ANY($1::int[])`,
    catalogIds
  );
  return rows.map((r) => ({ ...r, category: r.category || "Sans catégorie" }));
}

/** Coloris (Product.externalId) commandés par les clients sur la saison : source active (Texas sinon TIO), hors PLV. */
export async function clientOrderedIds(seasonName: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ ext: string }[]>(
    `SELECT DISTINCT p."externalId" AS ext
       FROM "ClientOrder" co
       JOIN "Season" s ON s.id = co."seasonId"
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
       JOIN "Product" p ON p.id = col."productId"
      WHERE s.name = $1 AND co.status <> 'ANNULEE' AND col."totalQuantity" > 0 AND p."externalId" IS NOT NULL
        AND co.source = (CASE WHEN EXISTS (SELECT 1 FROM "ClientOrder" c2 WHERE c2."seasonId" = co."seasonId" AND c2.source = 'TEXAS')
                              THEN 'TEXAS' ELSE 'TIO' END)`,
    seasonName
  );
  return new Set(rows.map((r) => r.ext));
}

/** Coloris commandés à l'usine (commandes fournisseurs) sur la saison, et s'il en existe. */
export async function factoryOrderedIds(seasonName: string): Promise<{ ids: Set<string>; hasFactory: boolean }> {
  const rows = await prisma.$queryRawUnsafe<{ ext: string | null }[]>(
    `SELECT DISTINCT p."externalId" AS ext
       FROM "SupplierOrder" so
       JOIN "Season" s ON s.id = so."seasonId"
       JOIN "SupplierOrderLine" l ON l."supplierOrderId" = so.id
       JOIN "Product" p ON p.id = l."productId"
      WHERE s.name = $1 AND l."totalQuantity" > 0`,
    seasonName
  );
  return { ids: new Set(rows.map((r) => r.ext).filter((x): x is string => !!x)), hasFactory: rows.length > 0 };
}

export async function catalogSnapshotSpan(): Promise<{ first: string | null; last: string | null }> {
  const r = await prisma.$queryRawUnsafe<{ first: string | null; last: string | null }[]>(
    `SELECT to_char(MIN(day), 'YYYY-MM-DD') AS first, to_char(MAX(day), 'YYYY-MM-DD') AS last FROM "CatalogSnapshotRun"`
  );
  return r[0] ?? { first: null, last: null };
}
