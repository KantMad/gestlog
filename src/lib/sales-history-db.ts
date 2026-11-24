// Accès base de l'historique des ventes (écran Analyse → Historique des ventes, canal BtoC).
// Réunit DEUX sources sans recouvrement :
//   - SalesHistoryLine : lignes importées des exports WooCommerce, AVANT la synchro live ;
//   - BtocOrderLine    : ventes synchronisées en direct (à partir de la 1re BtocOrder),
//                        hors commandes annulées / remboursées / échouées, remboursements
//                        partiels déduits (même règle que /api/btoc/size-distribution).
// La frontière est le jour (heure de Paris) de la 1re commande live : l'historique n'est lu
// qu'avant, la base live qu'à partir de ce jour.

import { prisma } from "@/lib/prisma";
import { parisDayExpr } from "@/lib/btoc-dates";

/** Jour (AAAA-MM-JJ, Paris) de la première commande synchronisée en direct, ou null. */
export async function liveStartDay(): Promise<string | null> {
  const r = await prisma.$queryRawUnsafe<{ d: string | null }[]>(
    `SELECT to_char(MIN(${parisDayExpr('"orderDate"')}), 'YYYY-MM-DD') AS d FROM "BtocOrder"`
  );
  return r[0]?.d ?? null;
}

/** Code couleur (ex. « 740 ») → libellé (« Bleu denim »). Ventes live d'abord, puis référentiel produit. */
export async function colorLabels(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRawUnsafe<{ code: string; label: string; prio: number }[]>(
    `SELECT code, label, 0 AS prio FROM (
       SELECT SPLIT_PART(sku, '-', 2) AS code, color AS label,
              ROW_NUMBER() OVER (PARTITION BY SPLIT_PART(sku, '-', 2) ORDER BY COUNT(*) DESC) AS rk
         FROM "BtocOrderLine"
        WHERE sku LIKE '%-%-%' AND color IS NOT NULL AND color != ''
        GROUP BY 1, 2) t
      WHERE rk = 1
     UNION ALL
     SELECT "colorCode", MAX("colorLabel"), 1 FROM "Product"
      WHERE "colorCode" IS NOT NULL AND "colorLabel" IS NOT NULL AND "colorLabel" != ''
      GROUP BY 1`
  );
  const pretty = (s: string) => {
    const t = s.replace(/[-_]+/g, " ").trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const map = new Map<string, string>();
  for (const r of rows.sort((a, b) => a.prio - b.prio)) {
    const k = String(r.code).padStart(3, "0");
    if (!map.has(k)) map.set(k, pretty(r.label));
  }
  return map;
}

export interface RawAgg {
  year: number;
  reference: string | null;
  productName: string;
  colorCode: string | null;
  size: string | null;
  qty: number;
  amount: number;
}

/** Ventes agrégées par année × référence × produit × code couleur × taille, sur [from, to] (jours inclus, optionnels). */
export async function salesAggregates(cutoff: string | null, from: string | null, to: string | null): Promise<RawAgg[]> {
  const day = parisDayExpr('o."orderDate"');
  const rows = await prisma.$queryRawUnsafe<
    { year: number; reference: string | null; productName: string; colorCode: string | null; size: string | null; qty: bigint; amount: number }[]
  >(
    `WITH lines AS (
       SELECT EXTRACT(YEAR FROM h."orderDay")::int AS year, h.reference, h."productName", h."colorCode", h.size,
              h.quantity AS qty, h."lineTotal" AS amount
         FROM "SalesHistoryLine" h
        WHERE h.channel = 'BTOC'
          AND ($1::date IS NULL OR h."orderDay" < $1::date)
          AND ($2::date IS NULL OR h."orderDay" >= $2::date)
          AND ($3::date IS NULL OR h."orderDay" <= $3::date)
       UNION ALL
       SELECT EXTRACT(YEAR FROM ${day})::int, NULLIF(SPLIT_PART(ol.sku, '-', 1), ''), ol.name,
              NULLIF(SPLIT_PART(ol.sku, '-', 2), ''),
              COALESCE(NULLIF(UPPER(ol.size), ''), NULLIF(UPPER(SPLIT_PART(ol.sku, '-', 3)), '')),
              ol.quantity, ol.total
         FROM "BtocOrderLine" ol
         JOIN "BtocOrder" o ON o.id = ol."orderId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND ($2::date IS NULL OR ${day}::date >= $2::date)
          AND ($3::date IS NULL OR ${day}::date <= $3::date)
       UNION ALL
       SELECT EXTRACT(YEAR FROM ${day})::int, NULLIF(SPLIT_PART(rl.sku, '-', 1), ''), COALESCE(ol.name, rl.name, ''),
              NULLIF(SPLIT_PART(rl.sku, '-', 2), ''),
              NULLIF(UPPER(SPLIT_PART(rl.sku, '-', 3)), ''),
              -rl.quantity, -rl.total
         FROM "BtocRefundLine" rl
         JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
         LEFT JOIN LATERAL (
           SELECT l.name FROM "BtocOrderLine" l WHERE l."orderId" = o.id AND l.sku = rl.sku LIMIT 1
         ) ol ON true
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND rl.sku IS NOT NULL AND rl.sku != ''
          AND ($2::date IS NULL OR ${day}::date >= $2::date)
          AND ($3::date IS NULL OR ${day}::date <= $3::date)
     )
     SELECT year, reference, "productName", "colorCode", size, SUM(qty)::bigint AS qty, SUM(amount)::float8 AS amount
       FROM lines
      WHERE "productName" != ''
      GROUP BY 1, 2, 3, 4, 5
     HAVING SUM(qty) != 0`,
    cutoff,
    from,
    to
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), amount: Number(r.amount) }));
}

/** Pièces vendues par mois et par source, pour repérer les trous de l'historique. */
export async function monthlyCoverage(cutoff: string | null): Promise<{ month: string; history: number; live: number }[]> {
  const day = parisDayExpr('o."orderDate"');
  const rows = await prisma.$queryRawUnsafe<{ month: string; history: bigint; live: bigint }[]>(
    `WITH m AS (
       SELECT to_char("orderDay", 'YYYY-MM') AS month, SUM(quantity) AS history, 0::bigint AS live
         FROM "SalesHistoryLine"
        WHERE channel = 'BTOC' AND ($1::date IS NULL OR "orderDay" < $1::date)
        GROUP BY 1
       UNION ALL
       SELECT to_char(${day}, 'YYYY-MM'), 0, SUM(ol.quantity)
         FROM "BtocOrderLine" ol JOIN "BtocOrder" o ON o.id = ol."orderId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
        GROUP BY 1
     )
     SELECT month, SUM(history)::bigint AS history, SUM(live)::bigint AS live FROM m GROUP BY 1 ORDER BY 1`,
    cutoff
  );
  return rows.map((r) => ({ month: r.month, history: Number(r.history), live: Number(r.live) }));
}

// ─── B2B ────────────────────────────────────────────────────────────────

export type B2bScope = "all" | "collection" | "reassort";

export interface RawB2bAgg {
  seasonName: string;
  seasonYear: number;
  seasonType: string;
  orderYear: number | null;
  reference: string | null;
  productName: string;
  colorCode: string | null;
  colorLabel: string | null;
  size: string;
  qty: number;
  amount: number;
}

/**
 * Commandes clients B2B agrégées par saison × année de commande × produit × couleur × taille.
 * Règles (mêmes que les écrans B2B) :
 *  - UNE source par saison : TEXAS dès qu'il en existe, sinon TIO (pas de double comptage) ;
 *  - PLV exclue (pas du produit vendu) ; commandes ANNULEE exclues ;
 *  - pièces soldées (`cancelledBySize`, jamais livrées) déduites, taille par taille ;
 *  - CA = CA net de la ligne au prorata des pièces retenues.
 * scope : collection = saisons PE/AH ; reassort = saisons Réassort / Hors-saison.
 */
export async function b2bAggregates(scope: B2bScope): Promise<RawB2bAgg[]> {
  const scopeCond =
    scope === "collection"
      ? `AND s.type IN ('PE', 'AH')`
      : scope === "reassort"
        ? `AND s.type NOT IN ('PE', 'AH')`
        : "";
  const rows = await prisma.$queryRawUnsafe<
    (Omit<RawB2bAgg, "qty" | "amount"> & { qty: bigint; amount: number })[]
  >(
    `SELECT s.name AS "seasonName", s.year AS "seasonYear", s.type AS "seasonType",
            EXTRACT(YEAR FROM co."orderDate")::int AS "orderYear",
            p.reference, COALESCE(NULLIF(p.label, ''), p.reference) AS "productName",
            NULLIF(COALESCE(NULLIF(p."colorCode", ''), p.color), '') AS "colorCode",
            NULLIF(p."colorLabel", '') AS "colorLabel",
            UPPER(q.key) AS size,
            SUM(q.value::int - COALESCE((col."cancelledBySize"::jsonb ->> q.key)::int, 0))::bigint AS qty,
            COALESCE(SUM(col.amount * (q.value::int - COALESCE((col."cancelledBySize"::jsonb ->> q.key)::int, 0))
                         / NULLIF(col."totalQuantity", 0)), 0)::float8 AS amount
       FROM "ClientOrder" co
       JOIN "Season" s ON s.id = co."seasonId"
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
       JOIN "Product" p ON p.id = col."productId"
       CROSS JOIN LATERAL jsonb_each_text(col."quantitiesBySize"::jsonb) q
      WHERE co.status <> 'ANNULEE'
        AND p.category IS DISTINCT FROM 'PLV'
        AND co."source" = (CASE WHEN EXISTS (
              SELECT 1 FROM "ClientOrder" c2 WHERE c2."seasonId" = co."seasonId" AND c2."source" = 'TEXAS'
            ) THEN 'TEXAS' ELSE 'TIO' END)
        AND q.value ~ '^-?[0-9]+$'
        ${scopeCond}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
     HAVING SUM(q.value::int - COALESCE((col."cancelledBySize"::jsonb ->> q.key)::int, 0)) != 0`
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), amount: Number(r.amount) }));
}
