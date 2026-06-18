import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Comparaison de deux SAISONS ou deux CATALOGUES DE VENTE B2B, par catégorie.
//  - item 1 : TOTAL (toutes les commandes).
//  - item 2 : filtré jusqu'à une date (commandes dont orderDate <= endDate).
// dimension = "season" (défaut) ou "catalog". CA = ClientOrderLine.amount.
// Filtre boutique : filterMode "exclude" (toutes sauf) | "include" (aucune sauf),
// clients = codes séparés par des virgules. Catégorie = Product.category.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const season1 = p.get("season1");
    const season2 = p.get("season2");
    const endDate = p.get("endDate"); // ISO (YYYY-MM-DD) — borne haute pour l'item 2
    const dimension = p.get("dimension") === "catalog" ? "catalog" : "season";
    const filterMode = p.get("filterMode") === "include" ? "include" : "exclude";
    const clientCodes = (p.get("clients") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!season1 || !season2) {
      return NextResponse.json({ error: "season1 et season2 requis" }, { status: 400 });
    }

    type Row = { cat: string; qty: bigint; ca: number };
    const groupQuery = async (itemName: string, end: string | null) => {
      const params: unknown[] = [itemName];
      const dimJoin =
        dimension === "catalog"
          ? `JOIN "Catalog" dim ON dim.id = co."catalogId"`
          : `JOIN "Season" dim ON dim.id = co."seasonId"`;
      const conds = ["dim.name = $1"];
      if (end) {
        params.push(end);
        conds.push(`co."orderDate" IS NOT NULL AND co."orderDate" <= $${params.length}::timestamp`);
      }
      let clientJoin = "";
      if (clientCodes.length) {
        clientJoin = `JOIN "Client" cl ON cl.id = co."clientId"`;
        params.push(clientCodes);
        conds.push(filterMode === "include" ? `cl.code = ANY($${params.length})` : `cl.code <> ALL($${params.length})`);
      }
      return prisma.$queryRawUnsafe<Row[]>(
        `SELECT COALESCE(NULLIF(p.category,''),'Sans catégorie') AS cat,
                SUM(col."totalQuantity")::bigint AS qty,
                COALESCE(SUM(col.amount),0)::float8 AS ca
         FROM "ClientOrder" co
         JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
         JOIN "Product" p ON p.id = col."productId"
         ${dimJoin}
         ${clientJoin}
         WHERE ${conds.join(" AND ")}
         GROUP BY 1`,
        ...params
      );
    };

    // saison 1 = totale ; saison 2 = filtrée par date (fin de journée incluse)
    const endTs = endDate ? `${endDate} 23:59:59` : null;
    const [rows1, rows2] = await Promise.all([
      groupQuery(season1, null),
      groupQuery(season2, endTs),
    ]);

    const map1 = new Map(rows1.map((r) => [r.cat, { qty: Number(r.qty), ca: Number(r.ca) }]));
    const map2 = new Map(rows2.map((r) => [r.cat, { qty: Number(r.qty), ca: Number(r.ca) }]));

    const s1TotalQty = rows1.reduce((s, r) => s + Number(r.qty), 0);
    const s1TotalCa = rows1.reduce((s, r) => s + Number(r.ca), 0);
    const s2TotalQty = rows2.reduce((s, r) => s + Number(r.qty), 0);
    const s2TotalCa = rows2.reduce((s, r) => s + Number(r.ca), 0);

    const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

    const cats = [...new Set([...map1.keys(), ...map2.keys()])];
    const categories = cats
      .map((cat) => {
        const a = map1.get(cat) || { qty: 0, ca: 0 };
        const b = map2.get(cat) || { qty: 0, ca: 0 };
        const s1 = {
          qty: a.qty,
          ca: Math.round(a.ca),
          qtyWeight: pct(a.qty, s1TotalQty), // poids catégorie dans la saison 1 (qté)
          caWeight: pct(a.ca, s1TotalCa), //   poids catégorie dans la saison 1 (CA)
        };
        const s2 = {
          qty: b.qty,
          ca: Math.round(b.ca),
          qtyWeight: pct(b.qty, s2TotalQty),
          caWeight: pct(b.ca, s2TotalCa),
        };
        return {
          category: cat,
          s1,
          s2,
          qtyPct: pct(b.qty, a.qty), // saison2 / saison1 (qté)
          caPct: pct(b.ca, a.ca), //    saison2 / saison1 (CA)
          qtyWeightGap: s2.qtyWeight - s1.qtyWeight, // écart de poids (points) qté
          caWeightGap: s2.caWeight - s1.caWeight, //    écart de poids (points) CA
        };
      })
      .sort((x, y) => y.s1.ca - x.s1.ca);

    return NextResponse.json({
      season1: { name: season1, qty: s1TotalQty, ca: Math.round(s1TotalCa) },
      season2: { name: season2, qty: s2TotalQty, ca: Math.round(s2TotalCa), endDate: endDate || null },
      global: {
        qtyPct: pct(s2TotalQty, s1TotalQty),
        caPct: pct(s2TotalCa, s1TotalCa),
      },
      categories,
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/season-comparison");
  }
}
