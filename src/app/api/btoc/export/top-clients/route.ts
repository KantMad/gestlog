import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";

// ─── Top Clients export ─────────────────────────────────
// Critère : clients ayant passé PLUS DE 2 commandes (> 2)
// OU dont le panier moyen (total dépensé / nb commandes) dépasse 150 €.
//
// On agrège les ventes de DEUX sources :
//   • BtocOrder (boutique WooCommerce live, sync n8n)
//   • HistOrder (historique importé d'un autre WooCommerce)
// regroupées par email — ça couvre tous les acheteurs (invités inclus) et
// cumule la valeur d'un même client présent dans les deux boutiques.
//
// Filtre date optionnel (dateFrom / dateTo) appliqué à la date de commande.
// On joint ensuite BtocCustomer (best-effort) pour récupérer téléphone, code
// postal et noms ; à défaut on retombe sur les infos portées par la commande.
//
// Colonnes finales : Email, Téléphone, Nom, Prénom, Code Postal, Ville.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");

    // Bornes en fuseau Paris (jour de fin inclus), cf. lib/btoc-dates.
    const { gte: from, lt: to } = parisRangeToUtc(dateFrom, dateTo);
    const statuses = (params.get("statuses") || "").split(",").map((x) => x.trim()).filter(Boolean);
    const statusCond = statuses.length > 0 ? "o.status = ANY($3)" : "o.status NOT IN ('cancelled', 'refunded', 'failed')";

    const rows = await prisma.$queryRawUnsafe<
      {
        email: string;
        customerName: string | null;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        billingPostcode: string | null;
        billingCity: string | null;
        ordersCount: bigint;
        totalSpent: number;
        avgBasket: number;
      }[]
    >(
      `WITH sales AS (
        -- Boutique live
        SELECT
          LOWER(o."customerEmail") AS email_key,
          o."customerEmail"        AS email,
          o."customerName"         AS customer_name,
          o."billingCity"          AS city,
          NULL::text               AS hist_first,
          NULL::text               AS hist_last,
          NULL::text               AS hist_phone,
          o.total                  AS total,
          o."orderDate"            AS order_date
        FROM "BtocOrder" o
        WHERE o."customerEmail" IS NOT NULL AND o."customerEmail" != ''
          AND ${statusCond}
        UNION ALL
        -- Historique importé
        SELECT
          LOWER(h."customerEmail"),
          h."customerEmail",
          NULLIF(TRIM(CONCAT_WS(' ', h."firstName", h."lastName")), ''),
          NULL,
          h."firstName",
          h."lastName",
          h.phone,
          h.total,
          h."orderDate"
        FROM "HistOrder" h
        WHERE h."customerEmail" IS NOT NULL AND h."customerEmail" != ''
      ),
      filtered AS (
        SELECT * FROM sales
        WHERE ($1::timestamp IS NULL OR order_date >= $1)
          AND ($2::timestamp IS NULL OR order_date < $2)
      ),
      agg AS (
        SELECT
          email_key,
          MAX(email)         AS email,
          MAX(customer_name) AS "customerName",
          MAX(city)          AS order_city,
          MAX(hist_first)    AS hist_first,
          MAX(hist_last)     AS hist_last,
          MAX(hist_phone)    AS hist_phone,
          COUNT(*)           AS orders_count,
          SUM(total)         AS total_spent
        FROM filtered
        GROUP BY email_key
      )
      SELECT
        a.email,
        a."customerName",
        COALESCE(c."firstName", a.hist_first) AS "firstName",
        COALESCE(c."lastName",  a.hist_last)  AS "lastName",
        COALESCE(c.phone,       a.hist_phone) AS phone,
        c."billingPostcode",
        COALESCE(c."billingCity", a.order_city) AS "billingCity",
        a.orders_count AS "ordersCount",
        a.total_spent  AS "totalSpent",
        ROUND((a.total_spent / NULLIF(a.orders_count, 0))::numeric, 2) AS "avgBasket"
      FROM agg a
      LEFT JOIN "BtocCustomer" c ON LOWER(c.email) = a.email_key
      WHERE a.orders_count > 2 OR (a.total_spent / NULLIF(a.orders_count, 0)) > 150
      ORDER BY a.total_spent DESC`,
      from,
      to,
      statuses.length > 0 ? statuses : null
    );

    // Nom / Prénom : on privilégie la fiche client / l'historique, sinon on
    // découpe le nom porté par la commande live ("Prénom Nom").
    const customers = rows.map((r) => {
      let firstName = r.firstName?.trim() || "";
      let lastName = r.lastName?.trim() || "";
      if (!firstName && !lastName && r.customerName) {
        const parts = r.customerName.trim().split(/\s+/);
        firstName = parts.shift() || "";
        lastName = parts.join(" ");
      }
      return {
        email: r.email,
        phone: r.phone || "",
        lastName,
        firstName,
        billingPostcode: r.billingPostcode || "",
        billingCity: r.billingCity || "",
        ordersCount: Number(r.ordersCount),
        totalSpent: Number(r.totalSpent),
        avgBasket: Number(r.avgBasket),
      };
    });

    return NextResponse.json({ customers, total: customers.length });
  } catch (e) {
    return handleApiError(e, "api/btoc/export/top-clients");
  }
}
