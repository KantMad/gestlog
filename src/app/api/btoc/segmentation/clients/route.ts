import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";

export const maxDuration = 60;

// GET — Liste des clients BtoC correspondant à une segmentation, avec TOUTES leurs
// coordonnées (pour l'export ciblé de l'onglet Segmentation).
//
// Filtres : ?dateFrom&dateTo&statuses  ?minSpent&maxSpent  ?minOrders&maxOrders
//           ?sizes=3XL,4XL&sizeMode=any|only|all   ?promo=all|discounted|only|never
//           ?countOnly=1 → seulement le décompte + 5 lignes d'aperçu (l'écran l'appelle à
//           chaque changement de filtre ; la liste complète n'est chargée qu'à l'export).
//
// ⚠️ Même règle que /api/btoc/segmentation : le CLIENT est l'**e-mail** (minuscule),
// pas `customerId` — la moitié des commandes sont passées sans compte.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const { gte, lt } = parisRangeToUtc(p.get("dateFrom"), p.get("dateTo"));
    const statuses = (p.get("statuses") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const sizes = (p.get("sizes") || "")
      .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const sizeMode = p.get("sizeMode") || "any";
    const promo = p.get("promo") || "all";
    const num = (k: string) => {
      const v = p.get(k);
      if (v === null || v.trim() === "") return null;
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    const params: unknown[] = [gte, lt];
    const statusCond =
      statuses.length > 0
        ? `o.status = ANY($${params.push(statuses)})`
        : `o.status NOT IN ('cancelled', 'refunded', 'failed')`;
    const dateCond = `($1::timestamp IS NULL OR o."orderDate" >= $1) AND ($2::timestamp IS NULL OR o."orderDate" < $2)`;

    // Filtres appliqués APRÈS agrégation par client (clause HAVING-like sur le SELECT final).
    const where: string[] = [];
    const minSpent = num("minSpent"), maxSpent = num("maxSpent");
    const minOrders = num("minOrders"), maxOrders = num("maxOrders");
    if (minSpent !== null) where.push(`a.spent >= $${params.push(minSpent)}`);
    if (maxSpent !== null) where.push(`a.spent <= $${params.push(maxSpent)}`);
    if (minOrders !== null) where.push(`a.n_orders >= $${params.push(minOrders)}`);
    if (maxOrders !== null) where.push(`a.n_orders <= $${params.push(maxOrders)}`);

    if (sizes.length > 0) {
      const i = params.push(sizes);
      // && = a acheté AU MOINS UNE de ces tailles
      // <@ = n'a acheté QUE ces tailles (toutes ses tailles sont dans la sélection)
      // @> = a acheté TOUTES ces tailles
      const op = sizeMode === "only" ? "<@" : sizeMode === "all" ? "@>" : "&&";
      where.push(`sz.sizes_arr ${op} $${i}::text[]`);
    }
    if (promo === "discounted") where.push(`a.n_promo > 0`);
    else if (promo === "only") where.push(`a.n_promo = a.n_orders`);
    else if (promo === "never") where.push(`a.n_promo = 0`);

    const countOnly = p.get("countOnly") === "1";

    // CTE commune : la sélection finale ne change que par ses colonnes (aperçu vs export).
    const FROM = `WITH o AS (
         SELECT LOWER(o."customerEmail") AS email, o.id,
                o.total - COALESCE(o."totalRefunded", 0) AS net,
                COALESCE(o."discountTotal", 0) AS disc, o."couponCodes", o."orderDate",
                o."billingFirstName", o."billingLastName", o."billingAddress1",
                o."billingPostcode", o."billingCity", o."billingCountry",
                o."shippingFirstName", o."shippingLastName", o."shippingAddress1",
                o."shippingPostcode", o."shippingCity", o."shippingCountry",
                o."customerName"
         FROM "BtocOrder" o
         WHERE o."customerEmail" IS NOT NULL AND o."customerEmail" <> ''
           AND ${dateCond} AND ${statusCond}
       ),
       line_sizes AS (
         SELECT o.email, UPPER(TRIM(l.size)) AS size, SUM(l.quantity) AS q
         FROM "BtocOrderLine" l JOIN o ON o.id = l."orderId"
         WHERE l.size IS NOT NULL AND TRIM(l.size) <> ''
         GROUP BY 1, 2
       ),
       sz AS (
         SELECT email,
                ARRAY_AGG(size ORDER BY size) AS sizes_arr,
                STRING_AGG(size || ' (' || q || ')', ', ' ORDER BY q DESC, size) AS sizes_label,
                SUM(q) AS pieces
         FROM line_sizes GROUP BY email
       ),
       a AS (
         SELECT email, COUNT(*) AS n_orders, SUM(net) AS spent, SUM(disc) AS discount,
                COUNT(*) FILTER (WHERE disc > 0 OR "couponCodes" IS NOT NULL) AS n_promo,
                MIN("orderDate") AS first_order, MAX("orderDate") AS last_order
         FROM o GROUP BY email
       ),
       -- Coordonnées = celles de la DERNIÈRE commande (les plus à jour).
       last_o AS (
         SELECT DISTINCT ON (email) * FROM o ORDER BY email, "orderDate" DESC
       ),
       matched AS (
         SELECT a.email, a.n_orders, a.spent, a.discount, a.n_promo,
                a.first_order, a.last_order,
                COALESCE(sz.pieces, 0) AS pieces, sz.sizes_label,
                lo."customerName", lo."billingFirstName", lo."billingLastName",
                lo."billingAddress1", lo."billingPostcode", lo."billingCity", lo."billingCountry",
                lo."shippingFirstName", lo."shippingLastName", lo."shippingAddress1",
                lo."shippingPostcode", lo."shippingCity", lo."shippingCountry",
                c.phone, c.company, c."isVip"
         FROM a
         LEFT JOIN sz ON sz.email = a.email
         LEFT JOIN last_o lo ON lo.email = a.email
         LEFT JOIN LATERAL (
           SELECT phone, company, "isVip" FROM "BtocCustomer" c
           WHERE LOWER(c.email) = a.email ORDER BY c."ordersCount" DESC LIMIT 1
         ) c ON true
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       )`;

    // Décompte : toujours calculé sur l'ensemble des clients retenus (jamais sur l'aperçu).
    const [totals] = await prisma.$queryRawUnsafe<
      { clients: bigint; orders: bigint; revenue: number | null; pieces: bigint | null }[]
    >(
      `${FROM} SELECT COUNT(*) AS clients, COALESCE(SUM(n_orders), 0) AS orders,
               COALESCE(SUM(spent), 0) AS revenue, COALESCE(SUM(pieces), 0) AS pieces
       FROM matched`,
      ...params
    );

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `${FROM} SELECT * FROM matched ORDER BY spent DESC${countOnly ? " LIMIT 5" : ""}`,
      ...params
    );

    const n = (v: unknown) => Number((v as number | bigint | null) ?? 0);
    const r2 = (v: unknown) => Math.round(n(v) * 100) / 100;
    const clients = rows.map((r) => ({
      email: (r.email as string) ?? "",
      firstName: (r.billingFirstName as string) ?? "",
      lastName: (r.billingLastName as string) ?? "",
      customerName: (r.customerName as string) ?? "",
      phone: (r.phone as string) ?? "",
      company: (r.company as string) ?? "",
      billingAddress: (r.billingAddress1 as string) ?? "",
      billingPostcode: (r.billingPostcode as string) ?? "",
      billingCity: (r.billingCity as string) ?? "",
      billingCountry: (r.billingCountry as string) ?? "",
      shippingFirstName: (r.shippingFirstName as string) ?? "",
      shippingLastName: (r.shippingLastName as string) ?? "",
      shippingAddress: (r.shippingAddress1 as string) ?? "",
      shippingPostcode: (r.shippingPostcode as string) ?? "",
      shippingCity: (r.shippingCity as string) ?? "",
      shippingCountry: (r.shippingCountry as string) ?? "",
      orders: n(r.n_orders),
      spent: r2(r.spent),
      averageBasket: n(r.n_orders) ? r2(n(r.spent) / n(r.n_orders)) : 0,
      discount: r2(r.discount),
      promoOrders: n(r.n_promo),
      firstOrder: r.first_order ? new Date(r.first_order as string).toISOString() : null,
      lastOrder: r.last_order ? new Date(r.last_order as string).toISOString() : null,
      pieces: n(r.pieces),
      sizes: (r.sizes_label as string) ?? "",
      isVip: Boolean(r.isVip),
    }));

    return NextResponse.json({
      clients,
      truncated: countOnly,
      summary: {
        clients: n(totals?.clients),
        orders: n(totals?.orders),
        revenue: r2(totals?.revenue),
        pieces: n(totals?.pieces),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/segmentation/clients");
  }
}
