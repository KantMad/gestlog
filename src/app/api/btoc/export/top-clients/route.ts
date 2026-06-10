import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── Top Clients export ─────────────────────────────────
// Critère : clients ayant passé PLUS DE 2 commandes (> 2)
// OU dont le panier moyen (total dépensé / nb commandes) dépasse 150 €.
//
// On agrège depuis BtocOrder (par email) — ça couvre TOUS les acheteurs, y
// compris les invités sans compte. Les commandes annulées / remboursées /
// échouées sont exclues (pas de vraies ventes). On joint ensuite BtocCustomer
// (best-effort) pour récupérer téléphone, code postal et noms ; à défaut, on
// retombe sur le nom porté par la commande.
//
// Colonnes finales : Email, Téléphone, Nom, Prénom, Code Postal, Ville.
export async function GET() {
  try {
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
      `WITH agg AS (
        SELECT
          LOWER(o."customerEmail") AS email_key,
          MAX(o."customerEmail")   AS email,
          MAX(o."customerName")    AS "customerName",
          MAX(o."billingCity")     AS order_city,
          COUNT(*)                 AS orders_count,
          SUM(o.total)             AS total_spent
        FROM "BtocOrder" o
        WHERE o."customerEmail" IS NOT NULL AND o."customerEmail" != ''
          AND o.status NOT IN ('cancelled', 'refunded', 'failed')
        GROUP BY LOWER(o."customerEmail")
      )
      SELECT
        a.email,
        a."customerName",
        c."firstName",
        c."lastName",
        c.phone,
        c."billingPostcode",
        COALESCE(c."billingCity", a.order_city) AS "billingCity",
        a.orders_count AS "ordersCount",
        a.total_spent  AS "totalSpent",
        ROUND((a.total_spent / a.orders_count)::numeric, 2) AS "avgBasket"
      FROM agg a
      LEFT JOIN "BtocCustomer" c ON LOWER(c.email) = a.email_key
      WHERE a.orders_count > 2 OR (a.total_spent / a.orders_count) > 150
      ORDER BY a.total_spent DESC`
    );

    // Nom / Prénom : on privilégie la fiche client, sinon on découpe le nom
    // porté par la commande ("Prénom Nom" → premier mot = prénom, reste = nom).
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
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
