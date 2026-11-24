// Accès base de l'analyse des tendances B2B (écran Analyse → Tendances, GESTLOG-12).
// Règles : voir lib/trends.ts. Commandes de type COMMANDE (hors VSS), non annulées,
// PLV exclue. Côté Texas : pièces soldées (`cancelledBySize`) déduites.

import { prisma } from "@/lib/prisma";
import { brandOfCatalog, type SeasonCategoryAgg, type TrendLine } from "@/lib/trends";

// Commandes TIO SANS catalogue, NI date, NI montant : trouvées sur AH26 (14 commandes,
// ≈ 10 000 pièces, créées le 23/06/2026 hors synchro n8n, sans jumelle Texas). Elles
// gonfleraient la « perte » de 10 000 pièces à 0 € : on les écarte de la comparaison et on
// les compte à part (`incompleteTio`) pour les signaler à l'écran.
const INCOMPLETE_TIO = `(co."catalogId" IS NULL AND co."orderDate" IS NULL AND co."totalAmount" IS NULL)`;

const SOLDE = `COALESCE((SELECT SUM(v::int) FROM jsonb_each_text(col."cancelledBySize"::jsonb) AS x(k, v) WHERE v ~ '^-?[0-9]+$'), 0)`;

export interface TrendSeason {
  id: string;
  name: string;
  year: number;
  type: string;
  hasFinal: boolean;
}

/** Saisons de collection (PE/AH), la plus récente d'abord, avec présence de commandes Texas. */
export async function trendSeasons(): Promise<TrendSeason[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; year: number; type: string; hasFinal: boolean }[]>(
    `SELECT s.id, s.name, s.year, s.type,
            EXISTS (SELECT 1 FROM "ClientOrder" c WHERE c."seasonId" = s.id AND c.source = 'TEXAS') AS "hasFinal"
       FROM "Season" s
      WHERE s.type IN ('PE', 'AH')
        AND EXISTS (SELECT 1 FROM "ClientOrder" c WHERE c."seasonId" = s.id)
      ORDER BY s.year DESC, s.type DESC`
  );
  return rows;
}

/** Lignes précommande (TIO) et finale (Texas jumelée) d'une saison, agrégées par produit × coloris. */
export async function trendLines(seasonId: string): Promise<TrendLine[]> {
  const rows = await prisma.$queryRawUnsafe<
    {
      side: "pre" | "final";
      paired: boolean;
      catalog: string | null;
      category: string | null;
      subCategory: string | null;
      reference: string;
      label: string | null;
      color: string | null;
      qty: bigint;
      amount: number;
    }[]
  >(
    `WITH tio AS (
       SELECT co.id, co."orderNumber", cat.name AS catalog
         FROM "ClientOrder" co
         LEFT JOIN "Catalog" cat ON cat.id = co."catalogId"
        WHERE co."seasonId" = $1 AND co.source = 'TIO' AND co."orderType" = 'COMMANDE' AND co.status <> 'ANNULEE'
          AND NOT ${INCOMPLETE_TIO}
     ),
     tex AS (
       SELECT co.id, t.catalog
         FROM "ClientOrder" co
         JOIN tio t ON t."orderNumber" = co."tioOrderNumber"
        WHERE co."seasonId" = $1 AND co.source = 'TEXAS' AND co."orderType" = 'COMMANDE' AND co.status <> 'ANNULEE'
     ),
     paired AS (
       SELECT DISTINCT t.id FROM tio t
        WHERE EXISTS (SELECT 1 FROM "ClientOrder" x
                       WHERE x."seasonId" = $1 AND x.source = 'TEXAS' AND x."tioOrderNumber" = t."orderNumber")
     )
     SELECT 'pre' AS side, (t.id IN (SELECT id FROM paired)) AS paired, t.catalog,
            p.category, p."subCategory", p.reference, COALESCE(NULLIF(p.label, ''), p.reference) AS label,
            COALESCE(NULLIF(p."colorLabel", ''), p.color) AS color,
            SUM(col."totalQuantity")::bigint AS qty, COALESCE(SUM(col.amount), 0)::float8 AS amount
       FROM tio t
       JOIN "ClientOrderLine" col ON col."clientOrderId" = t.id
       JOIN "Product" p ON p.id = col."productId"
      WHERE p.category IS DISTINCT FROM 'PLV'
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
     UNION ALL
     SELECT 'final', true, x.catalog,
            p.category, p."subCategory", p.reference, COALESCE(NULLIF(p.label, ''), p.reference),
            COALESCE(NULLIF(p."colorLabel", ''), p.color),
            SUM(col."totalQuantity" - ${SOLDE})::bigint,
            COALESCE(SUM(col.amount * (col."totalQuantity" - ${SOLDE}) / NULLIF(col."totalQuantity", 0)), 0)::float8
       FROM tex x
       JOIN "ClientOrderLine" col ON col."clientOrderId" = x.id
       JOIN "Product" p ON p.id = col."productId"
      WHERE p.category IS DISTINCT FROM 'PLV'
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
    seasonId
  );
  return rows.map((r) => ({
    side: r.side,
    paired: r.paired,
    brand: brandOfCatalog(r.catalog),
    category: r.category || "Sans catégorie",
    subCategory: r.subCategory || "Sans sous-catégorie",
    reference: r.reference,
    label: r.label || r.reference,
    color: r.color || "?",
    qty: Number(r.qty),
    amount: Number(r.amount),
  }));
}

/** Commandes Texas de la saison SANS jumelle TIO (réassorts `IS-…` surtout) : hors comparaison. */
export async function unpairedFinal(seasonId: string): Promise<{ orders: number; qty: number; amount: number }> {
  const r = await prisma.$queryRawUnsafe<{ orders: bigint; qty: bigint | null; amount: number | null }[]>(
    `SELECT COUNT(DISTINCT co.id) AS orders, SUM(col."totalQuantity")::bigint AS qty, SUM(col.amount)::float8 AS amount
       FROM "ClientOrder" co
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
      WHERE co."seasonId" = $1 AND co.source = 'TEXAS'
        AND NOT EXISTS (SELECT 1 FROM "ClientOrder" t
                         WHERE t."seasonId" = $1 AND t.source = 'TIO' AND t."orderNumber" = co."tioOrderNumber")`,
    seasonId
  );
  return { orders: Number(r[0]?.orders ?? 0), qty: Number(r[0]?.qty ?? 0), amount: Math.round(Number(r[0]?.amount ?? 0)) };
}

/** Précommandes (TIO) par saison de collection × marque × catégorie, pour l'évolution. */
export async function seasonCategoryAggs(): Promise<SeasonCategoryAgg[]> {
  const rows = await prisma.$queryRawUnsafe<
    { season: string; seasonYear: number; seasonType: string; catalog: string | null; category: string | null; qty: bigint; amount: number }[]
  >(
    `SELECT s.name AS season, s.year AS "seasonYear", s.type AS "seasonType", cat.name AS catalog, p.category,
            SUM(col."totalQuantity")::bigint AS qty, COALESCE(SUM(col.amount), 0)::float8 AS amount
       FROM "ClientOrder" co
       JOIN "Season" s ON s.id = co."seasonId"
       LEFT JOIN "Catalog" cat ON cat.id = co."catalogId"
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
       JOIN "Product" p ON p.id = col."productId"
      WHERE s.type IN ('PE', 'AH') AND co.source = 'TIO' AND co."orderType" = 'COMMANDE' AND co.status <> 'ANNULEE'
        AND p.category IS DISTINCT FROM 'PLV' AND NOT ${INCOMPLETE_TIO}
      GROUP BY 1, 2, 3, 4, 5`
  );
  return rows.map((r) => ({
    season: r.season,
    seasonYear: r.seasonYear,
    seasonType: r.seasonType,
    brand: brandOfCatalog(r.catalog),
    category: r.category || "Sans catégorie",
    qty: Number(r.qty),
    amount: Number(r.amount),
  }));
}

/** Commandes TIO incomplètes (sans catalogue, date ni montant) écartées de la comparaison. */
export async function incompleteTio(seasonId: string): Promise<{ orders: number; qty: number }> {
  const r = await prisma.$queryRawUnsafe<{ orders: bigint; qty: bigint | null }[]>(
    `SELECT COUNT(DISTINCT co.id) AS orders, SUM(col."totalQuantity")::bigint AS qty
       FROM "ClientOrder" co
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
      WHERE co."seasonId" = $1 AND co.source = 'TIO' AND co."orderType" = 'COMMANDE' AND co.status <> 'ANNULEE'
        AND ${INCOMPLETE_TIO}`,
    seasonId
  );
  return { orders: Number(r[0]?.orders ?? 0), qty: Number(r[0]?.qty ?? 0) };
}
