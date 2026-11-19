import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  NON_ORDER_STATUSES,
  UNFINISHED_STATUSES,
  buildProspects,
  enrichClients,
  parisYmd,
  splitName,
  type AccountInput,
  type ClientRow,
  type NewsletterContactInput,
  type UnfinishedOrderInput,
} from "@/lib/btoc-contacts";

// Export « Clients & prospects » : 2 listes (cf. lib/btoc-contacts pour les règles).
// Brevo est lu depuis BtocNewsletterContact (synchro quotidienne), plus en direct.
export const maxDuration = 60;

export async function GET() {
  try {
    const nonOrder = [...NON_ORDER_STATUSES];

    // 1) Clients : commandes abouties live + historique, agrégées par e-mail.
    //    Identité : fiche compte > commande la plus récente (avec adresse) > historique.
    const clientRows = await prisma.$queryRawUnsafe<
      {
        email: string;
        c_first: string | null; c_last: string | null; c_phone: string | null;
        c_pc: string | null; c_city: string | null; c_country: string | null;
        o_first: string | null; o_last: string | null; o_name: string | null;
        o_pc: string | null; o_city: string | null; o_country: string | null;
        h_phone: string | null;
        orders: bigint; spent: number; last: Date;
      }[]
    >(
      `WITH sales AS (
         SELECT LOWER(TRIM(o."customerEmail")) k, o."orderDate" d,
                o.total - COALESCE(o."totalRefunded", 0) amt,
                o."billingFirstName" fn, o."billingLastName" ln, o."customerName" cn,
                NULL::text ph, o."billingPostcode" pc, o."billingCity" city,
                COALESCE(o."billingCountry", o."shippingCountry") country
           FROM "BtocOrder" o
          WHERE o."customerEmail" IS NOT NULL AND TRIM(o."customerEmail") <> ''
            AND o.status <> ALL($1)
         UNION ALL
         SELECT LOWER(TRIM(h."customerEmail")), h."orderDate", h.total,
                h."firstName", h."lastName", NULL, h.phone, NULL, NULL, h.country
           FROM "HistOrder" h
          WHERE h."customerEmail" IS NOT NULL AND TRIM(h."customerEmail") <> ''
       ),
       agg AS (SELECT k, COUNT(*) orders, SUM(amt) spent, MAX(d) last FROM sales GROUP BY k),
       latest AS (
         SELECT DISTINCT ON (k) k, fn, ln, cn, pc, city, country
           FROM sales ORDER BY k, (city IS NULL), d DESC
       ),
       phone AS (
         SELECT DISTINCT ON (k) k, ph FROM sales
          WHERE ph IS NOT NULL AND TRIM(ph) <> '' ORDER BY k, d DESC
       ),
       cust AS (
         SELECT DISTINCT ON (LOWER(TRIM(email))) LOWER(TRIM(email)) k,
                "firstName", "lastName", phone, "billingPostcode", "billingCity",
                COALESCE("billingCountry", "shippingCountry") country
           FROM "BtocCustomer" ORDER BY LOWER(TRIM(email)), "updatedAt" DESC
       )
       SELECT a.k email,
              c."firstName" c_first, c."lastName" c_last, c.phone c_phone,
              c."billingPostcode" c_pc, c."billingCity" c_city, c.country c_country,
              l.fn o_first, l.ln o_last, l.cn o_name, l.pc o_pc, l.city o_city, l.country o_country,
              p.ph h_phone, a.orders, a.spent, a.last
         FROM agg a
         JOIN latest l ON l.k = a.k
         LEFT JOIN phone p ON p.k = a.k
         LEFT JOIN cust c ON c.k = a.k
        ORDER BY a.last DESC`,
      nonOrder,
    );

    const t = (v: string | null | undefined) => (v ?? "").trim();
    let clients: ClientRow[] = clientRows.map((r) => {
      let firstName = t(r.c_first) || t(r.o_first);
      let lastName = t(r.c_last) || t(r.o_last);
      if (!firstName && !lastName) ({ firstName, lastName } = splitName(r.o_name));
      // Adresse : on garde un bloc cohérent. La fiche compte n'a quasi jamais de code
      // postal (11 sur 2 560 en 11/2026) → l'adresse de la dernière commande prime.
      const useOrder = !!t(r.o_pc) || !t(r.c_city);
      return {
        email: r.email,
        phone: t(r.c_phone) || t(r.h_phone),
        firstName,
        lastName,
        postcode: useOrder ? t(r.o_pc) : t(r.c_pc),
        city: useOrder ? t(r.o_city) || t(r.c_city) : t(r.c_city),
        country: (useOrder ? t(r.o_country) : t(r.c_country)) || t(r.o_country) || t(r.c_country),
        lastOrder: parisYmd(r.last),
        ordersCount: Number(r.orders),
        totalSpent: Number(r.spent),
      };
    });
    const clientEmails = new Set(clients.map((c) => c.email));

    // 2) Comptes WooCommerce (ceux qui ont commandé sont retirés par buildProspects).
    const accounts = await prisma.$queryRawUnsafe<AccountInput[]>(
      `SELECT email, "firstName", "lastName", phone, "billingPostcode" postcode,
              "billingCity" city, COALESCE("billingCountry", "shippingCountry") country,
              "createdAt"
         FROM "BtocCustomer" WHERE email IS NOT NULL AND TRIM(email) <> ''`,
    );

    // 3) Commandes non abouties : dernière tentative par e-mail.
    const unfinished = await prisma.$queryRawUnsafe<UnfinishedOrderInput[]>(
      `SELECT DISTINCT ON (LOWER(TRIM("customerEmail")))
              LOWER(TRIM("customerEmail")) email,
              "billingFirstName" "firstName", "billingLastName" "lastName",
              "customerName", "billingPostcode" postcode, "billingCity" city,
              COALESCE("billingCountry", "shippingCountry") country,
              "orderDate" "lastDate"
         FROM "BtocOrder"
        WHERE status = ANY($1)
          AND "customerEmail" IS NOT NULL AND TRIM("customerEmail") <> ''
        ORDER BY LOWER(TRIM("customerEmail")), "orderDate" DESC`,
      [...UNFINISHED_STATUSES],
    );

    // 4) Contacts Brevo (miroir local, cf. /api/sync/btoc/newsletter).
    const brevo = await prisma.$queryRawUnsafe<NewsletterContactInput[]>(
      `SELECT email, subscribed, "subscribedAt", "firstName", "lastName", phone
         FROM "BtocNewsletterContact" WHERE "removedAt" IS NULL`,
    );
    const brevoError = brevo.length === 0
      ? "Contacts Brevo pas encore synchronisés : les inscrits newsletter ne sont pas dans l'export."
      : null;

    clients = enrichClients(clients, brevo);
    const prospects = buildProspects({ clientEmails, accounts, unfinished, brevo });

    return NextResponse.json({
      clients,
      prospects,
      meta: { clients: clients.length, prospects: prospects.length, brevoContacts: brevo.length, brevoError },
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/export/contacts");
  }
}
