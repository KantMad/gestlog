import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Comparaison CLIENT entre deux saisons B2B.
// Par client (boutique/enseigne) : CA + quantité des 2 saisons. CA = ClientOrderLine.amount.
// Renvoie aussi les totaux globaux (nb clients, CA, quantité) + % saison2/saison1.
// Le filtrage par enseigne (multi-sélection) se fait côté écran sur la liste renvoyée.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const season1 = p.get("season1");
    const season2 = p.get("season2");
    const dimension = p.get("dimension") === "catalog" ? "catalog" : "season";
    if (!season1 || !season2) {
      return NextResponse.json({ error: "season1 et season2 requis" }, { status: 400 });
    }

    // Dimension : comparer deux SAISONS (co.seasonId) ou deux CATALOGUES (co.catalogId).
    // Alias `se` conservé → les clauses `se.name` restent valables dans les deux cas.
    const dimJoin =
      dimension === "catalog"
        ? `JOIN "Catalog" se ON se.id = co."catalogId"`
        : `JOIN "Season" se ON se.id = co."seasonId"`;

    // NOTE source B2B : on ne lit qu'UNE source par saison (Texas prioritaire, repli
    // TIO) pour éviter le double comptage TIO+TEXAS. La dimension peut être « catalog »
    // (se.name = nom de catalogue, pas de saison) → on ne peut pas mapper par nom de
    // saison ; on filtre donc chaque commande par la source active de SA saison via un
    // sous-select corrélé (même logique que resolveOrderSource). Aucun paramètre requis.
    const srcFilter = `AND co."source" = (CASE WHEN EXISTS (SELECT 1 FROM "ClientOrder" c2 WHERE c2."seasonId" = co."seasonId" AND c2."source" = 'TEXAS') THEN 'TEXAS' ELSE 'TIO' END)`;

    const rows = await prisma.$queryRawUnsafe<
      { code: string; name: string; qty1: bigint; ca1: number; qty2: bigint; ca2: number }[]
    >(
      `SELECT cl.code, cl.name,
              COALESCE(SUM(col."totalQuantity") FILTER (WHERE se.name = $1), 0)::bigint AS qty1,
              COALESCE(SUM(col.amount)          FILTER (WHERE se.name = $1), 0)::float8 AS ca1,
              COALESCE(SUM(col."totalQuantity") FILTER (WHERE se.name = $2), 0)::bigint AS qty2,
              COALESCE(SUM(col.amount)          FILTER (WHERE se.name = $2), 0)::float8 AS ca2
       FROM "ClientOrder" co
       JOIN "Client" cl ON cl.id = co."clientId"
       ${dimJoin}
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
       WHERE se.name IN ($1, $2) ${srcFilter}
       GROUP BY cl.id, cl.code, cl.name`,
      season1,
      season2
    );

    // Détail PAR CLIENT ET PAR CATÉGORIE (catégorie = Product.category, PLV exclu) →
    // permet d'agréger par catégorie côté écran en respectant le filtre boutique.
    const catRows = await prisma.$queryRawUnsafe<
      { code: string; category: string; qty1: bigint; ca1: number; qty2: bigint; ca2: number }[]
    >(
      `SELECT cl.code AS code,
              COALESCE(NULLIF(p.category,''),'Sans catégorie') AS category,
              COALESCE(SUM(col."totalQuantity") FILTER (WHERE se.name = $1), 0)::bigint AS qty1,
              COALESCE(SUM(col.amount)          FILTER (WHERE se.name = $1), 0)::float8 AS ca1,
              COALESCE(SUM(col."totalQuantity") FILTER (WHERE se.name = $2), 0)::bigint AS qty2,
              COALESCE(SUM(col.amount)          FILTER (WHERE se.name = $2), 0)::float8 AS ca2
       FROM "ClientOrder" co
       JOIN "Client" cl ON cl.id = co."clientId"
       ${dimJoin}
       JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
       JOIN "Product" p ON p.id = col."productId"
       WHERE se.name IN ($1, $2) AND p.category IS DISTINCT FROM 'PLV' ${srcFilter}
       GROUP BY cl.code, COALESCE(NULLIF(p.category,''),'Sans catégorie')`,
      season1,
      season2
    );
    const catByClient = new Map<
      string,
      { category: string; s1: { ca: number; qty: number }; s2: { ca: number; qty: number } }[]
    >();
    for (const r of catRows) {
      const arr = catByClient.get(r.code) || [];
      arr.push({
        category: r.category,
        s1: { ca: Math.round(Number(r.ca1)), qty: Number(r.qty1) },
        s2: { ca: Math.round(Number(r.ca2)), qty: Number(r.qty2) },
      });
      catByClient.set(r.code, arr);
    }

    const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

    const clients = rows
      .map((r) => {
        const ca1 = Number(r.ca1), qty1 = Number(r.qty1), ca2 = Number(r.ca2), qty2 = Number(r.qty2);
        return {
          code: r.code,
          name: r.name,
          s1: { ca: Math.round(ca1), qty: qty1 },
          s2: { ca: Math.round(ca2), qty: qty2 },
          caPct: pct(ca2, ca1),
          qtyPct: pct(qty2, qty1),
          categories: catByClient.get(r.code) || [],
        };
      })
      // on ne garde que les clients ayant une activité sur au moins une des deux saisons
      .filter((c) => c.s1.ca || c.s1.qty || c.s2.ca || c.s2.qty)
      .sort((a, b) => b.s1.ca - a.s1.ca);

    const sum = (sel: (c: (typeof clients)[number]) => number) => clients.reduce((s, c) => s + sel(c), 0);
    const s1 = {
      clients: clients.filter((c) => c.s1.ca || c.s1.qty).length,
      ca: sum((c) => c.s1.ca),
      qty: sum((c) => c.s1.qty),
    };
    const s2 = {
      clients: clients.filter((c) => c.s2.ca || c.s2.qty).length,
      ca: sum((c) => c.s2.ca),
      qty: sum((c) => c.s2.qty),
    };

    return NextResponse.json({
      season1,
      season2,
      global: {
        s1,
        s2,
        clientsPct: pct(s2.clients, s1.clients),
        caPct: pct(s2.ca, s1.ca),
        qtyPct: pct(s2.qty, s1.qty),
      },
      clients,
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/client-comparison");
  }
}
